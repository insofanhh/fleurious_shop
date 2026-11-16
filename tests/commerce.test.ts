import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { defaultSettings, getSettings } from "../src/lib/settings";
import {
  createOrder as createOrderService,
  claimQr,
  quote as quoteService,
  transitionOrder,
  receiveSepay,
  expireReservations,
  checkoutQuoteSchema,
  checkoutSchema,
  type Checkout,
} from "../src/lib/commerce";
import { decrypt } from "../src/lib/security";
import { dayKey, monthKey, shiftDay } from "../src/lib/time";
import type { User, Order } from "@prisma/client";
import { fundWaitingRewards } from "../src/lib/jobs";
import { setupMfa, verifyMfa, recoveryCodes } from "../src/lib/mfa";
import * as OTPAuth from "otpauth";
import { sendAnalytics } from "../src/lib/analytics";
import {
  confirmOrderPayment,
  stopAndRefundOrder,
  requestOrderRefund,
  completeOrderRefund,
} from "../src/lib/order-payments";
import { orderActions, orderLane } from "../src/lib/order-workflow";
import {
  createAdminOrder as createAdminOrderService,
  quoteAdminOrder as quoteAdminOrderService,
} from "../src/lib/admin-orders";
import { setupShippingFixture, fixtureShipping } from "./fixtures/shipping";
import {
  orderReviewOptions,
  createOrderReview,
  publicProductReviews,
  buyerProductReviews,
} from "../src/lib/order-reviews";
import { prepareReorder } from "../src/lib/order-reorder";
import {
  isOrderExpired,
  deadlineSeconds,
  formatCountdown,
} from "../src/lib/order-expiry";
import { hash } from "../src/lib/security";
import {
  getOrderPaymentQr,
  setOrderPaymentTerms,
  downloadOrderPaymentQr,
} from "../src/lib/order-payment-qr";
import { trackOrder, trackingPayment } from "../src/lib/order-tracking";
import { isPaymentOverdue, paymentDeadlineIso } from "../src/lib/order-expiry";
let variantId: string, admin: User;
// Commerce regression tests consume server-issued distance quotes. Provider and
// quote validation are exercised separately in shipping.test.ts.
const createOrder: typeof createOrderService = async (
  raw,
  user,
  guest,
  options,
) =>
  createOrderService(
    {
      ...raw,
      ...(await fixtureShipping(user ? `user:${user.id}` : `guest:${guest}`)),
    },
    user,
    guest,
    options,
  );
const quote: typeof quoteService = async (raw, user, client, options) =>
  quoteService(
    {
      ...raw,
      ...(await fixtureShipping(
        options?.shippingOwner ?? (user ? `user:${user.id}` : "guest:test"),
      )),
    },
    user,
    client,
    {
      ...options,
      shippingOwner:
        options?.shippingOwner ?? (user ? `user:${user.id}` : "guest:test"),
    },
  );
const createAdminOrder: typeof createAdminOrderService = async (raw, actor) =>
  createAdminOrderService(
    { ...(raw as object), ...(await fixtureShipping(`user:${actor.id}`)) },
    actor,
  );
const quoteAdminOrder: typeof quoteAdminOrderService = async (raw, actor) =>
  quoteAdminOrderService(
    { ...(raw as object), ...(await fixtureShipping(`user:${actor.id}`)) },
    actor,
  );
const run = randomUUID().slice(0, 8);
async function customer(member = false) {
  return db.user.create({
    data: {
      name: "Khách kiểm thử",
      email: `${randomUUID()}@example.test`,
      passwordHash: "not-a-login-password",
      verified: true,
      memberSince: member ? new Date() : null,
    },
  });
}
function input(extra: Partial<Checkout> = {}): Checkout {
  return {
    items: [{ variantId, quantity: 1 }],
    buyerName: "Khách kiểm thử",
    buyerEmail: "qa@example.test",
    recipientName: "Người nhận kiểm thử",
    recipientPhone: "0900000000",
    address: "Địa chỉ giả lập, Hà Nội",
    zoneId: "test-zone",
    deliveryDay: shiftDay(dayKey(), 1),
    slotId: "test-slot",
    cardMessage: "",
    cardWritingMode: "AUTO",
    note: "TEST ONLY",
    paymentMethod: "COD",
    useMember: false,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}
async function step(order: Order, action: string) {
  return transitionOrder(order.id, action, order.version, admin);
}
async function delivered(order: Order) {
  for (const action of ["CONFIRM", "PREPARE", "READY", "DISPATCH", "DELIVER"]) {
    if (action === "CONFIRM" && order.status !== "PENDING") continue;
    order = await step(order, action);
  }
  // Fixtures using this helper model a delivery with money explicitly received.
  if (["UNPAID", "PENDING"].includes(order.paymentStatus))
    order = await confirmOrderPayment(
      order.id,
      {
        version: order.version,
        reference: randomUUID(),
        reason: "Đã thu tiền trong fixture giao hàng",
      },
      admin,
    );
  return order;
}
async function qr(order: Order) {
  return decrypt(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .tokenEncrypted,
  );
}
before(async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"));
  await setupShippingFixture();
  process.env.SEPAY_ACCOUNT_NUMBER = "TESTACCOUNT";
  process.env.SEPAY_BANK = "TESTBANK";
  process.env.SEPAY_WEBHOOK_KEY = "test-only-webhook-key";
  await db.setting.upsert({
    where: { key: "streak_rules" },
    create: { key: "streak_rules", value: [] },
    update: { value: [] },
  });
  await db.setting.upsert({
    where: { key: "shop" },
    create: {
      key: "shop",
      value: {
        ...defaultSettings,
        monthlyThreshold: Math.min(5, Number(dayKey().slice(8))),
      },
    },
    update: {
      value: {
        ...defaultSettings,
        monthlyThreshold: Math.min(5, Number(dayKey().slice(8))),
      },
    },
  });
  await db.setting.upsert({
    where: { key: "reward_budget" },
    create: { key: "reward_budget", value: { committed: 0 } },
    update: { value: { committed: 0 } },
  });
  await db.deliveryZone.upsert({
    where: { id: "test-zone" },
    create: { id: "test-zone", name: "Test", fee: 30000 },
    update: {},
  });
  await db.deliverySlot.upsert({
    where: { id: "test-slot" },
    create: {
      id: "test-slot",
      label: "09:00 – 12:00",
      startHour: 9,
      endHour: 12,
      capacity: 10000,
    },
    update: {},
  });
  const product = await db.product.create({
    data: {
      slug: `test-${run}`,
      name: "Hoa kiểm thử",
      subtitle: "Test",
      description: "Test",
      category: "Test",
      occasion: "Test",
      color: "Test",
      image: "/images/roses.webp",
      images: [],
      variants: {
        create: { name: "M", sku: `TEST-${run}`, price: 500000, stock: 1000 },
      },
    },
    include: { variants: true },
  });
  variantId = product.variants[0].id;
  admin = await db.user.create({
    data: {
      name: "Test Owner",
      email: `owner-${run}@example.test`,
      passwordHash: "not-a-login-password",
      role: "OWNER",
      verified: true,
    },
  });
});
after(() => db.$disconnect());
test("a cancelled checkout releases inventory, slot and member reservation", async () => {
  const user = await customer(true);
  const order = await createOrder(
    input({ useMember: true }),
    user,
    "guest-test",
  );
  assert.ok(
    Math.abs(Date.now() - order.createdAt.getTime()) < 10000,
    "Database timestamps must be stored and read in UTC",
  );
  let period = await db.memberPeriod.findUniqueOrThrow({
    where: { userId_month: { userId: user.id, month: monthKey() } },
  });
  assert.equal(period.reserved, 1);
  await step(order, "CANCEL");
  period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  assert.equal(period.reserved, 0);
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).stockState,
    "RELEASED",
  );
});
test("parallel checkouts cannot exceed the last member benefit", async () => {
  const user = await customer(true);
  await db.memberPeriod.create({
    data: { userId: user.id, month: monthKey(), limit: 1 },
  });
  const result = await Promise.allSettled([
    createOrder(input({ useMember: true }), user, "test"),
    createOrder(input({ useMember: true }), user, "test"),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const plain = await createOrder(input(), user, "test");
  assert.equal(plain.discount, 0);
  for (const r of result)
    if (r.status === "fulfilled") await step(r.value, "CANCEL");
  await step(plain, "CANCEL");
});
test("idempotency replay returns the same order without reserving twice", async () => {
  const user = await customer();
  const payload = input();
  const first = await createOrder(payload, user, "test");
  const replay = await createOrder(payload, user, "test");
  assert.equal(first.id, replay.id);
  await step(first, "CANCEL");
});
test("two people scanning one QR cannot exceed its recipient cap", async () => {
  const order = await delivered(await createOrder(input(), null, "test"));
  const value = await qr(order);
  const a = await customer(),
    b = await customer();
  const result = await Promise.allSettled([
    claimQr(value, a),
    claimQr(value, b),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .claimsCount,
    1,
  );
});
test("same user, two different QR codes: only one day, only one code consumed", async () => {
  const a = await delivered(await createOrder(input(), null, "test"));
  const b = await delivered(await createOrder(input(), null, "test"));
  const user = await customer();
  const result = await Promise.allSettled([
    claimQr(await qr(a), user),
    claimQr(await qr(b), user),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const grants = await db.qrGrant.findMany({
    where: { orderId: { in: [a.id, b.id] } },
  });
  assert.equal(
    grants.reduce((s, g) => s + g.claimsCount, 0),
    1,
  );
});
test("milestones issue once; repeat scan does not issue again", async () => {
  const user = await customer();
  for (let i = 4; i > 0; i--)
    await db.activeDay.create({
      data: {
        userId: user.id,
        day: shiftDay(dayKey(), -i),
        image: "/images/roses.webp",
        productName: "Test",
        sourceGrantId: `fixture-${run}-${i}`,
      },
    });
  const order = await delivered(await createOrder(input(), null, "test"));
  const value = await qr(order);
  await claimQr(value, user);
  await claimQr(value, user);
  assert.equal(await db.reward.count({ where: { userId: user.id } }), 2);
  assert.equal(await db.activeDay.count({ where: { userId: user.id } }), 5);
});
test("SePay validates amount, deduplicates IDs and consumes membership once", async () => {
  const user = await customer(true);
  const order = await createOrder(
    input({ paymentMethod: "SEPAY", useMember: true }),
    user,
    "test",
  );
  const wrong = await receiveSepay({
    id: `wrong-${randomUUID()}`,
    transferType: "in",
    transferAmount: order.total - 1,
    accountNumber: "TESTACCOUNT",
    content: order.code,
  });
  assert.equal(wrong.matched, false);
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    "PENDING",
  );
  const id = randomUUID();
  const payload = {
    id,
    transferType: "in" as const,
    transferAmount: order.total,
    accountNumber: "TESTACCOUNT",
    content: order.code,
  };
  const result = await Promise.all([
    receiveSepay(payload),
    receiveSepay({ ...payload, id: randomUUID() }),
  ]);
  assert.equal(result.filter((r) => "matched" in r && r.matched).length, 1);
  const repeat = await receiveSepay(payload);
  assert.equal(repeat.duplicate, true);
  const period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: order.memberPeriodId! },
  });
  assert.equal(period.consumed, 1);
  assert.equal(period.reserved, 0);
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(fresh.status, "CONFIRMED");
  assert.equal(orderLane(fresh), "UNASSIGNED");
  await stopAndRefundOrder(fresh.id, fresh.version, "Hoàn đơn kiểm thử", admin);
});
test("expired transfers go to review rather than confirming an unavailable order", async () => {
  const order = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expireReservations();
  const result = await receiveSepay({
    id: randomUUID(),
    transferType: "in",
    transferAmount: order.total,
    accountNumber: "TESTACCOUNT",
    content: order.code,
  });
  assert.equal(result.matched, false);
});
test("source refund invalidates active day and unused milestone rewards", async () => {
  const user = await customer();
  for (let i = 4; i > 0; i--)
    await db.activeDay.create({
      data: {
        userId: user.id,
        day: shiftDay(dayKey(), -i),
        image: "/images/roses.webp",
        productName: "Test",
        sourceGrantId: `fixture-${randomUUID()}`,
      },
    });
  let order = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  await receiveSepay({
    id: randomUUID(),
    transferType: "in",
    transferAmount: order.total,
    accountNumber: "TESTACCOUNT",
    content: order.code,
  });
  order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(order.status, "CONFIRMED");
  await claimQr(await qr(order), user);
  await stopAndRefundOrder(order.id, order.version, "Hoàn đơn kiểm thử", admin);
  assert.equal(
    await db.activeDay.count({ where: { userId: user.id, valid: true } }),
    4,
  );
  assert.equal(
    await db.reward.count({ where: { userId: user.id, status: "REVOKED" } }),
    2,
  );
});
test("invalid calendar date is rejected", async () => {
  await assert.rejects(() => quote(input({ deliveryDay: "2026-11-31" }), null));
});
test("parallel retries of one checkout share an order", async () => {
  const user = await customer();
  const payload = input();
  const result = await Promise.all([
    createOrder(payload, user, "test"),
    createOrder(payload, user, "test"),
  ]);
  assert.equal(result[0].id, result[1].id);
  await step(result[0], "CANCEL");
});
test("an old-period reservation is consumed and refunded in its original period", async () => {
  const user = await customer(true);
  let order = await createOrder(input({ useMember: true }), user, "test");
  const previous = shiftDay(`${monthKey()}-01`, -1).slice(0, 7);
  await db.memberPeriod.update({
    where: { id: order.memberPeriodId! },
    data: { month: previous },
  });
  order = await step(order, "CONFIRM");
  let period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: order.memberPeriodId! },
  });
  assert.equal(period.consumed, 1);
  assert.equal(period.month, previous);
  await step(order, "CANCEL");
  period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  assert.equal(period.consumed, 1);
  assert.equal(
    await db.memberPeriod.count({
      where: { userId: user.id, month: monthKey() },
    }),
    0,
  );
});
test("expired QR does not consume a recipient slot", async () => {
  const order = await delivered(await createOrder(input(), null, "test"));
  await db.qrGrant.update({
    where: { orderId: order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const value = await qr(order),
    user = await customer();
  await assert.rejects(() => claimQr(value, user));
  assert.equal(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .claimsCount,
    0,
  );
});
test("waiting-budget rewards preserve entitlement and open after funding", async () => {
  const saved = await db.setting.findUniqueOrThrow({ where: { key: "shop" } });
  await db.setting.update({
    where: { key: "shop" },
    data: { value: { ...(saved.value as object), campaignBudget: 0 } },
  });
  const user = await customer();
  for (let i = 4; i > 0; i--)
    await db.activeDay.create({
      data: {
        userId: user.id,
        day: shiftDay(dayKey(), -i),
        image: "/images/roses.webp",
        productName: "Test",
        sourceGrantId: `fixture-${randomUUID()}`,
      },
    });
  const order = await delivered(await createOrder(input(), null, "test"));
  await claimQr(await qr(order), user);
  assert.equal(
    await db.reward.count({
      where: { userId: user.id, status: "WAITING_BUDGET" },
    }),
    2,
  );
  await db.setting.update({
    where: { key: "shop" },
    data: { value: saved.value! },
  });
  await fundWaitingRewards();
  assert.equal(
    await db.reward.count({ where: { userId: user.id, status: "AVAILABLE" } }),
    2,
  );
});
test("completed flower spend upgrades a member's tier", async () => {
  const user = await customer(true);
  await delivered(
    await createOrder(
      input({ items: [{ variantId, quantity: 4 }] }),
      user,
      "test",
    ),
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).tier,
    "Bloom",
  );
});
test("TOTP and recovery codes cannot be replayed concurrently", async () => {
  const user = await customer();
  const setup = setupMfa(user.email),
    recovery = recoveryCodes();
  await db.user.update({
    where: { id: user.id },
    data: {
      totpEnabled: true,
      totpSecretEncrypted: setup.encrypted,
      recoveryHashes: recovery.hashes,
    },
  });
  const otp = OTPAuth.URI.parse(setup.uri).generate();
  const attempts = await Promise.all([
    verifyMfa(user.id, otp),
    verifyMfa(user.id, otp),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(await verifyMfa(user.id, recovery.codes[0]), true);
  assert.equal(await verifyMfa(user.id, recovery.codes[0]), false);
});
test("slot capacity cannot be oversold under parallel checkouts", async () => {
  const slot = await db.deliverySlot.create({
    data: { label: "09:00 – 12:00", startHour: 9, endHour: 12, capacity: 1 },
  });
  const results = await Promise.allSettled([
    createOrder(input({ slotId: slot.id }), null, "slot-test"),
    createOrder(input({ slotId: slot.id }), null, "slot-test"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results)
    if (r.status === "fulfilled") await step(r.value, "CANCEL");
});
test("the last available bouquet cannot be reserved twice", async () => {
  const original = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  await db.productVariant.update({
    where: { id: variantId },
    data: { stock: original.reserved + 1 },
  });
  const results = await Promise.allSettled([
    createOrder(input(), null, "stock-test"),
    createOrder(input(), null, "stock-test"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results)
    if (r.status === "fulfilled") await step(r.value, "CANCEL");
  await db.productVariant.update({
    where: { id: variantId },
    data: { stock: original.stock },
  });
});
test("custom milestone discounts only its product and allocates refunds accurately", async () => {
  const variant = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const rule = {
    id: `rule-${run}`,
    name: "Ngày đầu có hoa",
    kind: "monthly",
    threshold: 1,
    percent: 5,
    cap: 50000,
    minimum: 0,
    validDays: 7,
    productId: variant.productId,
    active: true,
    startsOn: dayKey(),
    endsOn: dayKey(),
  };
  await db.setting.update({
    where: { key: "streak_rules" },
    data: { value: [rule] },
  });
  try {
    const user = await customer();
    const origin = await delivered(await createOrder(input(), null, "test"));
    await claimQr(await qr(origin), user);
    const reward = await db.reward.findUniqueOrThrow({
      where: {
        userId_ruleKey_period: {
          userId: user.id,
          ruleKey: `monthly:${rule.id}`,
          period: monthKey(),
        },
      },
    });
    assert.equal(reward.productId, variant.productId);
    assert.equal(reward.validDays, 7);
    const other = await db.product.create({
      data: {
        slug: `scope-${run}`,
        name: "Hoa khác",
        subtitle: "Test",
        description: "Test",
        category: "Test",
        occasion: "Test",
        color: "Test",
        image: "/images/white.webp",
        images: [],
        variants: {
          create: { name: "M", sku: `SCOPE-${run}`, price: 1000000, stock: 5 },
        },
      },
      include: { variants: true },
    });
    const payload = input({
      items: [
        { variantId, quantity: 1 },
        { variantId: other.variants[0].id, quantity: 1 },
      ],
      rewardId: reward.id,
    });
    const result = await createOrder(payload, user, "test");
    assert.equal(result.discount, 25000);
    const items = await db.orderItem.findMany({
      where: { orderId: result.id },
    });
    assert.equal(items.find((i) => i.variantId === variantId)?.discount, 25000);
    assert.equal(
      items.find((i) => i.variantId === other.variants[0].id)?.discount,
      0,
    );
    await step(result, "CANCEL");
    await assert.rejects(() =>
      quote(
        input({
          items: [{ variantId: other.variants[0].id, quantity: 1 }],
          rewardId: reward.id,
        }),
        user,
      ),
    );
  } finally {
    await db.setting.update({
      where: { key: "streak_rules" },
      data: { value: [] },
    });
  }
});
test("checkout refuses an outdated quoted total before reserving inventory", async () => {
  await assert.rejects(
    () => createOrder(input({ expectedTotal: 1 }), null, "test"),
    (e: unknown) => (e as { code: string }).code === "PRICE_CHANGED",
  );
});
test("invalidating a source reward cancels its unpaid reservation without consuming the voucher", async () => {
  const user = await customer();
  for (let i = 4; i > 0; i--)
    await db.activeDay.create({
      data: {
        userId: user.id,
        day: shiftDay(dayKey(), -i),
        image: "/images/roses.webp",
        productName: "Test",
        sourceGrantId: `fixture-${randomUUID()}`,
      },
    });
  let source = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  await receiveSepay({
    id: randomUUID(),
    transferType: "in",
    transferAmount: source.total,
    accountNumber: "TESTACCOUNT",
    content: source.code,
  });
  source = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(source.status, "CONFIRMED");
  await claimQr(await qr(source), user);
  const reward = await db.reward.findFirstOrThrow({
    where: { userId: user.id, status: "AVAILABLE" },
  });
  const pending = await createOrder(
    input({ rewardId: reward.id }),
    user,
    "test",
  );
  await stopAndRefundOrder(
    source.id,
    source.version,
    "Hoàn đơn nguồn kiểm thử",
    admin,
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: pending.id } })).status,
    "CANCELLED",
  );
  assert.equal(
    (await db.reward.findUniqueOrThrow({ where: { id: reward.id } })).status,
    "REVOKED",
  );
});
test("manual payment validates role, evidence, version, expiry and stopped state", async () => {
  const order = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  const data = {
    version: order.version,
    reference: randomUUID(),
    reason: "Đã đối chiếu ngân hàng",
  };
  await assert.rejects(
    () => confirmOrderPayment(order.id, data, { ...admin, role: "FLORIST" }),
    (e: any) => e.code === "FORBIDDEN",
  );
  await assert.rejects(() =>
    confirmOrderPayment(order.id, { ...data, reference: "" }, admin),
  );
  await assert.rejects(
    () =>
      confirmOrderPayment(
        order.id,
        { ...data, version: order.version + 1 },
        admin,
      ),
    (e: any) => e.code === "STALE_ORDER_VERSION",
  );
  await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => confirmOrderPayment(order.id, data, admin),
    (e: any) => e.code === "ORDER_EXPIRED",
  );
  const stopped = await step(order, "CANCEL");
  await assert.rejects(
    () =>
      confirmOrderPayment(
        order.id,
        { ...data, version: stopped.version },
        admin,
      ),
    (e: any) => e.code === "INVALID_PAYMENT_STATE",
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
      .paymentStatus,
    "UNPAID",
  );
});

test("manual payment retries consume one member benefit and late SePay reconciles once", async () => {
  const user = await customer(true);
  const order = await createOrder(
    input({ paymentMethod: "SEPAY", useMember: true }),
    user,
    "test",
  );
  const reference = randomUUID();
  const data = {
    version: order.version,
    reference,
    reason: "Đã nhận và đối chiếu tiền",
  };
  const results = await Promise.all([
    confirmOrderPayment(order.id, data, admin),
    confirmOrderPayment(order.id, data, admin),
  ]);
  assert.ok(results.every((o) => o.paymentStatus === "PAID"));
  const period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: order.memberPeriodId! },
  });
  assert.equal(period.consumed, 1);
  assert.equal(period.reserved, 0);
  assert.equal(
    await db.audit.count({
      where: { entityId: order.id, action: "order.payment_confirmed" },
    }),
    1,
  );
  const payload = {
    id: randomUUID(),
    referenceCode: reference,
    transferType: "in" as const,
    transferAmount: order.total,
    accountNumber: "TESTACCOUNT",
    content: order.code,
  };
  assert.equal((await receiveSepay(payload)).matched, true);
  assert.equal(
    (await receiveSepay({ ...payload, id: randomUUID() })).duplicate,
    true,
  );
  assert.equal(
    (
      await receiveSepay({
        ...payload,
        id: randomUUID(),
        referenceCode: randomUUID(),
      })
    ).matched,
    false,
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).version,
    order.version + 1,
  );
  assert.equal(
    (await db.memberPeriod.findUniqueOrThrow({ where: { id: period.id } }))
      .consumed,
    1,
  );
  await stopAndRefundOrder(
    order.id,
    results[0].version,
    "Hoàn đơn kiểm thử",
    admin,
  );
});

test("paid orders stop for refund, release reservations once, and settle only after reconciliation", async () => {
  const user = await customer(true);
  let order = await createOrder(
    input({ paymentMethod: "SEPAY", useMember: true }),
    user,
    "test",
  );
  order = await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã thực nhận đủ tiền",
    },
    admin,
  );
  assert.equal(order.status, "CONFIRMED");
  await assert.rejects(
    () => step(order, "CANCEL"),
    (e: any) => e.code === "USE_REFUND",
  );
  assert.ok(!orderActions(order, "OWNER").some((a) => a.value === "CANCEL"));
  assert.ok(
    orderActions(order, "OWNER").some((a) => a.value === "REQUEST_REFUND"),
  );
  await assert.rejects(
    () =>
      stopAndRefundOrder(order.id, order.version, "Hoàn đơn kiểm thử", {
        ...admin,
        role: "ACCOUNTANT",
      }),
    (e: any) => e.code === "FORBIDDEN",
  );
  await assert.rejects(
    () =>
      stopAndRefundOrder(
        order.id,
        order.version + 1,
        "Hoàn đơn kiểm thử",
        admin,
      ),
    (e: any) => e.code === "STALE_ORDER_VERSION",
  );
  const before = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const stopped = await stopAndRefundOrder(
    order.id,
    order.version,
    "Khách đề nghị hoàn toàn bộ",
    admin,
  );
  assert.equal(stopped.status, "REFUND_PENDING");
  assert.equal(stopped.paymentStatus, "PAID");
  assert.equal(stopped.stockState, "RELEASED");
  assert.equal(orderLane(stopped), "REFUND");
  const replay = await stopAndRefundOrder(
    order.id,
    order.version,
    "Khách đề nghị hoàn toàn bộ",
    admin,
  );
  assert.equal(replay.version, stopped.version);
  const after = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(after.stock, before.stock);
  assert.equal(after.reserved, before.reserved - 1);
  const period = await db.memberPeriod.findUniqueOrThrow({
    where: { id: order.memberPeriodId! },
  });
  assert.equal(period.consumed, 0);
  assert.equal(period.reserved, 0);
  await assert.rejects(
    () => step(stopped, "PREPARE"),
    (e: any) => e.code === "INVALID_TRANSITION",
  );
  const token = await qr(order);
  await assert.rejects(() => claimQr(token, user));
  const refunds = await db.refund.findMany({ where: { orderId: order.id } });
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount, order.total);
  await assert.rejects(() => completeOrderRefund(refunds[0].id, "", admin));
  const completed = await completeOrderRefund(
    refunds[0].id,
    randomUUID(),
    admin,
  );
  assert.equal(completed.status, "COMPLETED");
  const settled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(settled.status, "REFUNDED");
  assert.equal(settled.paymentStatus, "REFUNDED");
  await completeOrderRefund(refunds[0].id, randomUUID(), admin);
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).version,
    settled.version,
  );
  await assert.rejects(() =>
    requestOrderRefund(
      order.id,
      { version: settled.version, amount: 1, reason: "Hoàn quá số tiền" },
      admin,
    ),
  );
});

test("refund allocation preserves remaining merchandise and concurrent requests cannot over-refund", async () => {
  let order = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  order = await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã thực nhận đủ tiền",
    },
    admin,
  );
  await assert.rejects(
    () =>
      requestOrderRefund(
        order.id,
        {
          version: order.version,
          amount: 100000,
          merchandiseAmount: 0,
          reason: "Phân bổ vượt tiền giao",
        },
        admin,
      ),
    (e: any) => e.code === "INVALID_REFUND_ALLOCATION",
  );
  const results = await Promise.allSettled([
    requestOrderRefund(
      order.id,
      {
        version: order.version,
        amount: 300000,
        reason: "Hoàn một phần tiền hoa",
      },
      admin,
    ),
    requestOrderRefund(
      order.id,
      { version: order.version, amount: 300000, reason: "Hoàn trùng tiền hoa" },
      admin,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db.refund.aggregate({
        where: { orderId: order.id },
        _sum: { amount: true },
      })
    )._sum.amount,
    300000,
  );
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(fresh.status, "CONFIRMED");
  assert.equal(fresh.paymentStatus, "PAID");
  await stopAndRefundOrder(
    order.id,
    fresh.version,
    "Hoàn số tiền còn lại",
    admin,
  );
  const refunds = await db.refund.findMany({ where: { orderId: order.id } });
  assert.equal(
    refunds.reduce((s, r) => s + r.amount, 0),
    order.total,
  );
  for (const r of refunds) await completeOrderRefund(r.id, randomUUID(), admin);
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
      .paymentStatus,
    "REFUNDED",
  );
});

test("partial refunds before delivery preserve payment status and award net member spend", async () => {
  const user = await customer(true);
  let order = await createOrder(
    input({ items: [{ variantId, quantity: 4 }] }),
    user,
    "test",
  );
  order = await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã thu tiền mặt sớm",
    },
    admin,
  );
  const refund = await requestOrderRefund(
    order.id,
    {
      version: order.version,
      amount: 500000,
      merchandiseAmount: 500000,
      reason: "Điều chỉnh một phần hoa",
    },
    admin,
  );
  await completeOrderRefund(refund.id, randomUUID(), admin);
  order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(order.paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(orderLane(order), "UNASSIGNED");
  const done = await delivered(order);
  assert.equal(done.paymentStatus, "PARTIALLY_REFUNDED");
  const sum = await db.membershipSpendLedger.aggregate({
    where: { orderId: order.id },
    _sum: { amount: true },
  });
  assert.equal(sum._sum.amount, 1500000);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).tier,
    "Member",
  );
  assert.equal(orderLane(done), "REFUND");
});

test("refund of delivered flowers preserves consumed stock and reverses earned member spend", async () => {
  const user = await customer(true);
  const order = await delivered(
    await createOrder(
      input({ items: [{ variantId, quantity: 4 }] }),
      user,
      "test",
    ),
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).tier,
    "Bloom",
  );
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  await stopAndRefundOrder(
    order.id,
    order.version,
    "Hoàn đơn sau khi đã giao",
    admin,
  );
  const refund = await db.refund.findFirstOrThrow({
    where: { orderId: order.id },
  });
  await completeOrderRefund(refund.id, randomUUID(), admin);
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  const after = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(fresh.stockState, "CONSUMED");
  assert.equal(after.stock, stock.stock);
  assert.equal(after.reserved, stock.reserved);
  assert.equal(
    (
      await db.membershipSpendLedger.aggregate({
        where: { orderId: order.id },
        _sum: { amount: true },
      })
    )._sum.amount,
    0,
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).tier,
    "Member",
  );
});

test("Kanban lanes distinguish unpaid cancellation, active partial refund and stopped refunds", () => {
  const base = {
    status: "PENDING",
    fulfillment: "UNASSIGNED",
    paymentStatus: "UNPAID",
    paymentMethod: "SEPAY",
  };
  assert.equal(orderLane({ ...base, status: "CANCELLED" }), "CANCELLED");
  assert.equal(
    orderLane({ ...base, status: "CANCELLED", paymentStatus: "PAID" }),
    "REFUND",
  );
  assert.equal(
    orderLane({ ...base, status: "REFUND_PENDING", paymentStatus: "PAID" }),
    "REFUND",
  );
  assert.equal(
    orderLane({ ...base, status: "REFUNDED", paymentStatus: "REFUNDED" }),
    "REFUND",
  );
  assert.equal(
    orderLane({
      ...base,
      status: "CONFIRMED",
      fulfillment: "PREPARING",
      paymentStatus: "PARTIALLY_REFUNDED",
    }),
    "PREPARING",
  );
  assert.equal(
    orderLane({
      ...base,
      status: "COMPLETED",
      fulfillment: "DELIVERED",
      paymentStatus: "PARTIALLY_REFUNDED",
    }),
    "REFUND",
  );
  assert.deepEqual(
    orderActions(
      { ...base, status: "REFUND_PENDING", paymentStatus: "PAID" },
      "OWNER",
    ),
    [],
  );
});

test("delivered COD stays unpaid, consumes stock once and awards spend only after receipt", async () => {
  const user = await customer(true);
  let order = await createOrder(input(), user, "test");
  const before = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  for (const action of ["CONFIRM", "PREPARE", "READY", "DISPATCH", "DELIVER"])
    order = await step(order, action);
  assert.equal(order.paymentStatus, "UNPAID");
  assert.ok(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .eligibleAt,
  );
  assert.equal(
    await db.membershipSpendLedger.count({ where: { orderId: order.id } }),
    0,
  );
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(stock.stock, before.stock - 1);
  assert.equal(stock.reserved, before.reserved - 1);
  await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã xác minh thu tiền",
    },
    admin,
  );
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .stock,
    stock.stock,
  );
  assert.equal(
    await db.membershipSpendLedger.count({ where: { orderId: order.id } }),
    1,
  );
});

test("manual order creation supports delivered but unpaid COD with a receivable", async () => {
  const raw = {
    ...input({ deliveryDay: dayKey() }),
    source: "ZALO",
    initialStage: "DELIVERED",
    initialPayment: "UNPAID",
  };
  const q = await quoteAdminOrder(raw, admin);
  const order = await createAdminOrder(
    { ...raw, expectedTotal: q.total },
    admin,
  );
  assert.equal(order.fulfillment, "DELIVERED");
  assert.equal(order.paymentStatus, "UNPAID");
  assert.equal(
    (await db.codReceivable.findUniqueOrThrow({ where: { orderId: order.id } }))
      .amount,
    q.total,
  );
});

test("only order creators can create channel sales; invalid initial payment states leave no order", async () => {
  const raw = {
    ...input(),
    source: "ZALO",
    initialStage: "PENDING",
    initialPayment: "UNPAID",
    expectedTotal: 530000,
    buyerEmail: "",
  };
  for (const role of [
    "FLORIST",
    "DELIVERY",
    "ACCOUNTANT",
    "MARKETING",
    "CUSTOMER",
  ])
    await assert.rejects(
      () => createAdminOrder(raw, { ...admin, role }),
      (e: any) => e.code === "FORBIDDEN",
    );
  await assert.rejects(
    () => createAdminOrder({ ...raw, initialPayment: "PAID" }, admin),
    (e: any) => e.code === "PAYMENT_EVIDENCE_REQUIRED",
  );
  await assert.rejects(
    () => createAdminOrder({ ...raw, expectedTotal: undefined }, admin),
    (e: any) => e.code === "QUOTE_REQUIRED",
  );
  assert.equal(
    await db.order.count({ where: { idempotencyKey: raw.idempotencyKey } }),
    0,
  );
});

test("admin automatically quotes without buyer contact, proof or an idempotency key", async () => {
  const raw = input({ paymentMethod: "SEPAY" });
  const q = await quoteAdminOrder(
    {
      items: raw.items,
      zoneId: raw.zoneId,
      deliveryDay: raw.deliveryDay,
      slotId: raw.slotId,
      paymentMethod: raw.paymentMethod,
      initialStage: "PREPARING",
    },
    admin,
  );
  assert.equal(q.total, 530000);
  assert.equal(
    await db.order.count({ where: { idempotencyKey: raw.idempotencyKey } }),
    0,
  );
  await assert.rejects(
    () => quoteAdminOrder({ ...raw, voucherCode: "DOESNOTEXIST" }, admin),
    (e: any) => e.code === "VOUCHER_UNAVAILABLE",
  );
});

async function onlineManual(stage = "PENDING", terms?: number | null) {
  const raw = {
    ...input({
      paymentMethod: "SEPAY",
      deliveryDay: stage === "DELIVERED" ? dayKey() : shiftDay(dayKey(), 1),
    }),
    source: "FACEBOOK",
    initialStage: stage,
    initialPayment: "UNPAID",
    paymentTermMinutes: terms,
  };
  const q = await quoteAdminOrder(raw, admin);
  return createAdminOrder({ ...raw, expectedTotal: q.total }, admin);
}

test("all manual SePay stages are available while unpaid, with independent payment terms and stock", async () => {
  for (const stage of [
    "PENDING",
    "CONFIRMED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ]) {
    const before = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const order = await onlineManual(stage);
    assert.equal(order.manualPayment, true);
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(
      order.fulfillment,
      stage === "PENDING" || stage === "CONFIRMED" ? "UNASSIGNED" : stage,
    );
    assert.ok(
      Math.abs(
        order.paymentDueAt!.getTime() - order.createdAt.getTime() - 86400000,
      ) < 10000,
    );
    const qr = await getOrderPaymentQr(admin, order.id);
    assert.ok(qr.url);
    assert.equal(qr.code, order.code);
    assert.equal(qr.deadline, order.paymentDueAt!.toISOString());
    const grant = await db.qrGrant.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    assert.equal(
      !!grant.eligibleAt,
      stage === "DELIVERED",
      "Unpaid confirmation must not unlock the streak QR",
    );
    const stock = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    assert.equal(stock.stock, before.stock - (stage === "DELIVERED" ? 1 : 0));
  }
});

test("overdue manual payment keeps production and reservations; late transfers require review and can be verified manually", async () => {
  const reference = `LATE-${randomUUID()}`;
  let order = await onlineManual();
  order = await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(0), paymentDueAt: new Date(0) },
  });
  await expireReservations();
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    "PENDING",
  );
  assert.equal(isOrderExpired(order), false);
  assert.equal(isPaymentOverdue(order), true);
  assert.equal((await getOrderPaymentQr(admin, order.id)).url, null);
  const incoming = await receiveSepay({
    id: `late-manual-${randomUUID()}`,
    referenceCode: reference,
    accountNumber: "TESTACCOUNT",
    content: order.code,
    transferAmount: order.total,
    transferType: "in",
  });
  assert.equal(incoming.matched, false);
  order = await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference,
      reason: "Đã đối soát chuyển muộn đúng tiền",
    },
    admin,
  );
  assert.equal(order.paymentStatus, "PAID");
  assert.equal(
    (
      await db.payment.findFirstOrThrow({
        where: { orderId: order.id, reference },
      })
    ).state,
    "MATCHED",
  );
});

test("unlimited manual payment matches long after reservation time; webhook replay does not pay twice", async () => {
  let order = await onlineManual("PREPARING", null);
  assert.equal(order.paymentDueAt, null);
  assert.equal(paymentDeadlineIso(order), undefined);
  order = await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(0) },
  });
  assert.ok((await getOrderPaymentQr(admin, order.id)).url);
  const incoming = {
    id: `unlimited-${randomUUID()}`,
    accountNumber: "TESTACCOUNT",
    content: order.code,
    transferAmount: order.total,
    transferType: "in" as const,
  };
  assert.equal((await receiveSepay(incoming)).matched, true);
  assert.equal((await receiveSepay(incoming)).duplicate, true);
  assert.equal(
    await db.payment.count({ where: { providerId: String(incoming.id) } }),
    1,
  );
  const done = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(done.fulfillment, "PREPARING");
  assert.equal(done.paymentStatus, "PAID");
  assert.ok(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .eligibleAt,
  );
});

test("SePay automatically queues paid website and manual pending orders and preserves every advanced stage", async () => {
  const website = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  const cases = [website];
  for (const stage of [
    "PENDING",
    "CONFIRMED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ])
    cases.push(await onlineManual(stage));
  for (const order of cases) {
    const event = {
      id: `auto-queue-${randomUUID()}`,
      transferType: "in" as const,
      accountNumber: "TESTACCOUNT",
      transferAmount: order.total,
      content: order.code,
    };
    assert.equal((await receiveSepay(event)).matched, true);
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(
      paid.status,
      order.status === "PENDING" ? "CONFIRMED" : order.status,
    );
    assert.equal(paid.fulfillment, order.fulfillment);
    assert.equal(
      orderLane(paid),
      order.status === "PENDING" ? "UNASSIGNED" : orderLane(order),
    );
    assert.equal(paid.version, order.version + 1);
    assert.equal(
      await db.orderHistory.count({
        where: {
          orderId: order.id,
          text: { startsWith: "Tự động xác nhận đơn sau thanh toán" },
        },
      }),
      order.status === "PENDING" ? 1 : 0,
    );
    assert.equal((await receiveSepay(event)).duplicate, true);
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: order.id } })).version,
      paid.version,
    );
  }
});

test("manual confirmation also queues new paid orders once and never moves prepared orders backwards", async () => {
  const website = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    null,
    "test",
  );
  const offline = await onlineManual();
  const preparing = await onlineManual("PREPARING");
  for (const order of [website, offline, preparing]) {
    const proof = {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã đối soát đủ tiền để xác nhận đơn",
    };
    const [a, b] = await Promise.all([
      confirmOrderPayment(order.id, proof, admin),
      confirmOrderPayment(order.id, proof, { ...admin, role: "ACCOUNTANT" }),
    ]);
    assert.equal(a.status, "CONFIRMED");
    assert.equal(b.status, "CONFIRMED");
    assert.equal(a.fulfillment, order.fulfillment);
    assert.equal(a.version, order.version + 1);
    assert.equal(
      orderLane(a),
      order.fulfillment === "PREPARING" ? "PREPARING" : "UNASSIGNED",
    );
    assert.equal(
      await db.audit.count({
        where: { entityId: order.id, action: "order.payment_confirmed" },
      }),
      1,
    );
  }
});

test("automatic confirmation honors the configured streak QR delivery trigger", async () => {
  const settings = await getSettings();
  try {
    await db.setting.update({
      where: { key: "shop" },
      data: { value: { ...settings, qrTrigger: "DELIVERED" } },
    });
    let order = await createOrder(
      input({ paymentMethod: "SEPAY" }),
      null,
      "test",
    );
    await receiveSepay({
      id: randomUUID(),
      transferType: "in",
      accountNumber: "TESTACCOUNT",
      transferAmount: order.total,
      content: order.code,
    });
    order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(order.status, "CONFIRMED");
    assert.equal(orderLane(order), "UNASSIGNED");
    assert.equal(
      (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
        .eligibleAt,
      null,
    );
    order = await delivered(order);
    assert.ok(
      (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
        .eligibleAt,
    );
  } finally {
    await db.setting.update({
      where: { key: "shop" },
      data: { value: settings },
    });
  }
});

test("website checkout cannot forge unlimited manual terms or prepare an unpaid SePay order", async () => {
  const forged = {
    ...input({ paymentMethod: "SEPAY" }),
    manualPayment: true,
    paymentDueAt: null,
    source: "FACEBOOK",
    createdBy: admin.id,
  };
  const order = await createOrder(forged, null, "test");
  assert.equal(order.manualPayment, false);
  assert.equal(order.source, "WEBSITE");
  assert.ok(
    Math.abs(
      order.expiresAt.getTime() - order.createdAt.getTime() - 15 * 60000,
    ) < 10000,
  );
  await assert.rejects(
    () => step(order, "CONFIRM"),
    (e: any) => e.code === "INVALID_TRANSITION",
  );
  await step(order, "CANCEL");
});

test("late payment after manual delivery records member spend once without consuming stock twice", async () => {
  const user = await customer(true);
  const raw = {
    ...input({ paymentMethod: "SEPAY", deliveryDay: dayKey() }),
    customerId: user.id,
    source: "INSTAGRAM",
    initialStage: "DELIVERED",
    initialPayment: "UNPAID",
  };
  const q = await quoteAdminOrder(raw, admin);
  const order = await createAdminOrder(
    { ...raw, expectedTotal: q.total },
    admin,
  );
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(
    await db.membershipSpendLedger.count({ where: { orderId: order.id } }),
    0,
  );
  const incoming = {
    id: `after-delivery-${randomUUID()}`,
    accountNumber: "TESTACCOUNT",
    transferType: "in" as const,
    transferAmount: order.total,
    content: order.code,
  };
  assert.equal((await receiveSepay(incoming)).matched, true);
  assert.equal((await receiveSepay(incoming)).duplicate, true);
  assert.equal(
    await db.membershipSpendLedger.count({ where: { orderId: order.id } }),
    1,
  );
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .stock,
    stock.stock,
  );
});

test("admin can renew or remove a manual deadline, with version, role and paid-state guards", async () => {
  let order = await onlineManual("READY", 15);
  await assert.rejects(
    () =>
      setOrderPaymentTerms({ ...admin, role: "DELIVERY" }, order.id, {
        version: order.version,
        minutes: null,
        reason: "Thử bỏ hạn",
      }),
    (e: any) => e.code === "FORBIDDEN",
  );
  await setOrderPaymentTerms(admin, order.id, {
    version: order.version,
    minutes: null,
    reason: "Khách chờ xác nhận từ công ty",
  });
  await assert.rejects(
    () =>
      setOrderPaymentTerms(admin, order.id, {
        version: order.version,
        minutes: 1440,
        reason: "Gia hạn thanh toán",
      }),
    (e: any) => e.code === "STALE_ORDER_VERSION",
  );
  order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(order.paymentDueAt, null);
  await setOrderPaymentTerms(admin, order.id, {
    version: order.version,
    minutes: 1440,
    reason: "Chốt thời hạn cùng khách",
  });
  order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.ok(order.paymentDueAt! > new Date());
  await confirmOrderPayment(
    order.id,
    {
      version: order.version,
      reference: randomUUID(),
      reason: "Đã nhận đủ tiền từ khách",
    },
    admin,
  );
  order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  await assert.rejects(
    () =>
      setOrderPaymentTerms(admin, order.id, {
        version: order.version,
        minutes: null,
        reason: "Không được sửa đơn đã trả",
      }),
    (e: any) => e.code === "PAYMENT_TERMS_LOCKED",
  );
});

test("public tracking normalizes codes and returns progress without personal or financial internals", async () => {
  const order = await onlineManual("OUT_FOR_DELIVERY");
  const result = await trackOrder({ code: ` ${order.code.toLowerCase()} ` });
  assert.equal(result.code, order.code);
  assert.equal(result.fulfillment, "OUT_FOR_DELIVERY");
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "canPay",
      "code",
      "status",
      "fulfillment",
      "paymentStatus",
      "createdAt",
      "deliveryDay",
      "slotLabel",
      "deliveredAt",
      "expired",
      "paymentOverdue",
      "items",
      "serverNow",
    ].sort(),
  );
  const text = JSON.stringify(result);
  for (const privateValue of [
    order.id,
    order.buyerEmail,
    order.recipientName,
    order.recipientPhone,
    order.address,
    order.guestHash!,
  ])
    assert.ok(!text.includes(privateValue), privateValue);
  assert.ok(!text.includes("variantId"));
  assert.ok(!text.includes("history"));
  assert.ok(!text.includes("paymentQr"));
  await assert.rejects(
    () => trackOrder({ code: "NO-SUCH-ORDER" }),
    (e: any) => e.code === "TRACKING_NOT_FOUND",
  );
  await assert.rejects(
    () => trackOrder({ code: "../../admin" }),
    (e: any) => e.code === "TRACKING_NOT_FOUND",
  );
});

test("public payment provides only transfer instructions and rejects stopped, overdue, COD and paid orders", async () => {
  const order = await onlineManual();
  const data = await trackingPayment({ code: order.code.toLowerCase() });
  assert.deepEqual(
    Object.keys(data).sort(),
    [
      "code",
      "amount",
      "url",
      "bank",
      "accountNumber",
      "accountName",
      "expiresAt",
      "serverNow",
    ].sort(),
  );
  assert.equal(data.amount, order.total);
  assert.equal(new URL(data.url).searchParams.get("des"), order.code);
  assert.equal((await trackOrder({ code: order.code })).canPay, true);
  for (const change of [
    { paymentDueAt: new Date(0) },
    { paymentDueAt: null, status: "CANCELLED" as const },
    { status: "CONFIRMED" as const, paymentStatus: "PAID" as const },
    { paymentStatus: "PENDING" as const, paymentMethod: "COD" as const },
  ]) {
    await db.order.update({ where: { id: order.id }, data: change });
    assert.equal((await trackOrder({ code: order.code })).canPay, false);
    await assert.rejects(
      () => trackingPayment({ code: order.code }),
      (e: any) => e.code === "PAYMENT_QR_UNAVAILABLE",
    );
  }
  await db.order.update({
    where: { id: order.id },
    data: {
      paymentMethod: "SEPAY",
      manualPayment: false,
      status: "PENDING",
      expiresAt: new Date(0),
    },
  });
  assert.equal((await trackOrder({ code: order.code })).canPay, false);
  await assert.rejects(
    () => trackingPayment({ code: order.code }),
    (e: any) => e.code === "PAYMENT_QR_UNAVAILABLE",
  );
});

test("payment QR download uses trusted URL, returns PNG and refuses an expired request", async () => {
  const order = await onlineManual();
  const QRCode = await import("qrcode");
  const sharp = (await import("sharp")).default;
  const source = await QRCode.toBuffer("TEST-BANK-QR");
  const result = await downloadOrderPaymentQr(admin, order.id, async (url) => {
    assert.ok(String(url).startsWith("https://vietqr.app/img?"));
    assert.equal(new URL(String(url)).searchParams.get("des"), order.code);
    return new Response(new Uint8Array(source), {
      headers: { "content-type": "image/png" },
    });
  });
  assert.equal((await sharp(result.png).metadata()).format, "png");
  await db.order.update({
    where: { id: order.id },
    data: { paymentDueAt: new Date(0) },
  });
  await assert.rejects(
    () => downloadOrderPaymentQr(admin, order.id),
    (e: any) => e.code === "PAYMENT_QR_UNAVAILABLE",
  );
});

test("parallel admin channel creation is atomic, idempotent and retains its creator and source", async () => {
  const raw = {
    ...input(),
    source: "FACEBOOK",
    initialStage: "PREPARING",
    initialPayment: "UNPAID",
    buyerEmail: "",
  };
  const q = await quoteAdminOrder(raw, admin);
  const before = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const [one, two] = await Promise.all([
    createAdminOrder({ ...raw, expectedTotal: q.total }, admin),
    createAdminOrder({ ...raw, expectedTotal: q.total }, admin),
  ]);
  assert.equal(one.id, two.id);
  assert.equal(one.source, "FACEBOOK");
  assert.equal(one.createdBy, admin.id);
  assert.equal(one.userId, null);
  assert.equal(one.buyerEmail, "");
  assert.equal(one.status, "CONFIRMED");
  assert.equal(one.fulfillment, "PREPARING");
  assert.equal(one.paymentStatus, "UNPAID");
  assert.equal(orderLane(one), "PREPARING");
  const after = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(after.reserved, before.reserved + 1);
  assert.equal(
    await db.audit.count({
      where: { entityId: one.id, action: "order.admin_created" },
    }),
    1,
  );
  assert.equal(
    await db.outbox.count({
      where: {
        event: "order.created",
        payload: { path: "$.orderId", equals: one.id },
      },
    }),
    1,
  );
  assert.equal(
    await db.outbox.count({
      where: {
        event: "order.status_changed",
        payload: { path: "$.orderId", equals: one.id },
      },
    }),
    0,
  );
  await assert.rejects(
    () =>
      createAdminOrder(
        { ...raw, expectedTotal: q.total },
        { ...admin, id: "different-owner" },
      ),
    (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  await step(one, "CANCEL");
});

test("every admin initial stage shares stock, paid benefits, QR and Kanban workflow", async () => {
  const stages = [
    "PENDING",
    "CONFIRMED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ];
  const channels = ["ZALO", "FACEBOOK", "INSTAGRAM", "IN_STORE"];
  for (const [index, stage] of stages.entries()) {
    const user = await customer(true);
    const raw = {
      ...input({
        paymentMethod: "SEPAY",
        useMember: true,
        deliveryDay: stage === "DELIVERED" ? dayKey() : shiftDay(dayKey(), 1),
      }),
      customerId: user.id,
      source: channels[index % channels.length],
      initialStage: stage,
      initialPayment: "PAID",
      paymentReference: randomUUID(),
      paymentReason: "Đã đối chiếu đủ tiền khách gửi",
    };
    const q = await quoteAdminOrder(raw, admin);
    const before = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const order = await createAdminOrder(
      { ...raw, expectedTotal: q.total },
      admin,
    );
    assert.equal(order.userId, user.id);
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.source, raw.source);
    assert.equal(
      orderLane(order),
      ["PENDING", "CONFIRMED"].includes(stage) ? "UNASSIGNED" : stage,
    );
    assert.equal(
      order.stockState,
      stage === "DELIVERED" ? "CONSUMED" : "RESERVED",
    );
    const stock = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    assert.equal(stock.stock, before.stock - (stage === "DELIVERED" ? 1 : 0));
    assert.equal(
      stock.reserved,
      before.reserved + (stage === "DELIVERED" ? 0 : 1),
    );
    const period = await db.memberPeriod.findUniqueOrThrow({
      where: { id: order.memberPeriodId! },
    });
    assert.equal(period.consumed, 1);
    assert.equal(period.reserved, 0);
    const grant = await db.qrGrant.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    assert.equal(!!grant.eligibleAt, true);
    assert.equal(
      await db.notification.count({
        where: { userId: user.id, url: `/orders/${order.id}` },
      }),
      1,
    );
    if (stage === "DELIVERED")
      assert.equal(
        (
          await db.membershipSpendLedger.findUniqueOrThrow({
            where: { sourceKey: `order:${order.id}` },
          })
        ).amount,
        order.subtotal - order.discount,
      );
    await stopAndRefundOrder(
      order.id,
      order.version,
      "Kết thúc đơn kiểm thử kênh bán",
      admin,
    );
  }
});

test("admin quotation cannot bypass price, inventory or customer validation", async () => {
  const raw = {
    ...input(),
    source: "INSTAGRAM",
    initialStage: "CONFIRMED",
    initialPayment: "UNPAID",
  };
  const q = await quoteAdminOrder(raw, admin);
  await assert.rejects(
    () => createAdminOrder({ ...raw, expectedTotal: q.total - 1 }, admin),
    (e: any) => e.code === "PRICE_CHANGED",
  );
  await assert.rejects(
    () =>
      createAdminOrder(
        { ...raw, expectedTotal: q.total, customerId: admin.id },
        admin,
      ),
    (e: any) => e.code === "CUSTOMER_UNAVAILABLE",
  );
  await assert.rejects(() =>
    createAdminOrder(
      {
        ...raw,
        expectedTotal: q.total,
        items: [{ variantId, quantity: 100000 }],
      },
      admin,
    ),
  );
  assert.equal(
    await db.order.count({ where: { idempotencyKey: raw.idempotencyKey } }),
    0,
  );
});

test("reorder expires only the authorized unpaid source and prepares current stock without creating or reserving a new order", async () => {
  const user = await customer();
  const source = await createOrder(
    input({ paymentMethod: "SEPAY" }),
    user,
    "test",
  );
  await db.order.update({
    where: { id: source.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const before = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const count = await db.order.count();
  await assert.rejects(
    () => prepareReorder(source.id, "someone-else"),
    (e: any) => e.code === "NOT_FOUND",
  );
  const first = await prepareReorder(source.id, user.id);
  const replay = await prepareReorder(source.id, user.id);
  assert.deepEqual(first.items, [{ variantId, quantity: 1 }]);
  assert.deepEqual(replay.items, first.items);
  assert.equal(first.draft.recipientName, source.recipientName);
  assert.equal(first.draft.address, source.address);
  assert.ok(!("discount" in first));
  assert.ok(!("paymentQr" in first));
  assert.ok(!("idempotencyKey" in first));
  const order = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(order.status, "CANCELLED");
  assert.ok(order.expiredAt);
  assert.equal(isOrderExpired(order), true);
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  assert.equal(stock.reserved, before.reserved - 1);
  assert.equal(stock.stock, before.stock);
  assert.equal(await db.order.count(), count);
  assert.equal(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: source.id } }))
      .revoked,
    true,
  );
});

test("reorder retains guest ownership and reports discontinued or short stock", async () => {
  const guest = randomUUID();
  const source = await createOrder(input(), null, hash(guest));
  await assert.rejects(
    () => prepareReorder(source.id, undefined, guest),
    (e: any) => e.code === "ORDER_NOT_EXPIRED",
  );
  await db.order.update({
    where: { id: source.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const v = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  await db.product.update({
    where: { id: v.productId },
    data: { active: false },
  });
  try {
    const result = await prepareReorder(source.id, undefined, guest);
    assert.equal(result.items.length, 0);
    assert.match(result.notices[0], /ngừng bán/);
    await assert.rejects(
      () => prepareReorder(source.id, undefined, "wrong-cookie"),
      (e: any) => e.code === "NOT_FOUND",
    );
  } finally {
    await db.product.update({
      where: { id: v.productId },
      data: { active: true },
    });
  }
  const fresh = await createOrder(input(), null, "test");
  const cancelled = await step(fresh, "CANCEL");
  assert.equal(isOrderExpired(cancelled), false);
  await assert.rejects(
    () => prepareReorder(fresh.id, undefined, "test"),
    (e: any) => e.code === "NOT_FOUND",
  );
});

test("deadline and expiry distinguish paid orders, manual cancellation and overdue reservations", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const base = {
    status: "PENDING",
    paymentStatus: "UNPAID",
    expiresAt: new Date(now - 1),
  };
  assert.equal(isOrderExpired(base, now), true);
  assert.equal(isOrderExpired({ ...base, paymentStatus: "PAID" }, now), false);
  assert.equal(isOrderExpired({ ...base, status: "CANCELLED" }, now), false);
  assert.equal(
    isOrderExpired(
      { ...base, status: "CANCELLED", expiredAt: new Date(now) },
      now,
    ),
    true,
  );
  assert.equal(deadlineSeconds("2026-11-14T10:00:01.001Z", now), 2);
  assert.equal(deadlineSeconds("2026-11-14T09:59:00.000Z", now), 0);
  assert.equal(formatCountdown(65), "01:05");
  assert.equal(formatCountdown(3661), "01:01:01");
});
test("an overdue COD reservation cannot be confirmed before the expiry worker runs", async () => {
  const order = await createOrder(input(), null, "test");
  const overdue = await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => step(overdue, "CONFIRM"),
    (e: any) => e.code === "ORDER_EXPIRED",
  );
  assert.deepEqual(
    orderActions(overdue, "OWNER").map((a) => a.value),
    ["CANCEL"],
  );
  const cancelled = await step(overdue, "CANCEL");
  assert.equal(isOrderExpired(cancelled), true);
  assert.ok(cancelled.expiredAt);
});

test("automatic checkout pricing works before contact entry and never reserves stock, slots or member quota", async () => {
  const user = await customer(true);
  const data = checkoutQuoteSchema.parse(input({ useMember: true }));
  assert.equal("buyerName" in data, false);
  assert.equal("buyerEmail" in data, false);
  assert.equal("idempotencyKey" in data, false);
  assert.equal(
    checkoutSchema.safeParse(data).success,
    false,
    "Creating an order must still require full customer details",
  );
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const bookings = await db.slotBooking.findUnique({
    where: { day_slotId: { day: data.deliveryDay, slotId: data.slotId } },
  });
  const q = await quote(data, user);
  assert.ok(q.discount > 0);
  assert.equal(q.total, q.subtotal - q.discount + q.deliveryFee);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .reserved,
    stock.reserved,
  );
  assert.equal(
    (
      await db.slotBooking.findUnique({
        where: { day_slotId: { day: data.deliveryDay, slotId: data.slotId } },
      })
    )?.count,
    bookings?.count,
  );
  assert.equal(await db.memberPeriod.count({ where: { userId: user.id } }), 0);
  await assert.rejects(
    () => quote(data, null),
    (e: any) => e.code === "NOT_MEMBER",
  );
  assert.equal(
    checkoutQuoteSchema.safeParse({
      ...data,
      items: [{ variantId, quantity: 0 }],
    }).success,
    false,
  );
});

test("automatic voucher quotes return fresh totals and invalid codes fail without consuming the voucher", async () => {
  const voucher = await db.voucher.create({
    data: {
      code: `AUTO${randomUUID().slice(0, 8).toUpperCase()}`,
      title: "Ưu đãi tự động",
      percent: 10,
      cap: 100000,
      minimum: 0,
      limit: 5,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  try {
    const data = checkoutQuoteSchema.parse(
      input({ voucherCode: voucher.code }),
    );
    const discounted = await quote(data, null);
    assert.equal(discounted.discount, 50000);
    assert.equal(discounted.total, 480000);
    await assert.rejects(
      () => quote({ ...data, voucherCode: "UNKNOWN-CODE" }, null),
      (e: any) => e.code === "VOUCHER_UNAVAILABLE",
    );
    const regular = await quote({ ...data, voucherCode: undefined }, null);
    assert.equal(regular.discount, 0);
    assert.equal(regular.total, 530000);
    assert.equal(
      (await db.voucher.findUniqueOrThrow({ where: { id: voucher.id } })).used,
      0,
    );
  } finally {
    await db.voucher.delete({ where: { id: voucher.id } });
  }
});

test("card writing selection is validated, stored and retained when reordering", async () => {
  const user = await customer();
  const data = input({
    cardWritingMode: "HANDWRITTEN",
    cardMessage: "Cửa hàng viết tay lời chúc này",
  });
  assert.equal(
    checkoutSchema.parse({ ...data, cardWritingMode: undefined })
      .cardWritingMode,
    "AUTO",
  );
  assert.equal(
    checkoutSchema.safeParse({ ...data, cardWritingMode: "INVALID" }).success,
    false,
  );
  const order = await createOrder(data, user, "test");
  assert.equal(order.cardWritingMode, "HANDWRITTEN");
  assert.equal(order.cardMessage, data.cardMessage);
  await db.order.update({
    where: { id: order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const reorder = await prepareReorder(order.id, user.id);
  assert.equal(reorder.draft.cardWritingMode, "HANDWRITTEN");
  assert.equal(reorder.draft.cardMessage, data.cardMessage);
});

test("analytics purchase is consent-bound, pseudonymous and queued once", async () => {
  const previous = process.env.POSTHOG_KEY;
  process.env.POSTHOG_KEY = "test-project-token";
  try {
    const user = await customer();
    const order = await createOrder(input(), user, "test", {
      analyticsClientId: randomUUID(),
    });
    await delivered(order);
    const event = await db.outbox.findUniqueOrThrow({
      where: { id: `analytics:purchase:${order.id}` },
    });
    const text = JSON.stringify(event.payload);
    assert.ok(!text.includes(user.email));
    assert.ok(!text.includes("0900000000"));
    assert.ok(!text.includes("Địa chỉ giả lập"));
    assert.notEqual((event.payload as { userId: string }).userId, user.id);
    assert.equal(await db.outbox.count({ where: { id: event.id } }), 1);
  } finally {
    if (previous === undefined) delete process.env.POSTHOG_KEY;
    else process.env.POSTHOG_KEY = previous;
  }
});
test("analytics retries only a failed vendor without resending successful GA4 events", async () => {
  const originalFetch = globalThis.fetch;
  const oldGA = process.env.GA4_MEASUREMENT_ID,
    oldSecret = process.env.GA4_API_SECRET,
    oldPH = process.env.POSTHOG_KEY;
  process.env.GA4_MEASUREMENT_ID = "G-TEST";
  process.env.GA4_API_SECRET = "fake-test-secret";
  process.env.POSTHOG_KEY = "fake-test-key";
  const calls: string[] = [];
  let failPosthog = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return new Response(null, {
      status: url.includes("posthog") && failPosthog ? 500 : 204,
    });
  }) as typeof fetch;
  try {
    const first = await sendAnalytics({
      clientId: randomUUID(),
      eventId: randomUUID(),
      name: "page_view",
      params: { page_path: "/" },
      timestamp: new Date().toISOString(),
    });
    assert.equal(first.complete, false);
    assert.deepEqual(first.packet.delivered, ["ga4"]);
    failPosthog = false;
    const second = await sendAnalytics(first.packet);
    assert.equal(second.complete, true);
    assert.equal(calls.filter((v) => v.includes("google-analytics")).length, 1);
    assert.equal(calls.filter((v) => v.includes("posthog")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["GA4_MEASUREMENT_ID", oldGA],
      ["GA4_API_SECRET", oldSecret],
      ["POSTHOG_KEY", oldPH],
    ])
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
  }
});

test("delivered reorder prepares a fresh purchase without changing the completed order, stock, money or rewards", async () => {
  const user = await customer();
  const order = await delivered(await createOrder(input(), user, "test"));
  const snapshot = await db.order.findUniqueOrThrow({
    where: { id: order.id },
  });
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  const count = await db.order.count();
  const grant = await db.qrGrant.findUnique({ where: { orderId: order.id } });
  const result = await prepareReorder(order.id, user.id);
  assert.deepEqual(result.items, [{ variantId, quantity: 1 }]);
  assert.equal(result.draft.recipientName, order.recipientName);
  assert.deepEqual(
    await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    snapshot,
  );
  assert.deepEqual(
    await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }),
    stock,
  );
  assert.deepEqual(
    await db.qrGrant.findUnique({ where: { orderId: order.id } }),
    grant,
  );
  assert.equal(await db.order.count(), count);
  await assert.rejects(
    () => prepareReorder(order.id, "another-buyer"),
    (e: any) => e.code === "NOT_FOUND",
  );
});

test("reviews require the delivered order's buyer and an actually purchased product, and reject duplicate races", async () => {
  const user = await customer(),
    other = await customer();
  const order = await createOrder(input(), user, "test");
  const productId = (
    await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })
  ).productId;
  const payload = {
    productId,
    rating: 4,
    body: "Bó hoa rất đẹp, giao đúng giờ đã hẹn.",
  };
  assert.equal(
    (await orderReviewOptions(order.id, { userId: user.id })).canReview,
    false,
  );
  await assert.rejects(
    () => createOrderReview(order.id, payload, { userId: user.id }),
    (e: any) => e.code === "NOT_DELIVERED",
  );
  await delivered(order);
  await assert.rejects(
    () => orderReviewOptions(order.id, { userId: other.id }),
    (e: any) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => createOrderReview(order.id, payload, { userId: other.id }),
    (e: any) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () =>
      createOrderReview(
        order.id,
        { ...payload, productId: "unrelated-product" },
        { userId: user.id },
      ),
    (e: any) => e.code === "NOT_PURCHASED",
  );
  await assert.rejects(() =>
    createOrderReview(order.id, { ...payload, rating: 6 }, { userId: user.id }),
  );
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      createOrderReview(order.id, payload, {
        userId: user.id,
        name: user.name,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "REVIEW_EXISTS",
  );
  const rows = await db.review.findMany({ where: { orderId: order.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PENDING");
  assert.equal(
    (await buyerProductReviews(user.id, productId)).filter(
      (r) => r.orderId === order.id,
    ).length,
    1,
  );
  const options = await orderReviewOptions(order.id, { userId: user.id });
  assert.equal(options.products[0].review?.id, rows[0].id);
  assert.deepEqual(
    Object.keys(options).sort(),
    ["code", "canReview", "products"].sort(),
  );
  const payloads = await db.outbox.findMany({
    where: { event: "review.created" },
  });
  assert.equal(
    payloads.filter((event) => (event.payload as any).reviewId === rows[0].id)
      .length,
    1,
  );
});

test("a guest's verified order cookie can review delivered COD before collection, but not a refunded order", async () => {
  const guest = randomUUID();
  let order = await createOrder(input(), null, hash(guest));
  for (const action of ["CONFIRM", "PREPARE", "READY", "DISPATCH", "DELIVER"])
    order = await step(order, action);
  assert.equal(order.paymentStatus, "UNPAID");
  const productId = (
    await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })
  ).productId;
  const payload = {
    productId,
    rating: 5,
    body: "Hoa nhận được rất xinh, cảm ơn cửa hàng.",
  };
  await assert.rejects(
    () => createOrderReview(order.id, payload, { guestToken: "wrong-cookie" }),
    (e: any) => e.code === "NOT_FOUND",
  );
  const review = await createOrderReview(order.id, payload, {
    guestToken: guest,
  });
  assert.equal(
    (await orderReviewOptions(order.id, { guestToken: guest })).products[0]
      .review?.id,
    review.id,
  );
  await db.order.update({
    where: { id: order.id },
    data: { status: "REFUNDED" },
  });
  assert.equal(
    (await orderReviewOptions(order.id, { guestToken: guest })).canReview,
    false,
  );
  await assert.rejects(
    () => createOrderReview(order.id, payload, { guestToken: guest }),
    (e: any) => e.code === "NOT_DELIVERED",
  );
});

test("public reviews publish only moderated purchase details and the full approved average without private order data", async () => {
  const product = await db.product.create({
    data: {
      name: "Hoa dành cho review",
      slug: `review-${randomUUID()}`,
      subtitle: "Review",
      description: "Review",
      category: "Review",
      occasion: "Review",
      color: "Review",
      image: "/images/roses.webp",
      images: [],
      variants: {
        create: [
          { name: "M", sku: randomUUID(), price: 500000, stock: 100 },
          { name: "L", sku: randomUUID(), price: 700000, stock: 100 },
        ],
      },
    },
    include: { variants: true },
  });
  const user = await customer();
  const order = await delivered(
    await createOrder(
      input({
        items: product.variants.map((v) => ({ variantId: v.id, quantity: 1 })),
      }),
      user,
      "test",
    ),
  );
  const options = await orderReviewOptions(order.id, { userId: user.id });
  assert.equal(options.products.length, 1);
  assert.deepEqual(options.products[0].variants, ["M", "L"]);
  const review = await createOrderReview(
    order.id,
    {
      productId: product.id,
      rating: 4,
      body: "Bó hoa hai kích thước đều được chuẩn bị rất đẹp.",
    },
    { userId: user.id, name: user.name },
  );
  assert.equal((await publicProductReviews(product.id)).total, 0);
  await db.review.update({
    where: { id: review.id },
    data: { status: "APPROVED" },
  });
  const visible = await publicProductReviews(product.id);
  assert.equal(visible.total, 1);
  assert.equal(visible.average, 4);
  assert.deepEqual(visible.reviews[0].product, {
    name: product.name,
    image: product.image,
    variants: ["M", "L"],
  });
  const text = JSON.stringify(visible);
  for (const secret of [
    order.id,
    order.code,
    user.id,
    user.email,
    order.address,
    order.recipientName,
    order.recipientPhone,
  ])
    assert.ok(!text.includes(secret));
  assert.ok(!text.includes("orderId"));
  assert.ok(!text.includes("userId"));
  await db.review.update({
    where: { id: review.id },
    data: { status: "REJECTED" },
  });
  assert.equal((await publicProductReviews(product.id)).total, 0);
});
