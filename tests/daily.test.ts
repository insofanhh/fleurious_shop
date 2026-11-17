import "dotenv/config";
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { db } from "../src/lib/db";
import { atomic } from "../src/lib/transaction";
import { defaultDailyPolicy, dailyPolicySchema } from "../src/lib/daily-types";
import {
  dailyAmounts,
  calendarMonthDays,
  dailyDay,
} from "../src/lib/daily-pricing";
import {
  dailyConfig,
  publishDaily,
  saveDailyOffering,
  quoteDaily,
  createDaily,
  lockDaily,
  expireDailyTx,
  dailyPlanView,
  editDailyDelivery,
  dailyPublic,
  listDaily,
  suggestDailyFlowers,
} from "../src/lib/daily";
import {
  requestDailyRefund,
  completeDailyRefund,
  materializeDailyDelivery,
  dailyMaintenance,
  refundDailyTransfer,
  cancelUnpaidDaily,
} from "../src/lib/daily-operations";
import {
  reconcileDailyPayment,
  confirmDailyPayment,
  dailyFinancialSummary,
} from "../src/lib/daily-finance";
import { receiveSepay, transitionOrder, claimQr } from "../src/lib/commerce";
import { requestOrderRefund } from "../src/lib/order-payments";
import { dailyPreparationCsv } from "../src/lib/daily-export";
import { dailyCalendarMonth } from "../src/lib/daily-calendar";
import {
  getSepayAdminView,
  saveSepaySettings,
  getSepayConfig,
} from "../src/lib/sepay-settings";
import { setupShippingFixture, fixtureShipping } from "./fixtures/shipping";
import { defaultSettings } from "../src/lib/settings";
import { dayKey, shiftDay, localInstant } from "../src/lib/time";
import { decrypt } from "../src/lib/security";

const run = `daily-${randomUUID()}`;
let owner: User,
  buyer: User,
  stranger: User,
  florist: User,
  slotId: string,
  offeringId: string,
  premiumId: string,
  variantId: string;
let originalPolicy: Awaited<ReturnType<typeof db.setting.findUnique>>,
  originalBank: typeof originalPolicy;
const policy = () =>
  dailyPolicySchema.parse({
    ...defaultDailyPolicy,
    enabled: true,
    capacityPerDay: 100,
    campaignBudget: 10000000,
  });
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  originalPolicy = await db.setting.findUnique({
    where: { key: "daily_program" },
  });
  originalBank = await db.setting.findUnique({
    where: { key: "sepay_payment" },
  });
  for (const [key, role] of [
    ["owner", "OWNER"],
    ["buyer", "CUSTOMER"],
    ["stranger", "CUSTOMER"],
    ["florist", "FLORIST"],
  ]) {
    const u = await db.user.create({
      data: {
        name: `${run}-${key}`,
        email: `${run}-${key}@example.test`,
        passwordHash: "test-only",
        verified: true,
        role,
      },
    });
    if (key === "owner") owner = u;
    else if (key === "buyer") buyer = u;
    else if (key === "stranger") stranger = u;
    else florist = u;
  }
  await setupShippingFixture();
  await db.setting.upsert({
    where: { key: "shop" },
    create: { key: "shop", value: defaultSettings },
    update: { value: defaultSettings },
  });
  const bank = await getSepayAdminView(owner);
  await saveSepaySettings(owner, {
    version: bank.version,
    enabled: true,
    bank: "MB",
    accountNumber: "dailytestbank",
    accountName: "Daily Test",
    apiToken: "",
  });
  const p = await db.product.create({
    data: {
      slug: run,
      name: run,
      subtitle: "Mini bouquet",
      description: "Hoa thử nghiệm",
      category: "Hoa mỗi ngày",
      occasion: "Hằng ngày",
      color: "Đỏ",
      image: "/images/roses.webp",
      images: [],
      variants: {
        create: [
          { sku: run, name: "Daily", price: 70000, stock: 10000 },
          {
            sku: `${run}-premium`,
            name: "Daily premium",
            price: 100000,
            stock: 10000,
          },
        ],
      },
    },
    include: { variants: true },
  });
  variantId = p.variants[0].id;
  slotId = (
    await db.deliverySlot.create({
      data: { label: run, startHour: 10, endHour: 12, capacity: 100 },
    })
  ).id;
  await db.setting.upsert({
    where: { key: "daily_program" },
    create: { key: "daily_program", value: { ...policy(), enabled: false } },
    update: { value: { ...policy(), enabled: false } },
  });
  offeringId = (
    await saveDailyOffering(owner, {
      variantId,
      budgetCode: "mini",
      name: "Mini dịu dàng",
      description: "Bó nhỏ thử nghiệm",
      tags: ["hồng", "nhẹ nhàng"],
      premium: 0,
      cost: 20000,
      capacity: 100,
      active: true,
    })
  ).id;
  premiumId = (
    await saveDailyOffering(owner, {
      variantId: p.variants[1].id,
      budgetCode: "mini",
      name: "Mini đặc biệt",
      description: "Bó nâng cấp",
      tags: ["cẩm chướng"],
      premium: 30000,
      cost: 30000,
      capacity: 100,
      active: true,
    })
  ).id;
});
afterEach(async () => {
  if (!slotId) return;
  const plans = await db.dailyPlan.findMany({
      where: { userId: buyer.id },
      select: { id: true },
    }),
    ids = plans.map((p) => p.id),
    orders = await db.order.findMany({
      where: { dailyPlanId: { in: ids } },
      select: { id: true },
    }),
    orderIds = orders.map((o) => o.id);
  const dailyInvoices = await db.dailyInvoice.findMany({
    where: { planId: { in: ids } },
    select: { id: true },
  });
  await db.outbox.deleteMany({
    where: {
      id: { in: dailyInvoices.map((i) => `analytics:daily-purchase:${i.id}`) },
    },
  });
  await db.membershipSpendLedger.deleteMany({
    where: { orderId: { in: orderIds } },
  });
  await db.payment.deleteMany({
    where: { dailyInvoice: { planId: { in: ids } } },
  });
  await db.dailyRefund.deleteMany({ where: { planId: { in: ids } } });
  await db.dailyInvoice.deleteMany({ where: { planId: { in: ids } } });
  await db.dailyDelivery.deleteMany({ where: { planId: { in: ids } } });
  await db.dailyHistory.deleteMany({ where: { planId: { in: ids } } });
  await db.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.qrGrant.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.dailyPlan.deleteMany({ where: { id: { in: ids } } });
  await db.slotBooking.deleteMany({ where: { slotId } });
  await db.productVariant.updateMany({
    where: { sku: { startsWith: run } },
    data: { stock: 10000, reserved: 0 },
  });
  await db.dailyOffering.updateMany({
    where: { id: { in: [offeringId, premiumId] } },
    data: { active: true },
  });
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: policy(), version: { increment: 1 } },
  });
});
after(async () => {
  for (const name of ["daily_program", "sepay_payment"]) {
    const old = name === "daily_program" ? originalPolicy : originalBank;
    if (old)
      await db.setting.upsert({
        where: { key: name },
        create: { ...old, value: old.value as Prisma.InputJsonValue },
        update: {
          value: old.value as Prisma.InputJsonValue,
          version: old.version,
        },
      });
    else await db.setting.deleteMany({ where: { key: name } });
  }
  await db.notification.deleteMany({
    where: { userId: { in: [owner.id, buyer.id, stranger.id, florist.id] } },
  });
  await db.outbox.deleteMany({
    where: { userId: { in: [owner.id, buyer.id, stranger.id, florist.id] } },
  });
  await db.dailyOffering.deleteMany({
    where: { id: { in: [offeringId, premiumId] } },
  });
  await db.productVariant.deleteMany({ where: { sku: { startsWith: run } } });
  await db.product.deleteMany({ where: { slug: run } });
  await db.deliverySlot.deleteMany({ where: { id: slotId } });
  await db.user.deleteMany({
    where: { id: { in: [owner.id, buyer.id, stranger.id, florist.id] } },
  });
  await db.audit.deleteMany({ where: { actorId: owner.id } });
  await db.$disconnect();
});
async function input(n = 1, extra: Record<string, unknown> = {}) {
  return {
    budgetCode: "mini",
    mode: "AUTO",
    days: Array.from({ length: n }, (_, i) => ({
      day: shiftDay(dayKey(), 10 + i),
      slotId,
      writingMode: "AUTO",
    })),
    recipientName: "Người nhận Daily",
    recipientPhone: "0900000000",
    senderName: "Người gửi Daily",
    ...(await fixtureShipping(`user:${buyer.id}`)),
    ...extra,
  };
}
async function buy(n = 1, extra: Record<string, unknown> = {}) {
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: policy() },
  });
  const raw = await input(n, extra),
    q = await quoteDaily(buyer.id, raw);
  const p = await createDaily(buyer, {
    ...raw,
    expectedVersion: q.version,
    expectedTotal: q.total,
    accepted: true,
    idempotencyKey: randomUUID(),
  });
  return p;
}
async function pay(planId: string, extra: Record<string, unknown> = {}) {
  const i = await db.dailyInvoice.findFirstOrThrow({
    where: { planId, kind: "PURCHASE" },
  });
  return receiveSepay({
    id: `${run}-${randomUUID()}`,
    accountNumber: (await getSepayConfig()).accountNumber,
    transferType: "in",
    transferAmount: i.amount,
    content: i.code,
    referenceCode: randomUUID(),
    ...extra,
  });
}
async function ready() {
  const p = await buy(1, {
    mode: "SELF",
    days: [
      { day: shiftDay(dayKey(), 10), slotId, offeringId, writingMode: "AUTO" },
    ],
  });
  await pay(p.id);
  const d = await db.dailyDelivery.findFirstOrThrow({
    where: { planId: p.id },
  });
  return { p, d };
}

test("Daily prices allocate exact discounts across 10/20/30/31 and real calendar months", () => {
  for (const [n, total] of [
    [10, 665000],
    [20, 1288000],
    [30, 1890000],
    [31, 1953000],
  ]) {
    const a = dailyAmounts(
      { ...policy(), pricingMode: "BUDGET" },
      "mini",
      n,
      20000,
      2000,
    );
    assert.equal(a.base * n - a.discount, total);
  }
  assert.equal(calendarMonthDays("2028-02").length, 29);
  assert.equal(calendarMonthDays("2027-02").length, 28);
  assert.equal(calendarMonthDays("2026-12").length, 31);
  assert.throws(() => dailyDay("2026-02-30"));
  assert.equal(dailyAmounts(policy(), "mini", 30, 20000, 2000).subsidy, 20000);
  assert.equal(dailyAmounts(policy(), "mini", 30, 20000, 6000).subsidy, 15000);
});
test("Daily settings enforce roles, monotonic totals and dedicated offering pool", async () => {
  await assert.rejects(
    () => publishDaily(buyer, { version: 1, policy: policy() }),
    { code: "FORBIDDEN" },
  );
  assert.equal(
    dailyPolicySchema.safeParse({
      ...policy(),
      pricingMode: "BUDGET",
      tiers: [{ ...policy().tiers[0], count: 10, percent: 50 }],
    }).success,
    false,
  );
  const cfg = await dailyConfig();
  const saved = await publishDaily(owner, {
    version: cfg.version,
    policy: policy(),
  });
  assert.equal(saved.version, cfg.version + 1);
  await assert.rejects(
    () => publishDaily(owner, { version: cfg.version, policy: policy() }),
    { code: "STALE_VERSION" },
  );
  const pub = await dailyPublic();
  assert.equal(pub.policy.campaignBudget, 0);
  assert(!("cost" in pub.offerings[0]));
});
test("Daily suggestions preserve custom days, exclude unwanted flowers and do not reserve capacity", async () => {
  const raw = await input(10),
    prefs = { colors: [], avoidTags: [], style: "", surprise: false },
    request = {
      days: raw.days,
      offeringIds: [offeringId, premiumId],
      preferences: prefs,
      seed: "stable-daily-seed",
    };
  const before = await Promise.all([
    db.dailyDelivery.count(),
    db.slotBooking.count(),
    db.dailyInvoice.count(),
  ]);
  const suggestions = await suggestDailyFlowers(buyer.id, request);
  assert.equal(suggestions.length, 10);
  assert.deepEqual(await suggestDailyFlowers(buyer.id, request), suggestions);
  assert.equal(
    suggestions.filter((d) => d.offeringId === offeringId).length,
    5,
  );
  assert.equal(suggestions.filter((d) => d.offeringId === premiumId).length, 5);
  const pinned = await suggestDailyFlowers(buyer.id, {
    ...request,
    days: request.days.map((d, i) =>
      i === 0 ? { ...d, offeringId: premiumId } : d,
    ),
  });
  assert.equal(pinned[0].offeringId, premiumId);
  const offering = await db.dailyOffering.findUniqueOrThrow({
    where: { id: premiumId },
  });
  await db.dailyOffering.update({
    where: { id: premiumId },
    data: { tags: ["avoid-this-flower"] },
  });
  try {
    const filtered = await suggestDailyFlowers(buyer.id, {
      ...request,
      preferences: { ...prefs, avoidTags: ["AVOID-THIS-FLOWER"] },
    });
    assert(filtered.every((d) => d.offeringId === offeringId));
    await assert.rejects(
      () =>
        suggestDailyFlowers(buyer.id, {
          ...request,
          days: [{ ...request.days[0], offeringId: premiumId }],
          preferences: { ...prefs, avoidTags: ["avoid-this-flower"] },
        }),
      { code: "DAILY_OFFERING" },
    );
  } finally {
    await db.dailyOffering.update({
      where: { id: premiumId },
      data: { tags: offering.tags as Prisma.InputJsonValue },
    });
  }
  assert.deepEqual(
    await Promise.all([
      db.dailyDelivery.count(),
      db.slotBooking.count(),
      db.dailyInvoice.count(),
    ]),
    before,
  );
});

test("Daily suggestions skip full offerings and reject a sold-out pinned day", async () => {
  const original = await db.dailyOffering.findUniqueOrThrow({
    where: { id: offeringId },
  });
  await db.dailyOffering.update({
    where: { id: offeringId },
    data: { capacity: 1 },
  });
  try {
    const raw = await input(1);
    await buy(1, { mode: "SELF", days: [{ ...raw.days[0], offeringId }] });
    const request = {
      days: raw.days,
      offeringIds: [offeringId, premiumId],
      preferences: { colors: [], avoidTags: [], style: "", surprise: false },
      seed: "capacity-seed",
    };
    assert.equal(
      (await suggestDailyFlowers(buyer.id, request))[0].offeringId,
      premiumId,
    );
    await assert.rejects(
      () =>
        suggestDailyFlowers(buyer.id, {
          ...request,
          days: [{ ...raw.days[0], offeringId }],
        }),
      { code: "DAILY_OFFERING" },
    );
  } finally {
    await db.dailyOffering.update({
      where: { id: offeringId },
      data: { capacity: original.capacity },
    });
  }
});

test("Daily quotes and checkout keep previewed flowers and distinguish automatic suggestions from custom days", async () => {
  const raw = await input(3);
  const preview = await suggestDailyFlowers(buyer.id, {
    days: raw.days,
    offeringIds: [offeringId, premiumId],
    seed: "preview-seed",
    preferences: { colors: [], avoidTags: [], style: "", surprise: false },
  });
  const chosen = {
    ...raw,
    days: raw.days.map((d, i) => ({
      ...d,
      offeringId: preview[i].offeringId,
      autoSelected: i !== 1,
    })),
  };
  const first = await quoteDaily(buyer.id, chosen),
    again = await quoteDaily(buyer.id, chosen);
  assert.deepEqual(
    first.days.map((d) => d.offeringId),
    preview.map((d) => d.offeringId),
  );
  assert.deepEqual(
    again.days.map((d) => d.offeringId),
    first.days.map((d) => d.offeringId),
  );
  assert.deepEqual(
    first.days.map((d) => d.approved),
    [false, true, false],
  );
  const plan = await createDaily(buyer, {
    ...chosen,
    expectedVersion: first.version,
    expectedTotal: first.total,
    accepted: true,
    idempotencyKey: randomUUID(),
  });
  const deliveries = await db.dailyDelivery.findMany({
    where: { planId: plan.id },
    orderBy: { day: "asc" },
  });
  assert.deepEqual(
    deliveries.map((d) => d.offeringId),
    preview.map((d) => d.offeringId),
  );
  assert.deepEqual(
    deliveries.map((d) => d.approved),
    [false, true, false],
  );
});

test("admin Daily calendar shows funded upcoming recipients before orders exist, excludes paused/refunding/unpaid days and enforces contact privacy", async () => {
  const nextMonth = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 7);
  const selectedDays = calendarMonthDays(nextMonth).slice(5, 8);
  const rawDays = selectedDays.map((day) => ({
    day,
    slotId,
    offeringId,
    writingMode: "AUTO",
  }));
  const p = await buy(3, { days: rawDays });
  await pay(p.id);
  await buy(1, { days: [rawDays[0]] }); // An unpaid hold is not a delivery commitment.
  const orderCount = await db.order.count();
  const ownerView = await dailyCalendarMonth(owner, nextMonth);
  const ownRows = ownerView.rows.filter((r) => r.planId === p.id);
  assert.equal(ownerView.rows.length, 3);
  assert.equal(ownRows.length, 3);
  assert(
    ownRows.every(
      (r) =>
        r.recipientName === "Người nhận Daily" &&
        r.order === null &&
        r.stage === "SCHEDULED",
    ),
  );
  assert(ownRows.every((r) => r.recipientPhone === "0900000000" && r.address));
  assert.equal(await db.order.count(), orderCount);
  const flowerView = await dailyCalendarMonth(florist, nextMonth);
  assert(
    flowerView.rows.every(
      (r) =>
        !("address" in r) &&
        !("recipientPhone" in r) &&
        !("message" in r) &&
        !("total" in r),
    ),
  );
  await assert.rejects(() => dailyCalendarMonth(buyer, nextMonth), {
    code: "FORBIDDEN",
  });
  await assert.rejects(() => dailyCalendarMonth(owner, "2026-13"), {
    name: "ZodError",
  });
  const deliveries = await db.dailyDelivery.findMany({
    where: { planId: p.id },
    orderBy: { day: "asc" },
  });
  await editDailyDelivery(buyer, p.id, deliveries[1].id, {
    version: deliveries[1].version,
    pause: true,
  });
  const current = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } });
  await requestDailyRefund(buyer, p.id, {
    version: current.version,
    deliveryIds: [deliveries[2].id],
    reason: "Không nhận ngày cuối",
  });
  const remaining = await dailyCalendarMonth(owner, nextMonth);
  assert.deepEqual(
    remaining.rows.map((r) => r.day),
    [selectedDays[0]],
  );
});

test("admin Daily calendar includes an older funded plan beyond the 100-plan list and shows actual delivery progress", async () => {
  const { p, d } = await ready();
  const month = d.day.slice(0, 7);
  const source = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } });
  const { id: _id, code: _code, idempotencyKey: _key, ...copy } = source;
  await db.dailyPlan.createMany({
    data: Array.from({ length: 101 }, () => ({
      ...copy,
      id: randomUUID(),
      code: `new-${randomUUID()}`,
      idempotencyKey: randomUUID(),
      state: "CANCELLED",
      createdAt: new Date(Date.now() + 60000),
    })) as Prisma.DailyPlanCreateManyInput[],
  });
  assert(!(await listDaily(owner, true)).some((r) => r.id === p.id));
  assert(
    (await dailyCalendarMonth(owner, month)).rows.some(
      (r) => r.planId === p.id,
    ),
  );
  let order = await materializeDailyDelivery(
    d.id,
    new Date(d.lockAt.getTime() + 1000),
  );
  assert(order);
  let row = (await dailyCalendarMonth(owner, month)).rows.find(
    (r) => r.id === d.id,
  )!;
  assert.equal(row.stage, "UNASSIGNED");
  assert.equal(row.order?.id, order.id);
  for (const action of ["PREPARE", "READY", "DISPATCH", "DELIVER"])
    order = await transitionOrder(order.id, action, order.version, owner);
  row = (await dailyCalendarMonth(owner, month)).rows.find(
    (r) => r.id === d.id,
  )!;
  assert.equal(row.stage, "FULFILLED");
});

test("Daily checkout is idempotent, reserves future slots and never locks current flower stock", async () => {
  const p = await buy(10),
    ds = await db.dailyDelivery.findMany({ where: { planId: p.id } });
  assert.equal(ds.length, 10);
  assert.equal(new Set(ds.map((d) => d.message)).size, 10);
  assert(ds.every((d) => d.reservation === "HELD"));
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .reserved,
    0,
  );
  const raw = await input(10),
    q = await quoteDaily(buyer.id, raw);
  const replay = await createDaily(buyer, {
    ...raw,
    expectedVersion: q.version,
    expectedTotal: q.total,
    accepted: true,
    idempotencyKey: p.idempotencyKey,
  });
  assert.equal(replay.id, p.id);
  assert.equal(await db.slotBooking.count({ where: { slotId, count: 1 } }), 10);
});
test("Daily concurrent buyers cannot exceed the final delivery slot", async () => {
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: policy() },
  });
  await db.deliverySlot.update({
    where: { id: slotId },
    data: { capacity: 1 },
  });
  try {
    const raw = await input(),
      q = await quoteDaily(buyer.id, raw);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        createDaily(buyer, {
          ...raw,
          expectedVersion: q.version,
          expectedTotal: q.total,
          accepted: true,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await db.slotBooking.findFirstOrThrow({ where: { slotId } })).count,
      1,
    );
  } finally {
    await db.deliverySlot.update({
      where: { id: slotId },
      data: { capacity: 100 },
    });
  }
});
test("Daily payment activates once, snapshots old prices and rejects wrong or late transfers", async () => {
  const p = await buy();
  assert.equal((await pay(p.id)).matched, true);
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
  await db.setting.update({
    where: { key: "daily_program" },
    data: {
      value: {
        ...policy(),
        budgets: [{ code: "mini", name: "New", price: 120000 }],
      },
    },
  });
  assert.equal(
    (
      (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } }))
        .policy as any
    ).budgets[0].price,
    70000,
  );
  const wrong = await buy();
  assert.equal((await pay(wrong.id, { transferAmount: 1 })).matched, false);
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: wrong.id } })).state,
    "PENDING_PAYMENT",
  );
  const late = await buy();
  await db.dailyPlan.update({
    where: { id: late.id },
    data: { expiresAt: new Date(0) },
  });
  await db.dailyInvoice.updateMany({
    where: { planId: late.id },
    data: { expiresAt: new Date(0) },
  });
  await atomic(async (tx) => {
    await lockDaily(tx);
    await expireDailyTx(tx);
  });
  assert.equal((await pay(late.id)).matched, false);
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: late.id } })).state,
    "EXPIRED",
  );
});
test("Daily materialization reuses its slot, creates one funded order and unlocks QR only after delivery", async () => {
  const { p, d } = await ready();
  const orders = await Promise.all([
    materializeDailyDelivery(d.id, new Date(d.lockAt.getTime() + 1000)),
    materializeDailyDelivery(d.id, new Date(d.lockAt.getTime() + 1000)),
  ]);
  assert(orders[0] && orders[1]);
  assert.equal(orders[0].id, orders[1].id);
  let o = orders[0];
  assert.equal(o.paymentMethod, "PREPAID_PLAN");
  assert.equal(o.status, "CONFIRMED");
  assert.equal(o.fulfillment, "UNASSIGNED");
  assert.equal(
    (await db.slotBooking.findFirstOrThrow({ where: { slotId } })).count,
    1,
  );
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .reserved,
    1,
  );
  const qr = await db.qrGrant.findUniqueOrThrow({ where: { orderId: o.id } });
  assert.equal(qr.eligibleAt, null);
  await assert.rejects(() => claimQr(decrypt(qr.tokenEncrypted), buyer));
  for (const action of ["PREPARE", "READY", "DISPATCH", "DELIVER"])
    o = await transitionOrder(o.id, action, o.version, owner);
  assert.equal(
    (await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } })).state,
    "FULFILLED",
  );
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "COMPLETED",
  );
  assert(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: o.id } }))
      .eligibleAt,
  );
});
test("Daily auto flowers require approval and overdue delivery becomes an issue rather than a backdated order", async () => {
  const p = await buy();
  await pay(p.id);
  let d = await db.dailyDelivery.findFirstOrThrow({ where: { planId: p.id } });
  assert.equal(
    await materializeDailyDelivery(d.id, new Date(d.lockAt.getTime() + 1000)),
    null,
  );
  d = await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(d.state, "ATTENTION");
  await editDailyDelivery(
    owner,
    p.id,
    d.id,
    { version: d.version, offeringId: d.offeringId, approve: true },
    true,
  );
  assert.equal(
    await materializeDailyDelivery(d.id, localInstant(d.day, 13)),
    null,
  );
  assert.equal(await db.order.count({ where: { dailyPlanId: p.id } }), 0);
});
test("Daily ownership, message version and staff permissions protect private schedules", async () => {
  const { p, d } = await ready();
  await assert.rejects(() => dailyPlanView(p.id, stranger), {
    code: "NOT_FOUND",
  });
  await assert.rejects(
    () =>
      editDailyDelivery(stranger, p.id, d.id, {
        version: d.version,
        message: "Sai người",
      }),
    { code: "NOT_FOUND" },
  );
  await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    message: "Thương gửi",
  });
  await assert.rejects(
    () =>
      editDailyDelivery(buyer, p.id, d.id, {
        version: d.version,
        message: "Ghi đè",
      }),
    { code: "STALE_VERSION" },
  );
  await assert.rejects(
    () =>
      editDailyDelivery(
        { ...owner, role: "DELIVERY" },
        p.id,
        d.id,
        { version: d.version, approve: true },
        true,
      ),
    { code: "FORBIDDEN" },
  );
  const v = await dailyPlanView(p.id, buyer);
  assert.equal(v.deliveries[0].message, "Thương gửi");
  assert.equal(v.deliveries[0].writingMode, "AUTO");
});

test("Daily writing mode is fixed at checkout for customers and staff, including linked orders", async () => {
  for (const writingMode of ["AUTO", "HANDWRITTEN"] as const) {
    const raw = await input(1);
    const p = await buy(1, {
      mode: "SELF",
      days: [{ ...raw.days[0], offeringId, writingMode }],
    });
    await pay(p.id);
    let d = await db.dailyDelivery.findFirstOrThrow({
      where: { planId: p.id },
    });
    const opposite = writingMode === "AUTO" ? "HANDWRITTEN" : "AUTO";
    for (const [actor, admin] of [
      [buyer, false],
      [owner, true],
    ] as const)
      await assert.rejects(
        () =>
          editDailyDelivery(
            actor,
            p.id,
            d.id,
            {
              version: d.version,
              message: "Không được ghi nội dung này",
              writingMode: opposite,
            },
            admin,
          ),
        { code: "DAILY_WRITING_MODE_LOCKED" },
      );
    assert.equal(
      (await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } }))
        .version,
      d.version,
    );
    const order = await materializeDailyDelivery(
      d.id,
      new Date(d.lockAt.getTime() + 1000),
    );
    assert(order);
    d = await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } });
    await assert.rejects(
      () =>
        editDailyDelivery(buyer, p.id, d.id, {
          version: d.version,
          writingMode: opposite,
        }),
      { code: "DAILY_WRITING_MODE_LOCKED" },
    );
    await editDailyDelivery(buyer, p.id, d.id, {
      version: d.version,
      message: "Lời thương mới, giữ cách viết cũ",
    });
    const saved = await db.dailyDelivery.findUniqueOrThrow({
      where: { id: d.id },
    });
    const linked = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    assert.equal(saved.writingMode, writingMode);
    assert.equal(linked.cardWritingMode, writingMode);
    assert.equal(linked.cardMessage, saved.message);
  }
});
test("Daily pause releases capacity and reschedule restores exactly one booking", async () => {
  const { p, d } = await ready();
  await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    pause: true,
  });
  let v = await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(v.state, "UNSCHEDULED");
  assert.equal(
    (await db.slotBooking.findFirstOrThrow({ where: { slotId } })).count,
    0,
  );
  await editDailyDelivery(buyer, p.id, d.id, {
    version: v.version,
    day: shiftDay(v.day, 1),
    slotId,
  });
  v = await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(v.reservation, "CONFIRMED");
  assert.equal(v.total, d.total);
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
});
test("Daily premium change takes effect only after separate exact payment", async () => {
  const { p, d } = await ready();
  const change = await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    offeringId: premiumId,
    idempotencyKey: randomUUID(),
  });
  assert("invoiceId" in change);
  assert.equal(
    (await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } }))
      .offeringId,
    offeringId,
  );
  const i = await db.dailyInvoice.findUniqueOrThrow({
    where: { id: change.invoiceId },
  });
  assert.equal(i.amount, 30000);
  assert.equal(
    (
      await receiveSepay({
        id: randomUUID(),
        accountNumber: (await getSepayConfig()).accountNumber,
        transferType: "in",
        transferAmount: i.amount,
        content: i.code,
      })
    ).matched,
    true,
  );
  assert.equal(
    (await db.dailyDelivery.findUniqueOrThrow({ where: { id: d.id } })).premium,
    30000,
  );
});
test("Daily partial cancellation refunds paid allocation once, without repricing delivered or remaining flowers", async () => {
  const p = await buy(10);
  await pay(p.id);
  const ds = await db.dailyDelivery.findMany({
      where: { planId: p.id },
      orderBy: { day: "asc" },
    }),
    fresh = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } });
  const r = await requestDailyRefund(buyer, p.id, {
    version: fresh.version,
    deliveryIds: [ds[0].id],
    reason: "Đổi lịch công tác",
  });
  assert.equal(r.amount, ds[0].total);
  assert.equal(
    (await db.dailyDelivery.findUniqueOrThrow({ where: { id: ds[1].id } }))
      .total,
    ds[1].total,
  );
  await Promise.all([
    completeDailyRefund(owner, r.id, "BANK-REFUND-1"),
    completeDailyRefund(owner, r.id, "BANK-REFUND-1"),
  ]);
  assert.equal(
    (await db.dailyDelivery.findUniqueOrThrow({ where: { id: ds[0].id } }))
      .refunded,
    ds[0].total,
  );
  assert.equal(
    (await db.dailyRefund.findUniqueOrThrow({ where: { id: r.id } })).state,
    "COMPLETED",
  );
});
test("Daily order refunds cannot bypass parent allocation or release the slot twice", async () => {
  const { p, d } = await ready(),
    o = await materializeDailyDelivery(
      d.id,
      new Date(d.lockAt.getTime() + 1000),
    );
  assert(o);
  await assert.rejects(
    () =>
      requestOrderRefund(
        o.id,
        { version: o.version, amount: o.total, reason: "Hoàn sai luồng" },
        owner,
      ),
    { code: "DAILY_FUNDING" },
  );
  const fresh = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } }),
    r = await requestDailyRefund(
      owner,
      p.id,
      {
        version: fresh.version,
        deliveryIds: [d.id],
        reason: "Cửa hàng xác nhận hoàn",
      },
      true,
    );
  assert.equal(
    (await db.slotBooking.findFirstOrThrow({ where: { slotId } })).count,
    0,
  );
  await completeDailyRefund(owner, r.id, "BANK-REFUND-2");
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus,
    "REFUNDED",
  );
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "CANCELLED",
  );
});

test("Daily a 31-day plan keeps all calendar days and funding allocations in one invoice", async () => {
  const p = await buy(31),
    ds = await db.dailyDelivery.findMany({ where: { planId: p.id } }),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    });
  assert.equal(ds.length, 31);
  assert.equal(new Set(ds.map((d) => d.day)).size, 31);
  assert.equal(
    ds.reduce((n, d) => n + d.total, 0),
    invoice.amount,
  );
  assert.equal(
    (invoice.allocation as { amount: number }[]).reduce(
      (n, a) => n + a.amount,
      0,
    ),
    invoice.amount,
  );
  assert.equal(await db.order.count({ where: { dailyPlanId: p.id } }), 0);
});
test("Daily late payments can be reconciled only against their exact stored bank transfer and available slots", async () => {
  const p = await buy();
  await db.dailyPlan.update({
    where: { id: p.id },
    data: { expiresAt: new Date(0) },
  });
  await db.dailyInvoice.updateMany({
    where: { planId: p.id },
    data: { expiresAt: new Date(0) },
  });
  await atomic(async (tx) => {
    await lockDaily(tx);
    await expireDailyTx(tx);
  });
  await pay(p.id, { referenceCode: "DAILY-LATE-REF" });
  const invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    }),
    payment = await db.payment.findFirstOrThrow({
      where: { dailyInvoiceId: invoice.id },
    });
  await assert.rejects(
    () =>
      reconcileDailyPayment(owner, p.id, {
        paymentId: payment.id,
        reference: "WRONG-REF",
        reason: "Đã xác minh ngân hàng",
      }),
    { code: "DAILY_PAYMENT" },
  );
  await reconcileDailyPayment(owner, p.id, {
    paymentId: payment.id,
    reference: "DAILY-LATE-REF",
    reason: "Đã đối chiếu ngân hàng",
  });
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
  assert.equal(
    (await db.slotBooking.findFirstOrThrow({ where: { slotId } })).count,
    1,
  );
});
test("Daily pending invoices prevent changing the receiving bank", async () => {
  await buy();
  const c = await getSepayAdminView(owner);
  await assert.rejects(
    () =>
      saveSepaySettings(owner, {
        version: c.version,
        enabled: true,
        bank: "MB",
        accountNumber: "otherbank",
        accountName: "Other",
        apiToken: "",
      }),
    { code: "PAYMENTS_PENDING" },
  );
});
test("Daily funding reports count parent cash once and preserve unpaid service value during a pause", async () => {
  const p = await buy();
  await pay(p.id);
  const d = await db.dailyDelivery.findFirstOrThrow({
    where: { planId: p.id },
  });
  const a = await dailyFinancialSummary();
  await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    pause: true,
  });
  const b = await dailyFinancialSummary();
  assert.equal(a.remainingValue, b.remainingValue);
  assert.equal(a.cashReceived, b.cashReceived);
});
test("Daily unavailable flower exclusions and insufficient message libraries cannot be silently ignored", async () => {
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: policy() },
  });
  const raw = await input(1, {
    preferences: { avoidTags: ["hồng", "cẩm chướng"] },
  });
  await assert.rejects(() => quoteDaily(buyer.id, raw), {
    code: "DAILY_POOL_EMPTY",
  });
  await db.setting.update({
    where: { key: "daily_program" },
    data: {
      value: {
        ...policy(),
        messages: Array.from({ length: 31 }, () => ({
          theme: "Ít câu",
          text: "Chúc một ngày tốt lành",
        })),
      },
    },
  });
  const repeated = await input(2, { theme: "Ít câu" });
  await assert.rejects(() => quoteDaily(buyer.id, repeated), {
    code: "DAILY_MESSAGE_POOL",
  });
});

test("Daily unmatched cash is refunded from its real transfer without inventing a paid service", async () => {
  const p = await buy();
  await pay(p.id, {
    transferAmount: 1000,
    referenceCode: "WRONG-DAILY-TRANSFER",
  });
  const invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    }),
    payment = await db.payment.findFirstOrThrow({
      where: { dailyInvoiceId: invoice.id },
    });
  const before = await dailyFinancialSummary(),
    refund = await refundDailyTransfer(
      owner,
      p.id,
      payment.id,
      "Hoàn khoản chuyển sai số tiền",
    );
  await assert.rejects(
    () => refundDailyTransfer(owner, p.id, payment.id, "Yêu cầu lặp lại"),
    { code: "DAILY_FUNDING" },
  );
  await completeDailyRefund(owner, refund.id, "TRANSFER-REFUND-1");
  const after = await dailyFinancialSummary();
  assert.equal(after.cashReceived, before.cashReceived);
  assert.equal(after.cashRefunded - before.cashRefunded, 1000);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).state,
    "REFUNDED",
  );
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "CANCELLED",
  );
  assert.equal(
    await db.dailyInvoice.count({ where: { planId: p.id, state: "PAID" } }),
    0,
  );
});
test("Daily refunding an extra transfer preserves the paid plan and its remaining refund entitlement", async () => {
  const { p, d } = await ready();
  await pay(p.id, {
    transferAmount: 1000,
    referenceCode: "EXTRA-DAILY-TRANSFER",
  });
  const invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    }),
    payment = await db.payment.findFirstOrThrow({
      where: { dailyInvoiceId: invoice.id, state: "REVIEW" },
    });
  const extra = await refundDailyTransfer(
    owner,
    p.id,
    payment.id,
    "Hoàn khoản chuyển thừa",
  );
  await completeDailyRefund(owner, extra.id, "EXTRA-REFUND-1");
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
  const fresh = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } });
  const r = await requestDailyRefund(buyer, p.id, {
    version: fresh.version,
    deliveryIds: [d.id],
    reason: "Hủy trước thời hạn",
  });
  assert.equal(r.amount, d.total);
});
test("Daily analytics uses consent and queues one parent purchase without names, addresses or repeated child purchases", async () => {
  const oldId = process.env.GA4_MEASUREMENT_ID,
    oldSecret = process.env.GA4_API_SECRET;
  process.env.GA4_MEASUREMENT_ID = "daily-test";
  process.env.GA4_API_SECRET = "test-only";
  try {
    await db.setting.update({
      where: { key: "daily_program" },
      data: { value: policy() },
    });
    const raw = await input(3),
      q = await quoteDaily(buyer.id, raw);
    const p = await createDaily(
      buyer,
      {
        ...raw,
        expectedVersion: q.version,
        expectedTotal: q.total,
        accepted: true,
        idempotencyKey: randomUUID(),
      },
      { analyticsClientId: randomUUID() },
    );
    await pay(p.id);
    const invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    });
    assert.equal(
      await db.outbox.count({
        where: { id: `analytics:daily-purchase:${invoice.id}` },
      }),
      1,
    );
    const event = await db.outbox.findUniqueOrThrow({
      where: { id: `analytics:daily-purchase:${invoice.id}` },
    });
    const payload = JSON.stringify(event.payload);
    assert(!payload.includes("Người nhận Daily"));
    assert(!payload.includes("Địa chỉ"));
    await pay(p.id);
    assert.equal(
      await db.outbox.count({
        where: { id: `analytics:daily-purchase:${invoice.id}` },
      }),
      1,
    );
  } finally {
    if (oldId === undefined) delete process.env.GA4_MEASUREMENT_ID;
    else process.env.GA4_MEASUREMENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.GA4_API_SECRET;
    else process.env.GA4_API_SECRET = oldSecret;
  }
});
test("Daily a paused paid schedule retains its committed shipping budget", async () => {
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: { ...policy(), campaignBudget: 90000 } },
  });
  const raw = await input(10),
    q = await quoteDaily(buyer.id, raw),
    p = await createDaily(buyer, {
      ...raw,
      expectedVersion: q.version,
      expectedTotal: q.total,
      accepted: true,
      idempotencyKey: randomUUID(),
    });
  await pay(p.id);
  for (const d of await db.dailyDelivery.findMany({ where: { planId: p.id } }))
    await editDailyDelivery(buyer, p.id, d.id, {
      version: d.version,
      pause: true,
    });
  await assert.rejects(() => quoteDaily(buyer.id, raw), {
    code: "DAILY_SHIP_BUDGET",
  });
});

test("Daily preparation export is staff-only, uses the real schedule and neutralizes spreadsheet formulas", async () => {
  const { p, d } = await ready();
  await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    message: '=HYPERLINK("https://invalid.test")',
  });
  await assert.rejects(() => dailyPreparationCsv(buyer, d.day), {
    code: "FORBIDDEN",
  });
  const csv = await dailyPreparationCsv(florist, d.day);
  assert(csv.includes(p.code));
  assert(csv.includes("'=HYPERLINK"));
  assert(csv.includes(`"${run}","Daily","1"`));
  assert(!csv.includes("webhookKey"));
});

test("Daily totals use the actual prices of mixed flowers and allocate an exact VND discount", async () => {
  const premium = await db.dailyOffering.findUniqueOrThrow({
    where: { id: premiumId },
  });
  const originals = await db.productVariant.findMany({
    where: { id: { in: [variantId, premium.variantId] } },
  });
  try {
    await db.setting.update({
      where: { key: "daily_program" },
      data: { value: policy() },
    });
    await db.productVariant.update({
      where: { id: variantId },
      data: { price: 70001 },
    });
    await db.productVariant.update({
      where: { id: premium.variantId },
      data: { price: 100003 },
    });
    const raw = await input(10);
    const chosen = {
      ...raw,
      mode: "SELF",
      days: raw.days.map((d, i) => ({
        ...d,
        offeringId: i % 2 ? premiumId : offeringId,
      })),
    };
    const q = await quoteDaily(buyer.id, chosen);
    const gross = 5 * 70001 + 5 * 100003;
    assert.equal(
      q.days.reduce((n, d) => n + d.base, 0),
      gross,
    );
    assert(q.days.every((d) => d.premium === 0));
    assert.equal(q.discount, Math.round(gross * 0.05));
    assert.equal(
      q.days.reduce((n, d) => n + d.discount, 0),
      q.discount,
    );
    assert.equal(q.total, gross - q.discount + q.shippingTotal);
    await db.productVariant.update({
      where: { id: variantId },
      data: { price: 90000 },
    });
    await assert.rejects(
      () =>
        createDaily(buyer, {
          ...chosen,
          expectedVersion: q.version,
          expectedTotal: q.total,
          accepted: true,
          idempotencyKey: randomUUID(),
        }),
      { code: "PRICE_CHANGED" },
    );
  } finally {
    for (const v of originals)
      await db.productVariant.update({
        where: { id: v.id },
        data: { price: v.price },
      });
  }
});

test("paid Daily prices stay frozen when the product price changes or the same flower is approved", async () => {
  const { p, d } = await ready();
  const original = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  try {
    await db.productVariant.update({
      where: { id: variantId },
      data: { price: original.price + 20000 },
    });
    await editDailyDelivery(
      owner,
      p.id,
      d.id,
      { version: d.version, offeringId: d.offeringId!, approve: true },
      true,
    );
    const stored = await db.dailyDelivery.findUniqueOrThrow({
      where: { id: d.id },
    });
    assert.equal(stored.total, d.total);
    assert.equal(stored.base, d.base);
    assert.equal(
      await db.dailyInvoice.count({ where: { planId: p.id, kind: "UPGRADE" } }),
      0,
    );
  } finally {
    await db.productVariant.update({
      where: { id: variantId },
      data: { price: original.price },
    });
  }
});

test("editing a private Daily wish leaves automatic wishes on other days unchanged", async () => {
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: policy() },
  });
  const raw = await input(3);
  const before = await quoteDaily(buyer.id, raw);
  const edited = await quoteDaily(buyer.id, {
    ...raw,
    days: raw.days.map((d, i) =>
      i === 0 ? { ...d, message: "Lời chúc riêng của ngày đầu." } : d,
    ),
  });
  assert.equal(edited.days[0].message, "Lời chúc riêng của ngày đầu.");
  assert.equal(edited.days[1].message, before.days[1].message);
  assert.equal(edited.days[2].message, before.days[2].message);
  assert.equal(edited.total, before.total);
  const restored = await quoteDaily(buyer.id, raw);
  assert.deepEqual(
    restored.days.map((d) => d.message),
    before.days.map((d) => d.message),
  );
});

test("automatic Daily wishes stay unique in a small theme pool with private days between them", async () => {
  const p = policy();
  p.messages = p.messages.map((m, i) => ({
    ...m,
    theme: i < 2 ? "Hai lời chúc" : "Chủ đề khác",
  }));
  await db.setting.update({
    where: { key: "daily_program" },
    data: { value: p },
  });
  const raw = await input(3, { theme: "Hai lời chúc" });
  const q = await quoteDaily(buyer.id, {
    ...raw,
    days: raw.days.map((d, i) =>
      i === 1 ? { ...d, message: "Lời chúc riêng ở giữa." } : d,
    ),
  });
  assert.notEqual(q.days[0].message, q.days[2].message);
  assert.equal(q.days[1].message, "Lời chúc riêng ở giữa.");
});

test("manual Daily payment activates once, records the real receipt and identifies the confirming staff", async () => {
  const p = await buy(3),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    });
  const input = {
    version: p.version,
    reference: ` manual-${randomUUID()} `,
    reason: "Đã đối chiếu tiền vào tài khoản",
  };
  const before = await dailyFinancialSummary();
  const result = await confirmDailyPayment(owner, p.id, invoice.id, input);
  assert.equal(result.alreadyPaid, false);
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
  assert(
    (await db.dailyDelivery.findMany({ where: { planId: p.id } })).every(
      (d) => d.reservation === "CONFIRMED",
    ),
  );
  const receipt = await db.payment.findFirstOrThrow({
    where: { dailyInvoiceId: invoice.id },
  });
  assert.equal(receipt.amount, invoice.amount);
  assert.equal(receipt.reference, input.reference.trim());
  assert.equal(receipt.state, "MATCHED");
  assert.equal(
    (await dailyFinancialSummary()).cashReceived - before.cashReceived,
    invoice.amount,
  );
  const history = await db.dailyHistory.findFirstOrThrow({
    where: { planId: p.id, action: "paid" },
  });
  assert.equal(history.actorId, owner.id);
  assert.equal((history.detail as { method: string }).method, "MANUAL");
  assert.equal(
    await db.audit.count({
      where: {
        actorId: owner.id,
        entityId: invoice.id,
        action: "daily.payment_confirmed",
      },
    }),
    1,
  );
  assert.equal(
    (await confirmDailyPayment(owner, p.id, invoice.id, input)).alreadyPaid,
    true,
  );
  assert.equal(
    await db.payment.count({ where: { dailyInvoiceId: invoice.id } }),
    1,
  );
});

test("SePay before or after manual Daily confirmation never counts the same bank reference twice", async () => {
  const p = await buy(),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    }),
    reference = randomUUID();
  await confirmDailyPayment(owner, p.id, invoice.id, {
    version: p.version,
    reference,
    reason: "Đã kiểm tra giao dịch",
  });
  assert.equal(
    (await pay(p.id, { referenceCode: reference.toUpperCase() })).duplicate,
    true,
  );
  assert.equal(
    await db.payment.count({ where: { dailyInvoiceId: invoice.id } }),
    1,
  );
  const second = await buy(),
    next = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: second.id },
    });
  assert.equal((await pay(second.id)).matched, true);
  assert.equal(
    (
      await confirmDailyPayment(owner, second.id, next.id, {
        version: second.version,
        reference: randomUUID(),
        reason: "Xác nhận sau webhook",
      })
    ).alreadyPaid,
    true,
  );
  assert.equal(
    await db.payment.count({ where: { dailyInvoiceId: next.id } }),
    1,
  );
});

test("manual Daily confirmation and a simultaneous SePay webhook serialize to one receipt and activation", async () => {
  const p = await buy(),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    }),
    reference = randomUUID();
  const results = await Promise.allSettled([
    confirmDailyPayment(owner, p.id, invoice.id, {
      version: p.version,
      reference,
      reason: "Đối chiếu đồng thời",
    }),
    pay(p.id, { referenceCode: reference }),
  ]);
  assert(results.every((r) => r.status === "fulfilled"));
  assert.equal(
    await db.payment.count({ where: { dailyInvoiceId: invoice.id } }),
    1,
  );
  assert.equal(
    await db.dailyHistory.count({ where: { planId: p.id, action: "paid" } }),
    1,
  );
  assert.equal(
    (await db.dailyInvoice.findUniqueOrThrow({ where: { id: invoice.id } }))
      .state,
    "PAID",
  );
});

test("manual Daily payment enforces financial roles, version, invoice ownership and non-editable amounts", async () => {
  const p = await buy(),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    });
  const input = {
    version: p.version,
    reference: randomUUID(),
    reason: "Đã nhận tiền chuyển khoản",
  };
  for (const role of ["CUSTOMER", "FLORIST", "DELIVERY", "MARKETING"])
    await assert.rejects(
      () =>
        confirmDailyPayment({ id: buyer.id, role }, p.id, invoice.id, input),
      { code: "FORBIDDEN" },
    );
  await assert.rejects(
    () =>
      confirmDailyPayment(owner, p.id, invoice.id, {
        ...input,
        version: p.version + 1,
      }),
    { code: "STALE_VERSION" },
  );
  await assert.rejects(
    () => confirmDailyPayment(owner, "another-plan", invoice.id, input),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(() =>
    confirmDailyPayment(owner, p.id, invoice.id, { ...input, amount: 1 }),
  );
  assert.equal(
    await db.payment.count({ where: { dailyInvoiceId: invoice.id } }),
    0,
  );
  await confirmDailyPayment(
    { id: owner.id, role: "ACCOUNTANT" },
    p.id,
    invoice.id,
    input,
  );
  assert.equal(
    (await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } })).state,
    "ACTIVE",
  );
});

test("expired, cancelled and review Daily invoices cannot bypass reconciliation through manual confirmation", async () => {
  const p = await buy(),
    invoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: p.id },
    });
  const input = {
    version: p.version,
    reference: randomUUID(),
    reason: "Đã đối chiếu tiền",
  };
  await db.dailyInvoice.update({
    where: { id: invoice.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => confirmDailyPayment(owner, p.id, invoice.id, input),
    { code: "DAILY_PAYMENT_EXPIRED" },
  );
  const canceled = await buy(),
    cInvoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: canceled.id },
    });
  await cancelUnpaidDaily(buyer, canceled.id);
  const fresh = await db.dailyPlan.findUniqueOrThrow({
    where: { id: canceled.id },
  });
  await assert.rejects(
    () =>
      confirmDailyPayment(owner, canceled.id, cInvoice.id, {
        ...input,
        version: fresh.version,
      }),
    { code: "DAILY_PAYMENT_STATE" },
  );
  const review = await buy(),
    rInvoice = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: review.id },
    });
  await pay(review.id, { transferAmount: 1 });
  await assert.rejects(
    () =>
      confirmDailyPayment(owner, review.id, rInvoice.id, {
        ...input,
        version: review.version,
      }),
    { code: "DAILY_PAYMENT_STATE" },
  );
  assert.equal(
    await db.payment.count({
      where: { dailyInvoiceId: { in: [invoice.id, cInvoice.id] } },
    }),
    0,
  );
});

test("one bank reference cannot pay two different Daily invoices", async () => {
  const first = await buy(),
    a = await db.dailyInvoice.findFirstOrThrow({ where: { planId: first.id } }),
    reference = randomUUID();
  await confirmDailyPayment(owner, first.id, a.id, {
    version: first.version,
    reference,
    reason: "Đã nhận đủ tiền",
  });
  const second = await buy(),
    b = await db.dailyInvoice.findFirstOrThrow({
      where: { planId: second.id },
    });
  await assert.rejects(
    () =>
      confirmDailyPayment(owner, second.id, b.id, {
        version: second.version,
        reference,
        reason: "Nhập trùng giao dịch",
      }),
    { code: "DAILY_PAYMENT_REFERENCE" },
  );
  assert.equal(
    (await db.dailyInvoice.findUniqueOrThrow({ where: { id: b.id } })).state,
    "PENDING",
  );
  assert.equal(await db.payment.count({ where: { dailyInvoiceId: b.id } }), 0);
});

test("manual confirmation can fund a Daily flower upgrade without charging the purchase again", async () => {
  const { p, d } = await ready();
  const change = await editDailyDelivery(buyer, p.id, d.id, {
    version: d.version,
    offeringId: premiumId,
    idempotencyKey: randomUUID(),
  });
  assert("invoiceId" in change);
  const plan = await db.dailyPlan.findUniqueOrThrow({ where: { id: p.id } });
  const invoice = await db.dailyInvoice.findUniqueOrThrow({
    where: { id: change.invoiceId },
  });
  await confirmDailyPayment(owner, plan.id, invoice.id, {
    version: plan.version,
    reference: randomUUID(),
    reason: "Đã nhận phần nâng cấp",
  });
  const updated = await db.dailyDelivery.findUniqueOrThrow({
    where: { id: d.id },
  });
  assert.equal(updated.offeringId, premiumId);
  assert.equal(updated.premium, invoice.amount);
  const receipts = await db.payment.findMany({
    where: { dailyInvoice: { planId: p.id } },
  });
  assert.equal(receipts.length, 2);
  assert.equal(
    receipts.reduce((n, r) => n + r.amount, 0),
    p.total + invoice.amount,
  );
});
