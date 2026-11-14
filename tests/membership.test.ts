import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { db } from "../src/lib/db";
import { atomic } from "../src/lib/transaction";
import { dayKey, monthKey } from "../src/lib/time";
import {
  addMembershipMonths,
  nextMembershipEnd,
} from "../src/lib/membership-time";
import {
  getMembershipTiers,
  quoteMembership,
  confirmMembershipInvoice,
  cancelMembershipInvoice,
  getMembershipInvoice,
  resolveMembership,
  grantMembership,
  revokeAdminMembership,
  membershipPeriod,
  recordMembershipSpend,
  recordMembershipRefund,
  syncEarnedMembership,
  publishMembershipTier,
  issueBirthdayReward,
  migrateLegacyMember,
} from "../src/lib/membership";
import { receiveSepay } from "../src/lib/commerce";
import { handleMembershipApi } from "../src/lib/membership-api";
import { reconcileSepay } from "../src/lib/sepay-reconcile";
import type { MembershipTierView } from "../src/lib/membership-types";

const run = randomUUID().slice(0, 8),
  users: string[] = [];
let owner: User,
  manager: User,
  bloom: MembershipTierView,
  burgundy: MembershipTierView,
  custom: MembershipTierView;
async function customer(extra: Record<string, unknown> = {}) {
  const user = await db.user.create({
    data: {
      name: "Membership QA",
      email: `${randomUUID()}@example.test`,
      passwordHash: "test-only",
      verified: true,
      memberSince: new Date(Date.now() - 10000),
      ...extra,
    },
  });
  users.push(user.id);
  return user;
}
async function invoice(
  user: User,
  tier = bloom,
  cycle: "MONTH" | "YEAR" = "MONTH",
) {
  const id = await quoteMembership(user.id, {
    tierId: tier.id,
    cycle,
    idempotencyKey: randomUUID(),
  });
  await confirmMembershipInvoice(user.id, id, true);
  return getMembershipInvoice(id);
}
async function pay(
  i: Awaited<ReturnType<typeof invoice>>,
  overrides: Record<string, unknown> = {},
) {
  return receiveSepay({
    id: randomUUID(),
    accountNumber: "TESTACCOUNT",
    transferType: "in",
    transferAmount: i.amount,
    content: i.code,
    ...overrides,
  } as Parameters<typeof receiveSepay>[0]);
}
async function api(
  actor: User,
  path: string[],
  payload: unknown,
  method = "POST",
) {
  const response = await handleMembershipApi(
    new NextRequest(`http://localhost:3000/api/${path.join("/")}`, { method }),
    path,
    actor,
    async () => payload,
  );
  return response?.json();
}
async function grant(
  user: User,
  tier = bloom,
  endsAt: string | null = new Date(Date.now() + 86400000).toISOString(),
) {
  return grantMembership(owner, user.id, {
    tierId: tier.id,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt,
    reason: "Quà kiểm thử có kiểm soát",
    accepted: true,
    notify: false,
    idempotencyKey: randomUUID(),
  });
}
before(async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"));
  process.env.SEPAY_ACCOUNT_NUMBER = "TESTACCOUNT";
  process.env.SEPAY_BANK = "TESTBANK";
  process.env.SEPAY_WEBHOOK_KEY = "test-only";
  owner = await customer({ role: "OWNER" });
  manager = await customer({ role: "MANAGER" });
  const tiers = await getMembershipTiers();
  bloom = tiers.find((t) => t.code === "Bloom")!;
  burgundy = tiers.find((t) => t.code === "Burgundy")!;
  // One test-only high tier, isolated from the shop's three normal tiers and commerce fixtures.
  const old = await db.membershipTier.findUnique({
    where: { code: "QA_SIGNATURE" },
  });
  if (old) {
    const ids = (
      await db.membershipTierVersion.findMany({
        where: { tierId: old.id },
        select: { id: true },
      })
    ).map((v) => v.id);
    await db.membershipRefund.deleteMany({
      where: { invoice: { tierVersionId: { in: ids } } },
    });
    await db.membershipInvoice.deleteMany({
      where: { tierVersionId: { in: ids } },
    });
    await db.membershipEntitlement.deleteMany({
      where: { tierVersionId: { in: ids } },
    });
    await db.membershipTierVersion.deleteMany({ where: { tierId: old.id } });
    await db.membershipTier.delete({ where: { id: old.id } });
  }
  custom = await publishMembershipTier(owner, {
    ...burgundy,
    code: "QA_SIGNATURE",
    name: "QA Signature",
    rank: 90,
    quota: 12,
    percent: 20,
    cap: 250000,
    monthlyPrice: 199000,
    yearlyPrice: 1990000,
    spendThreshold: 100000000,
  });
});
after(async () => {
  try {
    await db.membershipRefund.deleteMany({
      where: { invoice: { userId: { in: users } } },
    });
    await db.membershipInvoice.deleteMany({ where: { userId: { in: users } } });
    await db.membershipEntitlement.deleteMany({
      where: { userId: { in: users } },
    });
    await db.membershipSpendLedger.deleteMany({
      where: { userId: { in: users } },
    });
    await db.membershipHistory.deleteMany({ where: { userId: { in: users } } });
    await db.refund.deleteMany({ where: { order: { userId: { in: users } } } });
    await db.order.deleteMany({ where: { userId: { in: users } } });
    await db.reward.deleteMany({ where: { userId: { in: users } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    const periods = await db.memberPeriod.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    await db.memberLedger.deleteMany({
      where: { periodId: { in: periods.map((p) => p.id) } },
    });
    await db.memberPeriod.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    if (custom) {
      await db.membershipTierVersion.deleteMany({
        where: { tierId: custom.id },
      });
      await db.membershipTier.delete({ where: { id: custom.id } });
    }
  } finally {
    await db.$disconnect();
  }
});

test("membership anniversaries retain the original day and Hà Nội clock", () => {
  const anchor = new Date("2027-01-31T15:15:42+07:00");
  assert.equal(
    addMembershipMonths(anchor, 1).toISOString(),
    "2027-02-28T08:15:42.000Z",
  );
  assert.equal(
    nextMembershipEnd(anchor, addMembershipMonths(anchor, 1), 1).toISOString(),
    "2027-03-31T08:15:42.000Z",
  );
  assert.equal(
    addMembershipMonths(
      new Date("2024-02-29T12:00:00+07:00"),
      12,
    ).toISOString(),
    "2025-02-28T05:00:00.000Z",
  );
});
test("paid year is cheaper and a repeated checkout produces one invoice, no flower order or QR", async () => {
  const user = await customer(),
    key = randomUUID(),
    beforeOrders = await db.order.count({ where: { userId: user.id } });
  const first = await quoteMembership(user.id, {
    tierId: bloom.id,
    cycle: "YEAR",
    idempotencyKey: key,
  });
  assert.equal(
    await quoteMembership(user.id, {
      tierId: bloom.id,
      cycle: "YEAR",
      idempotencyKey: key,
    }),
    first,
  );
  const i = await getMembershipInvoice(first);
  assert.equal(i.amount, bloom.yearlyPrice);
  assert.ok(i.amount < bloom.monthlyPrice * 12);
  assert.equal(
    await db.order.count({ where: { userId: user.id } }),
    beforeOrders,
  );
  assert.equal((await resolveMembership(user.id)).current?.code, "Member");
});
test("parallel duplicate SePay callbacks activate exactly once", async () => {
  const user = await customer(),
    i = await invoice(user),
    providerId = randomUUID();
  await Promise.all([pay(i, { id: providerId }), pay(i, { id: providerId })]);
  assert.equal(
    await db.membershipEntitlement.count({ where: { invoiceId: i.id } }),
    1,
  );
  assert.equal(await db.payment.count({ where: { providerId } }), 1);
  assert.equal((await resolveMembership(user.id)).current?.id, bloom.id);
  assert.equal((await getMembershipInvoice(i.id)).status, "PAID");
});
test("a provider transaction cannot activate both a matched payment and a second membership", async () => {
  const a = await customer(),
    b = await customer(),
    first = await invoice(a),
    second = await invoice(b),
    id = randomUUID();
  await pay(first, { id });
  await pay(second, { id });
  assert.equal(
    await db.membershipEntitlement.count({ where: { invoiceId: second.id } }),
    0,
  );
});
test("paid expiry falls back to earned rank without erasing it", async () => {
  const user = await customer();
  await db.membershipSpendLedger.create({
    data: {
      userId: user.id,
      orderId: `qa:${run}`,
      sourceKey: `qa:${randomUUID()}`,
      amount: bloom.spendThreshold,
      reason: "QA delivered spend",
    },
  });
  await atomic((tx) => syncEarnedMembership(tx, user.id));
  const i = await invoice(user, burgundy);
  await pay(i);
  assert.equal((await resolveMembership(user.id)).current?.id, burgundy.id);
  await db.membershipEntitlement.update({
    where: { invoiceId: i.id },
    data: { endsAt: new Date(Date.now() - 1) },
  });
  const summary = await resolveMembership(user.id);
  assert.equal(summary.current?.id, bloom.id);
  assert.equal(summary.base?.id, bloom.id);
});
test("upgrades share monthly usage and downgrade cannot keep the upgraded allowance", async () => {
  const user = await customer();
  await db.memberPeriod.create({
    data: { userId: user.id, month: monthKey(), limit: 3, consumed: 2 },
  });
  const g = await grant(user, bloom);
  let s = await resolveMembership(user.id);
  assert.equal(s.remaining, bloom.quota - 2);
  await atomic((tx) => membershipPeriod(tx, user.id, s));
  await Promise.all([
    revokeAdminMembership(owner, g.id, "Kết thúc quà kiểm thử"),
    revokeAdminMembership(owner, g.id, "Kết thúc quà kiểm thử"),
  ]);
  assert.equal(
    await db.membershipHistory.count({
      where: { entitlementId: g.id, action: "admin_revoked" },
    }),
    1,
  );
  s = await resolveMembership(user.id);
  assert.equal(s.limit, 3);
  assert.equal(s.remaining, 1);
  await grant(user, bloom);
  s = await resolveMembership(user.id);
  assert.equal(s.consumed, 2);
  assert.equal(s.remaining, bloom.quota - 2);
});
test("admin grants are independent and permission rules block staff and perpetual manager grants", async () => {
  const user = await customer(),
    i = await invoice(user, bloom);
  await pay(i);
  const g = await grant(user, burgundy);
  assert.equal((await resolveMembership(user.id)).current?.id, burgundy.id);
  await revokeAdminMembership(owner, g.id, "Kết thúc quà kiểm thử");
  assert.equal((await resolveMembership(user.id)).current?.id, bloom.id);
  const raw = {
    tierId: burgundy.id,
    startsAt: new Date().toISOString(),
    endsAt: null,
    reason: "Không được cấp vĩnh viễn",
    accepted: true,
    idempotencyKey: randomUUID(),
  };
  await assert.rejects(
    () => grantMembership(manager, user.id, raw),
    /Quản lý chỉ cấp có hạn/,
  );
  await assert.rejects(
    () =>
      grantMembership({ ...manager, role: "FLORIST" }, user.id, {
        ...raw,
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    /không được cấp/,
  );
});
test("a same-cycle paid upgrade charges a credit once and preserves the end date", async () => {
  const user = await customer(),
    first = await invoice(user, bloom);
  await pay(first);
  const end = (await getMembershipInvoice(first.id)).endsAt;
  const id = await quoteMembership(user.id, {
    tierId: burgundy.id,
    cycle: "MONTH",
    idempotencyKey: randomUUID(),
  });
  const upgrade = await getMembershipInvoice(id);
  assert.equal(upgrade.kind, "UPGRADE");
  assert.ok(upgrade.credit > 0);
  assert.equal(upgrade.amount, upgrade.gross - upgrade.credit);
  assert.equal(upgrade.endsAt, end);
  await confirmMembershipInvoice(user.id, id, true);
  await pay(upgrade);
  assert.equal(
    (
      await db.membershipEntitlement.findUniqueOrThrow({
        where: { invoiceId: first.id },
      })
    ).prepaidValue,
    0,
  );
  assert.equal((await resolveMembership(user.id)).current?.id, burgundy.id);
  assert.equal((await getMembershipInvoice(id)).endsAt, end);
});
test("renewals and month-to-year switches are queued after already purchased time", async () => {
  const user = await customer(),
    first = await invoice(user, bloom);
  await pay(first);
  const current = await getMembershipInvoice(first.id),
    second = await invoice(user, bloom, "YEAR");
  assert.equal(second.startsAt, current.endsAt);
  await pay(second);
  const third = await invoice(user, bloom, "YEAR");
  assert.equal(third.startsAt, (await getMembershipInvoice(second.id)).endsAt);
  await pay(third);
  assert.equal((await resolveMembership(user.id)).limit, bloom.quota);
});
test("wrong amounts, cancelled requests and late transfers require review without granting access", async () => {
  for (const scenario of ["wrong", "cancelled", "late"]) {
    const user = await customer(),
      i = await invoice(user);
    if (scenario === "cancelled") await cancelMembershipInvoice(user.id, i.id);
    if (scenario === "late")
      await db.membershipInvoice.update({
        where: { id: i.id },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
    const r = await pay(
      i,
      scenario === "wrong" ? { transferAmount: i.amount + 1 } : {},
    );
    assert.equal(r.matched, false);
    assert.equal((await getMembershipInvoice(i.id)).status, "REVIEW");
    assert.equal((await resolveMembership(user.id)).current?.rank, 0);
  }
});
test("admin can reconcile a verified late payment once", async () => {
  const user = await customer(),
    i = await invoice(user);
  await db.membershipInvoice.update({
    where: { id: i.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  const id = randomUUID();
  await pay(i, { id });
  const p = await db.payment.findUniqueOrThrow({ where: { providerId: id } });
  await api(owner, ["admin", "members", "payments", p.id, "match"], {
    invoiceId: i.id,
    reason: "Đã kiểm tra khoản tiền đến muộn",
    accepted: true,
  });
  assert.equal((await getMembershipInvoice(i.id)).status, "PAID");
  await assert.rejects(
    () =>
      api(owner, ["admin", "members", "payments", p.id, "match"], {
        invoiceId: i.id,
        reason: "Thử ghép lặp",
        accepted: true,
      }),
    /không còn phù hợp/,
  );
});
test("tier versions freeze paid benefits and reject stale or invalid publications", async () => {
  const user = await customer(),
    i = await invoice(user, custom);
  await pay(i);
  const next = await publishMembershipTier(
    owner,
    {
      ...custom,
      quota: 14,
      percent: 22,
      monthlyPrice: 219000,
      yearlyPrice: 2190000,
    },
    custom.id,
    custom.revision,
  );
  const summary = await resolveMembership(user.id);
  assert.equal(summary.current?.quota, custom.quota);
  assert.equal(summary.current?.monthlyPrice, custom.monthlyPrice);
  await assert.rejects(
    () =>
      publishMembershipTier(
        owner,
        { ...next, yearlyPrice: next.monthlyPrice * 12 },
        next.id,
        next.revision,
      ),
    /Giá năm/,
  );
  await assert.rejects(
    () => publishMembershipTier(owner, next, next.id, custom.revision),
    /đã thay đổi/,
  );
  custom = next;
});
test("partial membership refunds reduce future upgrade credit and are completed idempotently", async () => {
  const user = await customer(),
    i = await invoice(user);
  await pay(i);
  const r = await api(
    owner,
    ["admin", "members", "invoices", i.id, "refunds"],
    { amount: 10000, reason: "Điều chỉnh phí kiểm thử", revokeAccess: false },
  );
  await assert.rejects(
    () =>
      quoteMembership(user.id, {
        tierId: burgundy.id,
        cycle: "MONTH",
        idempotencyKey: randomUUID(),
      }),
    /yêu cầu hoàn phí/,
  );
  await Promise.all([
    api(
      owner,
      ["admin", "members", "refunds", r.id],
      { reference: "QA-REFUND-ONLY" },
      "PATCH",
    ),
    api(
      owner,
      ["admin", "members", "refunds", r.id],
      { reference: "QA-REFUND-ONLY" },
      "PATCH",
    ),
  ]);
  const e = await db.membershipEntitlement.findUniqueOrThrow({
    where: { invoiceId: i.id },
  });
  assert.equal(e.prepaidValue, i.gross - 10000);
  assert.equal(
    await db.membershipHistory.count({
      where: { userId: user.id, action: "fee_refunded" },
    }),
    1,
  );
  assert.equal(e.revokedAt, null);
});
test("refund of converted credit revokes dependent upgrades while preserving unrelated admin rank", async () => {
  const user = await customer(),
    first = await invoice(user);
  await pay(first);
  const second = await invoice(user, burgundy);
  await pay(second);
  await grant(user, custom);
  const r = await api(
    owner,
    ["admin", "members", "invoices", first.id, "refunds"],
    {
      amount: first.amount,
      reason: "Hoàn gói nguồn có giá trị chuyển đổi",
      revokeAccess: true,
    },
  );
  await api(
    owner,
    ["admin", "members", "refunds", r.id],
    { reference: "QA-REFUND-CONVERTED" },
    "PATCH",
  );
  assert.ok(
    (
      await db.membershipEntitlement.findUniqueOrThrow({
        where: { invoiceId: second.id },
      })
    ).revokedAt,
  );
  assert.equal((await resolveMembership(user.id)).current?.id, custom.id);
});
test("birthday benefit is issued once per user/year across multiple grants", async () => {
  const user = await customer({ birthDate: `1990-${dayKey().slice(5)}` });
  await grant(user, bloom);
  await atomic((tx) => issueBirthdayReward(tx, user.id));
  await grant(user, burgundy);
  await atomic((tx) => issueBirthdayReward(tx, user.id));
  assert.equal(
    await db.reward.count({
      where: {
        userId: user.id,
        ruleKey: "membership-birthday",
        period: dayKey().slice(0, 4),
      },
    }),
    1,
  );
});

test("February 29 birthdays receive their gift on February 28 in a common year", async () => {
  const user = await customer({ birthDate: "1992-02-29" });
  await grant(user, bloom, null);
  const date = new Date("2027-02-28T05:00:00Z");
  await atomic((tx) => issueBirthdayReward(tx, user.id, date));
  assert.equal(
    await db.reward.count({
      where: {
        userId: user.id,
        ruleKey: "membership-birthday",
        period: "2027",
      },
    }),
    1,
  );
});
test("net delivered flower spend excludes shipping and partial refunds only reverse merchandise", async () => {
  const user = await customer(),
    paid = await invoice(user, burgundy);
  await pay(paid);
  const order = await db.order.create({
    data: {
      code: `QA${randomUUID()}`,
      idempotencyKey: randomUUID(),
      userId: user.id,
      buyerName: "QA",
      buyerEmail: user.email,
      recipientName: "QA",
      recipientPhone: "0900000000",
      address: "QA local fixture",
      zoneId: "qa",
      deliveryDay: dayKey(),
      slotId: "qa",
      slotLabel: "QA",
      cardMessage: "",
      note: "QA test database only",
      status: "COMPLETED",
      fulfillment: "DELIVERED",
      paymentStatus: "PAID",
      paymentMethod: "SEPAY",
      subtotal: 2100000,
      discount: 100000,
      deliveryFee: 30000,
      total: 2030000,
      expiresAt: new Date(),
    },
  });
  await atomic((tx) => recordMembershipSpend(tx, order.id));
  let s = await resolveMembership(user.id);
  assert.equal(s.spend, 2000000);
  assert.equal(s.base?.id, bloom.id);
  const refund = await db.refund.create({
    data: {
      orderId: order.id,
      amount: 130000,
      merchandiseAmount: 100000,
      reason: "100.000 tiền hoa và 30.000 giao",
      status: "COMPLETED",
    },
  });
  await atomic((tx) => recordMembershipRefund(tx, refund.id));
  await atomic((tx) => recordMembershipRefund(tx, refund.id));
  s = await resolveMembership(user.id);
  assert.equal(s.spend, 1900000);
  assert.equal(s.base?.rank, 0);
  assert.equal(s.current?.id, burgundy.id);
});
test("legacy migration preserves existing rank without inventing paid history", async () => {
  const user = await customer({ membershipMigrated: false, tier: "Burgundy" });
  await atomic((tx) => migrateLegacyMember(tx, user.id));
  await atomic((tx) => migrateLegacyMember(tx, user.id));
  const s = await resolveMembership(user.id);
  assert.equal(s.current?.id, burgundy.id);
  assert.equal(s.sources.filter((e) => e.source === "LEGACY").length, 1);
  assert.equal(s.sources.filter((e) => e.source === "PAID").length, 0);
});
test("contiguous future grants extend the displayed effective expiry", async () => {
  const user = await customer(),
    boundary = new Date(Date.now() + 86400000),
    end = new Date(Date.now() + 4 * 86400000);
  await grant(user, burgundy, boundary.toISOString());
  await grantMembership(owner, user.id, {
    tierId: burgundy.id,
    startsAt: boundary.toISOString(),
    endsAt: end.toISOString(),
    reason: "Nối tiếp quà kiểm thử",
    accepted: true,
    notify: false,
    idempotencyKey: randomUUID(),
  });
  assert.equal((await resolveMembership(user.id)).expiresAt, end.toISOString());
});
test("invoice ownership and malformed dates are enforced at the API boundary", async () => {
  const a = await customer(),
    b = await customer(),
    i = await invoice(a);
  await assert.rejects(
    () => api(b, ["membership", "invoices", i.id], {}, "GET"),
    /Không tìm thấy hóa đơn/,
  );
  await assert.rejects(
    () =>
      api(a, ["membership", "birthday"], { birthDate: "2026-02-31" }, "PATCH"),
    /Ngày sinh không hợp lệ/,
  );
  await assert.rejects(
    () => api({ ...a, role: "FLORIST" }, ["admin", "members"], {}, "GET"),
    /không có quyền/,
  );
});

test("v2 reconciliation recovers missing membership payments and shares identity with numeric webhooks", async () => {
  const user = await customer(),
    i = await invoice(user),
    reference = `QA-${randomUUID()}`,
    v2Id = randomUUID();
  await db.setting.deleteMany({ where: { key: "sepay_reconcile" } });
  let calls = 0;
  const result = await reconcileSepay({
    accessToken: "test-only-token",
    delayMs: 0,
    fetcher: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: "success",
          data:
            calls === 1
              ? [
                  {
                    id: v2Id,
                    account_number: "TESTACCOUNT",
                    transfer_type: "in",
                    amount_in: i.amount,
                    transaction_content: i.code,
                    reference_number: reference,
                    code: i.code,
                  },
                ]
              : [],
          meta: { pagination: { has_more: calls === 1 } },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(result.complete, true);
  assert.equal(calls, 2);
  assert.equal((await getMembershipInvoice(i.id)).status, "PAID");
  const callback = await pay(i, { id: Date.now(), referenceCode: reference });
  assert.equal(callback.duplicate, true);
  assert.equal(
    await db.payment.count({ where: { membershipInvoiceId: i.id } }),
    1,
  );
  assert.equal(
    await db.membershipEntitlement.count({ where: { invoiceId: i.id } }),
    1,
  );
});

test("reconciliation preserves its page after a provider failure", async () => {
  await db.setting.deleteMany({ where: { key: "sepay_reconcile" } });
  await assert.rejects(
    () =>
      reconcileSepay({
        accessToken: "test-only",
        delayMs: 0,
        fetcher: async () => new Response("", { status: 429 }),
      }),
    /HTTP 429/,
  );
  let page = "";
  await reconcileSepay({
    accessToken: "test-only",
    delayMs: 0,
    fetcher: async (input) => {
      page = new URL(String(input)).searchParams.get("page") ?? "";
      return new Response(
        JSON.stringify({
          status: "success",
          data: [],
          meta: { pagination: { has_more: false } },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(page, "1");
});
