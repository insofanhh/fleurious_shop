import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "../src/lib/db";
import { defaultSettings, settingsSchema } from "../src/lib/settings";
import { deliverOrder } from "../src/lib/order-delivery";
import {
  confirmOrderPayment,
  requestOrderRefund,
  completeOrderRefund,
} from "../src/lib/order-payments";
import {
  getCollections,
  getCollectionDetail,
  remitCollection,
  updateCollection,
  remindCollections,
  notifyCollectionOpened,
  collectionPushCurrent,
} from "../src/lib/collections";
import { customerOrder } from "../src/lib/order-privacy";
import { localInstant, dayKey } from "../src/lib/time";
import { isOrderExpired } from "../src/lib/order-expiry";

const run = `cod-${randomUUID().slice(0, 8)}`;
let owner: User, accountant: User, delivery: User, outsider: User;
const ids: string[] = [];
async function outgoing(extra: Record<string, unknown> = {}) {
  const order = await db.order.create({
    data: {
      code: `${run}-${ids.length}`,
      idempotencyKey: randomUUID(),
      buyerName: "Người đặt hoa",
      buyerEmail: "buyer@example.test",
      recipientName: "Người được tặng",
      recipientPhone: "0999999999",
      address: "Địa chỉ QA",
      zoneId: "qa",
      slotId: "qa",
      slotLabel: "QA",
      deliveryDay: dayKey(),
      cardMessage: "",
      note: "",
      paymentMethod: "COD",
      status: "CONFIRMED",
      fulfillment: "OUT_FOR_DELIVERY",
      subtotal: 100000,
      deliveryFee: 0,
      total: 100000,
      expiresAt: new Date(Date.now() - 86400000),
      stockState: "RELEASED",
      ...extra,
      qr: { create: { tokenHash: randomUUID(), tokenEncrypted: "test-only" } },
    },
  });
  ids.push(order.id);
  return order;
}
const proof = (version: number) => ({
  version,
  reference: randomUUID(),
  reason: "Đã xác minh nhận đủ tiền",
});
async function receivedUnpaid() {
  const order = await outgoing();
  return deliverOrder(
    order.id,
    { version: order.version, collection: "UNPAID" },
    owner,
  );
}
async function closeAll() {
  await db.codReceivable.updateMany({
    where: { orderId: { in: ids } },
    data: { state: "SETTLED" },
  });
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  for (const role of ["OWNER", "ACCOUNTANT", "DELIVERY", "MARKETING"]) {
    const user = await db.user.create({
      data: {
        name: `${run} ${role}`,
        email: `${randomUUID()}@example.test`,
        passwordHash: "test-only",
        role,
      },
    });
    if (role === "OWNER") owner = user;
    if (role === "ACCOUNTANT") accountant = user;
    if (role === "DELIVERY") delivery = user;
    if (role === "MARKETING") outsider = user;
  }
  await db.setting.upsert({
    where: { key: "shop" },
    create: { key: "shop", value: defaultSettings },
    update: { value: defaultSettings },
  });
});
after(async () => {
  await db.collectionEvent.deleteMany({
    where: { receivable: { orderId: { in: ids } } },
  });
  await db.codReceivable.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderReceipt.deleteMany({ where: { orderId: { in: ids } } });
  await db.refund.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.qrGrant.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  const users = [owner, accountant, delivery, outsider]
    .filter(Boolean)
    .map((u) => u.id);
  await db.notification.deleteMany({ where: { userId: { in: users } } });
  await db.outbox.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.setting.update({
    where: { key: "shop" },
    data: { value: defaultSettings },
  });
  await db.$disconnect();
});

test("delivery preserves unpaid COD, captures real delivery time and payer, ignores old checkout expiry", async () => {
  const order = await receivedUnpaid();
  assert.equal(order.paymentStatus, "UNPAID");
  assert.equal(order.fulfillment, "DELIVERED");
  assert.equal(order.status, "COMPLETED");
  assert.ok(order.deliveredAt);
  assert.equal(isOrderExpired(order), false);
  const debt = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  assert.equal(debt.amount, order.total);
  assert.equal(debt.payerName, "Người đặt hoa");
  assert.equal(debt.payerPhone, "");
  assert.equal(debt.dueAt.getTime(), order.deliveredAt!.getTime());
  assert.equal(
    await db.orderReceipt.count({ where: { orderId: order.id } }),
    0,
  );
});

test("financial receipt closes delivered debt once even with concurrent confirmations", async () => {
  const order = await receivedUnpaid();
  const input = proof(order.version);
  const results = await Promise.all([
    confirmOrderPayment(order.id, input, accountant),
    confirmOrderPayment(order.id, input, owner),
  ]);
  assert.ok(results.every((r) => r.paymentStatus === "PAID" && r.paidAt));
  assert.equal(
    await db.orderReceipt.count({ where: { orderId: order.id } }),
    1,
  );
  assert.equal(
    (await db.codReceivable.findUniqueOrThrow({ where: { orderId: order.id } }))
      .state,
    "SETTLED",
  );
});

test("shipper collection transfers debt without doubling it; remittance clears it once", async () => {
  await closeAll();
  const order = await receivedUnpaid();
  const paid = await confirmOrderPayment(
    order.id,
    {
      ...proof(order.version),
      destination: "SHIPPER",
      collectorId: delivery.id,
    },
    accountant,
  );
  const debt = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  assert.equal(debt.kind, "SHIPPER");
  assert.equal(debt.payerName, delivery.name);
  assert.equal(debt.state, "OPEN");
  assert.equal(paid.paymentStatus, "PAID");
  const report = await getCollections(
    accountant,
    new URLSearchParams({ q: order.code }),
  );
  assert.equal(report.count, 1);
  assert.equal(report.rows[0].amount, order.total);
  assert.equal(report.rows[0].order.receipt?.remittedAt, null);
  await Promise.all([
    remitCollection(order.id, proof(paid.version), owner),
    remitCollection(order.id, proof(paid.version), accountant),
  ]);
  assert.equal(
    (await db.codReceivable.findUniqueOrThrow({ where: { orderId: order.id } }))
      .state,
    "SETTLED",
  );
  assert.ok(
    (await db.orderReceipt.findUniqueOrThrow({ where: { orderId: order.id } }))
      .remittedAt,
  );
  assert.equal(
    await db.collectionEvent.count({
      where: { receivableId: debt.id, action: "REMITTED" },
    }),
    1,
  );
});

test("delivery and payment are atomic; invalid proof rolls both back", async () => {
  const order = await outgoing();
  await assert.rejects(() =>
    deliverOrder(
      order.id,
      { version: order.version, collection: "SHOP", reference: "", reason: "" },
      owner,
    ),
  );
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(fresh.fulfillment, "OUT_FOR_DELIVERY");
  assert.equal(fresh.paymentStatus, "UNPAID");
  assert.equal(
    await db.codReceivable.count({ where: { orderId: order.id } }),
    0,
  );
  const done = await deliverOrder(
    order.id,
    { ...proof(fresh.version), collection: "SHOP" },
    owner,
  );
  assert.equal(done.paymentStatus, "PAID");
  assert.equal(
    (await db.codReceivable.findUniqueOrThrow({ where: { orderId: order.id } }))
      .state,
    "SETTLED",
  );
});

test("delivery staff only handle assigned orders and report collection without financial authority", async () => {
  const order = await outgoing();
  await assert.rejects(
    () =>
      deliverOrder(
        order.id,
        { version: order.version, collection: "UNPAID" },
        delivery,
      ),
    (e: any) => e.code === "FORBIDDEN",
  );
  await db.order.update({
    where: { id: order.id },
    data: { assignee: delivery.id },
  });
  await assert.rejects(
    () =>
      deliverOrder(
        order.id,
        { ...proof(order.version), collection: "SHOP" },
        delivery,
      ),
    (e: any) => e.code === "FORBIDDEN",
  );
  const done = await deliverOrder(
    order.id,
    { ...proof(order.version), collection: "SHIPPER_REPORT" },
    delivery,
  );
  assert.equal(done.paymentStatus, "UNPAID");
  const data = await getCollectionDetail(owner, order.id);
  assert.equal(data.receivable?.events[0].action, "COLLECTION_REPORTED");
  assert.equal(data.receipt, null);
});

test("financial queries, receipts and remittances reject nonfinancial roles", async () => {
  const order = await receivedUnpaid();
  for (const actor of [delivery, outsider]) {
    await assert.rejects(
      () => getCollections(actor, new URLSearchParams()),
      (e: any) => e.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => getCollectionDetail(actor, order.id),
      (e: any) => e.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => confirmOrderPayment(order.id, proof(order.version), actor),
      (e: any) => e.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => remitCollection(order.id, proof(order.version), actor),
      (e: any) => e.code === "FORBIDDEN",
    );
  }
});

test("opening alerts honor push settings, deduplicate, and recheck settlement before sending", async () => {
  const order = await receivedUnpaid();
  await db.setting.update({
    where: { key: "shop" },
    data: { value: { ...defaultSettings, collectionPushEnabled: false } },
  });
  const debt = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  await Promise.all([
    notifyCollectionOpened(order.id),
    notifyCollectionOpened(order.id),
  ]);
  assert.equal(
    await db.notification.count({
      where: {
        userId: accountant.id,
        dedupKey: { contains: `collection-open:${debt.id}:` },
      },
    }),
    1,
  );
  const event = await db.outbox.findFirstOrThrow({
    where: {
      userId: accountant.id,
      event: "notification.created",
      payload: { path: "$.collection", equals: true },
    },
    orderBy: { createdAt: "desc" },
  });
  assert.equal((event.payload as { push: boolean }).push, false);
  await confirmOrderPayment(order.id, proof(order.version), owner);
  await db.notification.deleteMany({
    where: { dedupKey: { contains: `collection-open:${debt.id}:` } },
  });
  await notifyCollectionOpened(order.id);
  assert.equal(
    await db.notification.count({
      where: { dedupKey: { contains: `collection-open:${debt.id}:` } },
    }),
    0,
  );
  await db.setting.update({
    where: { key: "shop" },
    data: { value: defaultSettings },
  });
});

test("queued collection pushes are suppressed after a promise or settlement", async () => {
  const order = await receivedUnpaid();
  const now = new Date(`${dayKey()}T09:00:00+07:00`);
  const reminderAt = new Date(now.getTime() - 3600000);
  await db.codReceivable.update({
    where: { orderId: order.id },
    data: { nextReminderAt: reminderAt },
  });
  const payload = {
    collection: true,
    collectionOrderId: order.id,
    collectionReminderAt: reminderAt.toISOString(),
    push: true,
  };
  assert.equal(await collectionPushCurrent(payload, now), true);
  const digest = {
    collection: true,
    collectionDigestDay: dayKey(now),
    push: true,
  };
  assert.equal(await collectionPushCurrent(digest, now), true);
  assert.equal(
    await collectionPushCurrent(
      digest,
      new Date(`${dayKey(now)}T21:00:00+07:00`),
    ),
    false,
  );
  await db.codReceivable.update({
    where: { orderId: order.id },
    data: { nextReminderAt: new Date(now.getTime() + 86400000) },
  });
  assert.equal(await collectionPushCurrent(payload, now), false);
  await confirmOrderPayment(order.id, proof(order.version), owner);
  assert.equal(
    await collectionPushCurrent(
      { collection: true, collectionOrderId: order.id, push: true },
      now,
    ),
    false,
  );
});

test("promise to pay records contact and owner without modifying amount or due date", async () => {
  const order = await receivedUnpaid();
  const before = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  const next = new Date(Date.now() + 2 * 86400000);
  const input = {
    version: order.version,
    note: "Khách hẹn trả sau hai ngày",
    payerName: "Người đặt",
    payerPhone: "0901234567",
    ownerId: accountant.id,
    nextReminderAt: next.toISOString(),
    contacted: true,
  };
  await updateCollection(order.id, input, owner);
  const after = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  assert.equal(after.amount, before.amount);
  assert.equal(+after.dueAt, +before.dueAt);
  assert.equal(after.ownerId, accountant.id);
  assert.ok(after.lastContactAt);
  assert.equal(+after.nextReminderAt, +next);
  await assert.rejects(
    () => updateCollection(order.id, input, owner),
    (e: any) => e.code === "STALE_ORDER_VERSION",
  );
});

test("full-data aggregates retain a debt older than 200 newer orders and paginate details", async () => {
  await closeAll();
  const baseline = await getCollections(owner, new URLSearchParams());
  const beforeAmount =
    baseline.totals.find((t) => t.kind === "CUSTOMER")?.amount ?? 0;
  const order = await receivedUnpaid();
  await db.order.update({
    where: { id: order.id },
    data: { createdAt: new Date("2020-01-01T00:00:00Z") },
  });
  const newer = Array.from({ length: 201 }, (_, i) => ({
    ...order,
    shippingSnapshot: undefined,
    id: randomUUID(),
    code: `${run}-newer-${i}`,
    idempotencyKey: randomUUID(),
    createdAt: new Date(),
  }));
  await db.order.createMany({ data: newer });
  ids.push(...newer.map((o) => o.id));
  const data = await getCollections(
    owner,
    new URLSearchParams({ q: order.code }),
  );
  assert.equal(data.count, 1);
  assert.equal(data.rows[0].order.code, order.code);
  assert.equal(
    data.totals.find((t) => t.kind === "CUSTOMER")?.amount,
    beforeAmount + 100000,
  );
  assert.ok(
    (await db.order.count({
      where: { createdAt: { gt: new Date("2020-01-01T00:00:00Z") } },
    })) > 200,
  );
});

test("reminders obey Hanoi quiet hours, deduplicate concurrent runs, skip promises and stop after collection", async () => {
  await closeAll();
  const order = await receivedUnpaid();
  const due = new Date("2099-06-01T01:00:00+07:00"),
    now = new Date("2099-06-05T09:00:00+07:00");
  const debt = await db.codReceivable.update({
    where: { orderId: order.id },
    data: { dueAt: due, nextReminderAt: due },
  });
  const count = () =>
    db.notification.count({
      where: {
        userId: owner.id,
        dedupKey: { contains: `collection:${debt.id}:` },
      },
    });
  await remindCollections(new Date("2099-06-05T07:59:00+07:00"));
  assert.equal(await count(), 0);
  await Promise.all([remindCollections(now), remindCollections(now)]);
  const first = await count();
  assert.ok(first > 0);
  await remindCollections(now);
  assert.equal(await count(), first);
  assert.equal(
    await db.notification.count({
      where: {
        userId: outsider.id,
        dedupKey: { contains: `collection:${debt.id}:` },
      },
    }),
    0,
  );
  await db.codReceivable.update({
    where: { id: debt.id },
    data: { nextReminderAt: new Date("2099-06-10T09:00:00+07:00") },
  });
  await remindCollections(new Date("2099-06-06T09:00:00+07:00"));
  assert.equal(await count(), first);
  await confirmOrderPayment(order.id, proof(order.version), accountant);
  await remindCollections(new Date("2099-06-11T09:00:00+07:00"));
  assert.equal(await count(), first);
  assert.equal(dayKey(new Date("2099-06-05T00:00:00+07:00")), "2099-06-05");
  assert.equal(
    localInstant("2099-06-05").toISOString(),
    "2099-06-04T17:00:00.000Z",
  );
});

test("refunding a shipper-collected order preserves remittance debt instead of treating it as customer debt", async () => {
  const order = await receivedUnpaid();
  const paid = await confirmOrderPayment(
    order.id,
    {
      ...proof(order.version),
      destination: "SHIPPER",
      collectorId: delivery.id,
    },
    owner,
  );
  const refund = await requestOrderRefund(
    order.id,
    {
      version: paid.version,
      amount: order.total,
      reason: "Hoàn do chất lượng hoa",
    },
    owner,
  );
  await completeOrderRefund(refund.id, "refund-proof", owner);
  const debt = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  assert.equal(debt.state, "OPEN");
  assert.equal(debt.kind, "SHIPPER");
  assert.equal(debt.amount, order.total);
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  await remitCollection(order.id, proof(fresh.version), accountant);
});

test("public orders strip internal debt and receipt; invalid notification settings are rejected", () => {
  const safe = customerOrder({
    id: "public",
    receipt: { reference: "secret" },
    receivable: { note: "internal" },
  });
  assert.equal("receipt" in safe, false);
  assert.equal("receivable" in safe, false);
  assert.equal(
    settingsSchema.safeParse({
      ...defaultSettings,
      collectionWorkStart: 20,
      collectionWorkEnd: 8,
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...defaultSettings,
      collectionEscalationHours: 1,
    }).success,
    false,
  );
});
