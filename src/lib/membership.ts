import { getSepayConfig, lockSepayConfig, sepayQrUrl } from "./sepay-settings";
import { randomBytes } from "node:crypto";
import {
  Prisma,
  type MembershipTierVersion,
  type MembershipTier,
  type User,
  type MembershipInvoice,
  type MembershipEntitlement,
} from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { fail } from "./errors";
import { atomic, type Tx } from "./transaction";
import { getSettings } from "./settings";
import { hash } from "./security";
import { dayKey, monthKey, shiftDay } from "./time";
import { addMembershipMonths, nextMembershipEnd } from "./membership-time";
import type {
  MembershipTierView,
  MembershipSummary,
  MembershipInvoiceView,
} from "./membership-types";

type Client = Tx | typeof db;
type Version = MembershipTierVersion & { tier: MembershipTier };
type Entitlement = MembershipEntitlement & { tierVersion: Version };
export const MEMBERSHIP_TERMS = "membership-v2";
export const tierInputSchema = z.object({
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,39}$/),
  name: z.string().trim().min(2).max(80),
  rank: z.number().int().min(0).max(99),
  description: z.string().max(400),
  color: z.enum(["#6e1423", "#8c4350", "#4d101b", "#796660"]),
  active: z.boolean(),
  monthlyEnabled: z.boolean(),
  yearlyEnabled: z.boolean(),
  quota: z.number().int().min(0).max(100),
  percent: z.number().int().min(0).max(50),
  cap: z.number().int().min(0).max(1000000),
  minimum: z.number().int().min(0).max(10000000),
  monthlyPrice: z.number().int().min(0).max(10000000),
  yearlyPrice: z.number().int().min(0).max(100000000),
  spendThreshold: z.number().int().min(0).max(1000000000),
  birthdayPercent: z.number().int().min(0).max(30),
  birthdayCap: z.number().int().min(0).max(1000000),
  birthdayMinimum: z.number().int().min(0).max(10000000),
  birthdayDays: z.number().int().min(1).max(365),
});

export function tierView(v: Version): MembershipTierView {
  const {
    id,
    code,
    name,
    rank,
    description,
    color,
    active,
    monthlyEnabled,
    yearlyEnabled,
    revision,
  } = v.tier;
  return {
    id,
    code,
    name,
    rank,
    description,
    color,
    active,
    monthlyEnabled,
    yearlyEnabled,
    revision,
    versionId: v.id,
    number: v.number,
    quota: v.quota,
    percent: v.percent,
    cap: v.cap,
    minimum: v.minimum,
    monthlyPrice: v.monthlyPrice,
    yearlyPrice: v.yearlyPrice,
    spendThreshold: v.spendThreshold,
    birthdayPercent: v.birthdayPercent,
    birthdayCap: v.birthdayCap,
    birthdayMinimum: v.birthdayMinimum,
    birthdayDays: v.birthdayDays,
    terms: v.terms,
  };
}

export async function seedMembershipCatalog(client: Client = db) {
  const settings = await getSettings(client);
  const defaults = [
    {
      code: "Member",
      rank: 0,
      description: "Một vòng tròn nhỏ, những đặc quyền mỗi tháng.",
      color: "#796660",
      quota: settings.memberQuota,
      percent: settings.memberPercent,
      cap: settings.memberCap,
      monthlyPrice: 0,
      yearlyPrice: 0,
      spendThreshold: 0,
      birthdayPercent: 0,
      birthdayCap: 0,
    },
    {
      code: "Bloom",
      rank: 1,
      description: "Thêm những dịp gửi hoa, thêm một chút yêu thương.",
      color: "#8c4350",
      quota: 5,
      percent: 12,
      cap: 120000,
      monthlyPrice: 59000,
      yearlyPrice: 590000,
      spendThreshold: settings.bloomSpend,
      birthdayPercent: 10,
      birthdayCap: 100000,
    },
    {
      code: "Burgundy",
      rank: 2,
      description: "Những đặc quyền dành cho người luôn có chỗ cho hoa.",
      color: "#6e1423",
      quota: 8,
      percent: 15,
      cap: 150000,
      monthlyPrice: 129000,
      yearlyPrice: 1290000,
      spendThreshold: settings.burgundySpend,
      birthdayPercent: 15,
      birthdayCap: 150000,
    },
  ];
  for (const d of defaults) {
    const { code, rank, description, color, ...benefits } = d;
    const tier = await client.membershipTier.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: code,
        rank,
        description,
        color,
        monthlyEnabled: rank > 0,
        yearlyEnabled: rank > 0,
      },
    });
    await client.membershipTierVersion.upsert({
      where: { tierId_number: { tierId: tier.id, number: 1 } },
      update: {},
      create: {
        tierId: tier.id,
        number: 1,
        ...benefits,
        birthdayMinimum: rank ? 300000 : 0,
      },
    });
  }
}

export async function getMembershipTiers(
  client: Client = db,
): Promise<MembershipTierView[]> {
  let rows = await client.membershipTier.findMany({
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    orderBy: { rank: "asc" },
  });
  if (!rows.length) {
    await seedMembershipCatalog(client);
    rows = await client.membershipTier.findMany({
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { rank: "asc" },
    });
  }
  return rows
    .filter((t) => t.versions[0])
    .map((t) => tierView({ ...t.versions[0], tier: t }));
}

export async function lockMember(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT id FROM User WHERE id=${userId} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id: userId } });
}

async function memberEvent(
  tx: Tx,
  userId: string,
  action: string,
  detail: Prisma.InputJsonValue,
  entitlementId?: string,
  actorId?: string,
) {
  await tx.membershipHistory.create({
    data: { userId, action, entitlementId, actorId, detail },
  });
  await tx.outbox.create({
    data: { userId, event: "membership.changed", payload: { action } },
  });
  if (actorId)
    await tx.audit.create({
      data: {
        actorId,
        action: `membership.${action}`,
        entityId: userId,
        detail,
      },
    });
}

/** One-time migration preserves unknown historic provenance instead of inventing a purchase. */
export async function migrateLegacyMember(tx: Tx, userId: string) {
  const user = await lockMember(tx, userId);
  if (user.membershipMigrated) return;
  const tiers = await getMembershipTiers(tx);
  const tier = tiers.find((t) => t.code === user.tier);
  if (user.memberSince && tier && tier.rank > 0) {
    const e = await tx.membershipEntitlement.upsert({
      where: { sourceKey: `legacy:${user.id}` },
      update: {},
      create: {
        userId,
        tierVersionId: tier.versionId,
        source: "LEGACY",
        sourceKey: `legacy:${user.id}`,
        startsAt: user.memberSince,
        reason: "Bảo toàn hạng trước khi mở chương trình trả phí.",
      },
    });
    await memberEvent(
      tx,
      userId,
      "legacy_preserved",
      { tier: tier.name },
      e.id,
    );
  }
  await tx.user.update({
    where: { id: userId },
    data: { membershipMigrated: true },
  });
}

const live = (e: Entitlement, now: Date) =>
  !e.revokedAt && e.startsAt <= now && (!e.endsAt || e.endsAt > now);

export async function resolveMembership(
  userId: string,
  client: Client = db,
  now = new Date(),
): Promise<MembershipSummary> {
  const [user, tiers, period, grants, spent] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: userId } }),
    getMembershipTiers(client),
    client.memberPeriod.findUnique({
      where: { userId_month: { userId, month: monthKey(now) } },
    }),
    client.membershipEntitlement.findMany({
      where: { userId, revokedAt: null },
      include: { tierVersion: { include: { tier: true } } },
      orderBy: { createdAt: "desc" },
    }),
    client.membershipSpendLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
  ]);
  const active = grants.filter((e) => live(e, now));
  const snapshots = (period?.tierLimits ?? {}) as Record<string, string>;
  const versionIds = Object.values(snapshots).filter(
    (v) => typeof v === "string",
  );
  const versions = versionIds.length
    ? await client.membershipTierVersion.findMany({
        where: { id: { in: versionIds } },
        include: { tier: true },
      })
    : [];
  const forMonth = (t: MembershipTierView) => {
    const version = versions.find((v) => v.id === snapshots[t.id]);
    return version ? tierView(version) : t;
  };
  const baseTier = tiers.find((t) => t.rank === 0)!;
  const candidates = [
    forMonth(baseTier),
    ...active.map((e) =>
      e.source === "PAID"
        ? tierView(e.tierVersion)
        : forMonth(
            tiers.find((t) => t.id === e.tierVersion.tierId) ??
              tierView(e.tierVersion),
          ),
    ),
  ];
  // A paid version is contractual. On an equal rank, prefer the paid snapshot.
  candidates.sort((a, b) => b.rank - a.rank);
  const top = candidates[0];
  const paid = active.find(
    (e) => e.source === "PAID" && e.tierVersion.tier.rank === top.rank,
  );
  const current =
    !user.memberSince || !user.verified || user.disabled
      ? null
      : paid
        ? tierView(paid.tierVersion)
        : top;
  const base = [
    forMonth(baseTier),
    ...active
      .filter((e) => ["EARNED", "LEGACY"].includes(e.source))
      .map((e) =>
        forMonth(
          tiers.find((t) => t.id === e.tierVersion.tierId) ??
            tierView(e.tierVersion),
        ),
      ),
  ].sort((a, b) => b.rank - a.rank)[0];
  let expiry: Date | null = null;
  if (current && current.rank > base.rank) {
    const relevant = grants
      .filter((e) => e.tierVersion.tier.rank >= current.rank)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    let end: Date | null = now;
    for (const e of relevant) {
      if (end === null || e.startsAt > end || (e.endsAt && e.endsAt <= now))
        continue;
      end =
        e.endsAt === null
          ? null
          : new Date(Math.max(end.getTime(), e.endsAt.getTime()));
    }
    expiry = end;
  }
  const legacyBase = (period?.tierLimits as Record<string, unknown> | null)
    ?._baseQuota;
  const limit = current
    ? current.rank === 0 && typeof legacyBase === "number"
      ? legacyBase
      : current.rank === 0 && period && !period.tierLimits
        ? period.limit
        : current.quota
    : 0;
  const consumed = period?.consumed ?? 0,
    reserved = period?.reserved ?? 0;
  return {
    enrolled: !!user.memberSince,
    current,
    base: user.memberSince ? base : null,
    expiresAt: expiry?.toISOString() ?? null,
    spend: Math.max(0, spent._sum.amount ?? 0),
    nextTier:
      tiers.find(
        (t) => t.active && t.rank > base.rank && t.spendThreshold > 0,
      ) ?? null,
    limit,
    consumed,
    reserved,
    remaining: Math.max(0, limit - consumed - reserved),
    month: monthKey(now),
    birthDate: user.birthDate,
    sources: grants.map((e) => ({
      id: e.id,
      source: e.source,
      tier: e.tierVersion.tier.name,
      tierId: e.tierVersion.tierId,
      rank: e.tierVersion.tier.rank,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      revokedAt: e.revokedAt?.toISOString() ?? null,
      reason: e.reason,
    })),
  };
}

export async function membershipPeriod(
  tx: Tx,
  userId: string,
  summary: MembershipSummary,
) {
  const tiers = await getMembershipTiers(tx);
  const existing = await tx.memberPeriod.findUnique({
    where: { userId_month: { userId, month: summary.month } },
  });
  const snapshots = {
    ...Object.fromEntries(tiers.map((t) => [t.id, t.versionId])),
    _baseQuota: existing?.limit ?? tiers.find((t) => t.rank === 0)!.quota,
  };
  return tx.memberPeriod.upsert({
    where: { userId_month: { userId, month: summary.month } },
    create: {
      userId,
      month: summary.month,
      limit: summary.limit,
      tierLimits: snapshots,
    },
    update: {
      limit: summary.limit,
      ...(!existing?.tierLimits ? { tierLimits: snapshots } : {}),
    },
  });
}

export async function enrollMember(tx: Tx, userId: string, actorId = userId) {
  const user = await lockMember(tx, userId);
  if (!user.verified || user.disabled)
    fail("VERIFY_EMAIL", "Vui lòng xác minh tài khoản trước khi tham gia.");
  if (!(await getSettings(tx)).memberEnabled)
    fail("MEMBERSHIP_PAUSED", "Chương trình hội viên đang tạm dừng.");
  if (!user.memberSince) {
    await tx.user.update({
      where: { id: userId },
      data: { memberSince: new Date(), tier: "Member" },
    });
    await memberEvent(
      tx,
      userId,
      "enrolled",
      { terms: MEMBERSHIP_TERMS },
      undefined,
      actorId,
    );
    await tx.notification.create({
      data: {
        userId,
        title: "Chào mừng đến Fleurious Circle",
        body: "Bạn đã tham gia hội viên. Mở thẻ để xem hạng và số lượt ưu đãi trong tháng.",
        url: "/account/membership",
      },
    });
  }
  return resolveMembership(userId, tx);
}

export async function syncEarnedMembership(
  tx: Tx,
  userId: string,
  refundAdjustment = false,
) {
  const user = await lockMember(tx, userId);
  if (!user.memberSince) return;
  const spent = Math.max(
    0,
    (
      await tx.membershipSpendLedger.aggregate({
        where: { userId },
        _sum: { amount: true },
      })
    )._sum.amount ?? 0,
  );
  if (refundAdjustment) {
    const earned = await tx.membershipEntitlement.findMany({
      where: {
        userId,
        source: "EARNED",
        revokedAt: null,
        spendRequired: { gt: spent },
      },
    });
    for (const grant of earned) {
      await tx.membershipEntitlement.update({
        where: { id: grant.id },
        data: { revokedAt: new Date() },
      });
      await memberEvent(
        tx,
        userId,
        "earned_adjusted",
        { spent, reason: "Điều chỉnh chi tiêu sau hoàn tiền." },
        grant.id,
      );
    }
  }
  const tiers = await getMembershipTiers(tx);
  for (const tier of tiers.filter(
    (t) =>
      t.active &&
      t.rank > 0 &&
      t.spendThreshold > 0 &&
      spent >= t.spendThreshold,
  )) {
    const key = `earned:${userId}:${tier.id}:${tier.number}`;
    const existing = await tx.membershipEntitlement.findUnique({
      where: { sourceKey: key },
    });
    if (existing && !existing.revokedAt) continue;
    const e = await tx.membershipEntitlement.upsert({
      where: { sourceKey: key },
      create: {
        userId,
        tierVersionId: tier.versionId,
        source: "EARNED",
        sourceKey: key,
        startsAt: new Date(),
        spendRequired: tier.spendThreshold,
        reason: "Đạt hạn mức chi tiêu tiền hoa hợp lệ.",
      },
      update: { revokedAt: null, startsAt: new Date() },
    });
    await memberEvent(
      tx,
      userId,
      "earned",
      { tier: tier.name, spent, threshold: tier.spendThreshold },
      e.id,
    );
    await tx.notification.create({
      data: {
        userId,
        title: `Bạn đã đạt hạng ${tier.name}`,
        body: "Đặc quyền mới đã sẵn sàng cho đơn hoa tiếp theo.",
        url: "/membership",
      },
    });
  }
  const summary = await resolveMembership(userId, tx);
  await tx.user.update({
    where: { id: userId },
    data: { tier: summary.current?.name ?? "Member" },
  });
}

export async function recordMembershipSpend(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true },
  });
  if (
    !order.user?.memberSince ||
    order.createdAt < order.user.memberSince ||
    order.status !== "COMPLETED" ||
    order.fulfillment !== "DELIVERED" ||
    !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus)
  )
    return;
  await lockMember(tx, order.userId!);
  await tx.membershipSpendLedger.upsert({
    where: { sourceKey: `order:${orderId}` },
    update: {},
    create: {
      userId: order.userId!,
      orderId,
      sourceKey: `order:${orderId}`,
      amount: order.subtotal - order.discount,
      reason: "Đơn hoa đã giao và thu tiền.",
    },
  });
  const completedRefunds = await tx.refund.findMany({
    where: { orderId, status: "COMPLETED" },
  });
  for (const refund of completedRefunds)
    await tx.membershipSpendLedger.upsert({
      where: { sourceKey: `refund:${refund.id}` },
      update: {},
      create: {
        userId: order.userId!,
        orderId,
        sourceKey: `refund:${refund.id}`,
        amount: -refund.merchandiseAmount,
        reason: "Hoàn phần tiền hoa trước khi hoàn tất giao hàng.",
      },
    });
  await syncEarnedMembership(tx, order.userId!, completedRefunds.length > 0);
}

export async function recordMembershipRefund(tx: Tx, refundId: string) {
  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: { order: true },
  });
  if (refund.status !== "COMPLETED" || !refund.order.userId) return;
  const original = await tx.membershipSpendLedger.findUnique({
    where: { sourceKey: `order:${refund.orderId}` },
  });
  if (!original) return;
  await lockMember(tx, original.userId);
  await tx.membershipSpendLedger.upsert({
    where: { sourceKey: `refund:${refundId}` },
    update: {},
    create: {
      userId: original.userId,
      orderId: refund.orderId,
      sourceKey: `refund:${refundId}`,
      amount: -refund.merchandiseAmount,
      reason: "Hoàn phần tiền hoa đã đối soát.",
    },
  });
  await syncEarnedMembership(tx, original.userId, true);
}

export async function publishMembershipTier(
  actor: User,
  raw: unknown,
  tierId?: string,
  expected?: number,
) {
  if (actor.role !== "OWNER")
    fail("FORBIDDEN", "Chỉ chủ cửa hàng được công bố hạng và giá bán.", 403);
  const input = tierInputSchema.parse(raw);
  if (
    input.rank === 0 &&
    (input.code !== "Member" ||
      !input.active ||
      input.monthlyEnabled ||
      input.yearlyEnabled ||
      input.spendThreshold)
  )
    fail("BASE_TIER", "Member là hạng miễn phí, luôn được bảo toàn.");
  if (input.rank > 0 && input.spendThreshold <= 0)
    fail("TIER_THRESHOLD", "Hạng nâng cao cần ngưỡng chi tiêu lớn hơn 0.");
  if (
    (input.monthlyEnabled && !input.monthlyPrice) ||
    (input.yearlyEnabled && !input.yearlyPrice)
  )
    fail("TIER_PRICE", "Gói đang bán phải có giá lớn hơn 0.");
  if (
    input.monthlyEnabled &&
    input.yearlyEnabled &&
    input.yearlyPrice >= input.monthlyPrice * 12
  )
    fail("YEAR_PRICE", "Giá năm phải thấp hơn tổng giá 12 tháng.");
  return atomic(async (tx) => {
    // Serialize all tier publications, including creation of new tiers.
    await tx.setting.upsert({
      where: { key: "membership_catalog" },
      create: { key: "membership_catalog", value: {} },
      update: {},
    });
    await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='membership_catalog' FOR UPDATE`;
    const tiers = await getMembershipTiers(tx);
    const old = tierId ? tiers.find((t) => t.id === tierId) : null;
    if (tierId && !old) fail("NOT_FOUND", "Không tìm thấy hạng.", 404);
    if (old && old.revision !== expected)
      fail("STALE_TIER", "Hạng đã thay đổi. Tải lại trước khi lưu.", 409);
    if (old && (old.code !== input.code || old.rank !== input.rank))
      fail(
        "TIER_IDENTITY",
        "Mã và thứ tự hạng đã công bố không được thay đổi.",
      );
    for (const tier of tiers.filter((t) => t.id !== tierId)) {
      if (
        tier.code.toLowerCase() === input.code.toLowerCase() ||
        tier.rank === input.rank
      )
        fail("TIER_DUPLICATE", "Mã hoặc thứ tự hạng đã tồn tại.");
      if (
        input.active &&
        tier.active &&
        input.rank > tier.rank &&
        (input.spendThreshold <= tier.spendThreshold ||
          input.quota < tier.quota ||
          input.percent < tier.percent ||
          input.cap < tier.cap)
      )
        fail(
          "TIER_ORDER",
          "Hạng cao cần ngưỡng chi tiêu và quyền lợi không thấp hơn hạng dưới.",
        );
      if (
        input.active &&
        tier.active &&
        input.rank < tier.rank &&
        (input.spendThreshold >= tier.spendThreshold ||
          input.quota > tier.quota ||
          input.percent > tier.percent ||
          input.cap > tier.cap)
      )
        fail(
          "TIER_ORDER",
          "Cấu hình đang vượt quyền lợi hoặc ngưỡng của hạng trên.",
        );
    }
    const {
      code,
      name,
      rank,
      description,
      color,
      active,
      monthlyEnabled,
      yearlyEnabled,
      ...benefits
    } = input;
    const tier = old
      ? await tx.membershipTier.update({
          where: { id: old.id },
          data: {
            name,
            description,
            color,
            active,
            monthlyEnabled,
            yearlyEnabled,
            revision: { increment: 1 },
          },
        })
      : await tx.membershipTier.create({
          data: {
            code,
            name,
            rank,
            description,
            color,
            active,
            monthlyEnabled,
            yearlyEnabled,
          },
        });
    const version = await tx.membershipTierVersion.create({
      data: { tierId: tier.id, number: tier.revision, ...benefits },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "membership.tier.published",
        entityId: tier.id,
        detail: { version: version.number, ...input },
      },
    });
    await tx.jobRun.upsert({
      where: { id: `membership-recheck:${version.id}` },
      update: {},
      create: {
        id: `membership-recheck:${version.id}`,
        name: "membership-recheck",
        status: "QUEUED",
        detail: "",
      },
    });
    return tierView({ ...version, tier });
  });
}

export async function grantMembership(
  actor: User,
  userId: string,
  raw: unknown,
) {
  if (!["OWNER", "MANAGER"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không được cấp hạng.", 403);
  const input = z
    .object({
      tierId: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime().nullable(),
      reason: z.string().trim().min(4).max(400),
      notify: z.boolean().default(true),
      accepted: z.literal(true),
      idempotencyKey: z.string().min(16).max(80),
    })
    .parse(raw);
  const start = new Date(input.startsAt),
    end = input.endsAt ? new Date(input.endsAt) : null;
  if (end && (end <= start || end <= new Date()))
    fail(
      "INVALID_EXPIRY",
      "Ngày hết hạn phải sau ngày bắt đầu và thời điểm hiện tại.",
    );
  if (
    actor.role !== "OWNER" &&
    (!end ||
      end.getTime() - start.getTime() > 366 * 86400000 ||
      actor.id === userId)
  )
    fail(
      "FORBIDDEN",
      "Quản lý chỉ cấp có hạn tối đa một năm cho khách khác.",
      403,
    );
  return atomic(async (tx) => {
    const target = await lockMember(tx, userId);
    if (!target.memberSince || !target.verified || target.disabled)
      fail(
        "NOT_MEMBER",
        "Khách cần đăng ký và xác minh hội viên trước khi nhận hạng.",
      );
    const existing = await tx.membershipEntitlement.findUnique({
      where: { sourceKey: `admin:${input.idempotencyKey}` },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.actorId !== actor.id ||
        existing.startsAt.getTime() !== start.getTime() ||
        existing.endsAt?.getTime() !== end?.getTime() ||
        existing.reason !== input.reason ||
        (
          await tx.membershipTierVersion.findUniqueOrThrow({
            where: { id: existing.tierVersionId },
          })
        ).tierId !== input.tierId
      )
        fail("CONFLICT", "Yêu cầu không hợp lệ.", 409);
      return existing;
    }
    const tier = (await getMembershipTiers(tx)).find(
      (t) => t.id === input.tierId && t.active,
    );
    if (!tier || !tier.rank)
      fail("TIER_UNAVAILABLE", "Chọn một hạng nâng cao đang hoạt động.");
    const before = await resolveMembership(userId, tx);
    const grant = await tx.membershipEntitlement.create({
      data: {
        userId,
        tierVersionId: tier.versionId,
        source: "ADMIN",
        sourceKey: `admin:${input.idempotencyKey}`,
        startsAt: start,
        endsAt: end,
        reason: input.reason,
        actorId: actor.id,
      },
    });
    const after = await resolveMembership(userId, tx);
    await tx.user.update({
      where: { id: userId },
      data: { tier: after.current?.name ?? "Member" },
    });
    await memberEvent(
      tx,
      userId,
      "admin_granted",
      {
        before: before.current?.name ?? "Member",
        after: after.current?.name ?? "Member",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
      },
      grant.id,
      actor.id,
    );
    if (input.notify)
      await tx.notification.create({
        data: {
          userId,
          title: `Một món quà từ Fleurious: ${tier.name}`,
          body: input.reason,
          url: "/membership",
        },
      });
    return grant;
  });
}

export async function revokeAdminMembership(
  actor: User,
  grantId: string,
  reason: string,
) {
  if (!["OWNER", "MANAGER"].includes(actor.role) || reason.trim().length < 4)
    fail("FORBIDDEN", "Cần quyền cấp hạng và lý do hợp lệ.", 403);
  return atomic(async (tx) => {
    const lookup = await tx.membershipEntitlement.findUniqueOrThrow({
      where: { id: grantId },
    });
    await lockMember(tx, lookup.userId);
    const fresh = await tx.membershipEntitlement.findUniqueOrThrow({
      where: { id: grantId },
    });
    if (
      fresh.source !== "ADMIN" ||
      (actor.role !== "OWNER" && fresh.actorId !== actor.id)
    )
      fail(
        "FORBIDDEN",
        "Chỉ thu hồi quyền admin đã cấp trong phạm vi cho phép.",
        403,
      );
    if (fresh.revokedAt) return;
    await tx.membershipEntitlement.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    });
    await memberEvent(
      tx,
      lookup.userId,
      "admin_revoked",
      { reason },
      grantId,
      actor.id,
    );
    const current = await resolveMembership(lookup.userId, tx);
    await tx.user.update({
      where: { id: lookup.userId },
      data: { tier: current.current?.name ?? "Member" },
    });
  });
}

async function paidSchedule(client: Client, userId: string) {
  return client.membershipEntitlement.findMany({
    where: {
      userId,
      source: "PAID",
      revokedAt: null,
      endsAt: { gt: new Date() },
    },
    include: { tierVersion: { include: { tier: true } } },
    orderBy: { startsAt: "asc" },
  });
}
function fingerprint(grants: Entitlement[]) {
  return hash(
    JSON.stringify(
      grants.map((e) => [
        e.id,
        e.tierVersionId,
        e.startsAt.toISOString(),
        e.endsAt?.toISOString(),
        e.prepaidValue,
        e.revokedAt,
      ]),
    ),
  );
}
export const membershipPurchaseSchema = z.object({
  tierId: z.string(),
  cycle: z.enum(["MONTH", "YEAR"]),
  mode: z.enum(["AUTO", "NEXT"]).default("AUTO"),
  idempotencyKey: z.string().min(16).max(100),
});

export async function quoteMembership(userId: string, raw: unknown) {
  const input = membershipPurchaseSchema.parse(raw);
  return atomic(async (tx) => {
    const user = await lockMember(tx, userId);
    if (!user.memberSince || !user.verified || user.disabled)
      fail("NOT_MEMBER", "Đăng ký và xác minh hội viên trước khi mua gói.");
    if (!(await getSettings(tx)).memberEnabled)
      fail("MEMBERSHIP_PAUSED", "Chương trình đang tạm dừng bán gói.");
    const replay = await tx.membershipInvoice.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (
        replay.userId !== userId ||
        replay.cycle !== input.cycle ||
        (
          await tx.membershipTierVersion.findUniqueOrThrow({
            where: { id: replay.tierVersionId },
          })
        ).tierId !== input.tierId
      )
        fail("CONFLICT", "Mã yêu cầu đã được dùng cho lựa chọn khác.", 409);
      return replay.id;
    }
    const now = new Date();
    if (
      await tx.membershipRefund.count({
        where: { status: "PENDING", invoice: { userId } },
      })
    )
      fail(
        "REFUND_PENDING",
        "Bạn đang có yêu cầu hoàn phí. Cửa hàng cần xử lý xong trước khi đổi hoặc gia hạn gói.",
      );
    await tx.membershipInvoice.updateMany({
      where: {
        userId,
        status: { in: ["DRAFT", "PENDING"] },
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });
    const pending = await tx.membershipInvoice.findFirst({
      where: { userId, status: "PENDING" },
    });
    if (pending)
      fail(
        "INVOICE_PENDING",
        `Bạn còn hóa đơn ${pending.code} chờ thanh toán. Mở hoặc hủy hóa đơn đó trước.`,
      );
    const tier = (await getMembershipTiers(tx)).find(
      (t) => t.id === input.tierId && t.active,
    );
    if (
      !tier ||
      !tier.rank ||
      !(input.cycle === "MONTH" ? tier.monthlyEnabled : tier.yearlyEnabled)
    )
      fail("PLAN_UNAVAILABLE", "Gói này hiện chưa được mở bán.");
    const price =
      input.cycle === "MONTH" ? tier.monthlyPrice : tier.yearlyPrice;
    const months = input.cycle === "MONTH" ? 1 : 12;
    const schedule = await paidSchedule(tx, userId);
    const current = schedule.find((e) => live(e, now));
    const future = schedule.filter((e) => e.startsAt > now);
    const last = schedule.at(-1);
    let startsAt = now,
      anchorAt = now,
      endsAt = addMembershipMonths(now, months),
      kind = "PURCHASE",
      gross = price,
      credit = 0,
      baseEntitlementId: string | null = null;
    if (
      current &&
      current.tierVersion.tier.rank < tier.rank &&
      current.months === months &&
      !future.length &&
      input.mode === "AUTO"
    ) {
      kind = "UPGRADE";
      endsAt = current.endsAt!;
      anchorAt = current.anchorAt ?? current.startsAt;
      const remaining =
        (endsAt.getTime() - now.getTime()) /
        (endsAt.getTime() - current.startsAt.getTime());
      const fullEnd = nextMembershipEnd(anchorAt, now, months);
      const fullStart = addMembershipMonths(
        anchorAt,
        Math.max(
          0,
          Math.round(
            (Number(dayKey(fullEnd).slice(0, 4)) -
              Number(dayKey(anchorAt).slice(0, 4))) *
              12 +
              Number(dayKey(fullEnd).slice(5, 7)) -
              Number(dayKey(anchorAt).slice(5, 7)) -
              months,
          ),
        ),
      );
      gross = Math.ceil(
        (price * (endsAt.getTime() - now.getTime())) /
          (fullEnd.getTime() - fullStart.getTime()),
      );
      credit = Math.floor(current.prepaidValue * remaining);
      baseEntitlementId = current.id;
      if (gross <= credit)
        fail(
          "NO_UPGRADE_CHARGE",
          "Gói hiện tại có giá trị còn lại cao hơn báo giá. Hãy chọn bắt đầu ở kỳ tiếp theo.",
        );
    } else if (last?.endsAt && last.endsAt > now) {
      kind = last.tierVersion.tierId === tier.id ? "RENEW" : "SCHEDULE";
      startsAt = last.endsAt;
      anchorAt =
        last.tierVersion.tierId === tier.id && last.months === months
          ? (last.anchorAt ?? last.startsAt)
          : startsAt;
      endsAt = nextMembershipEnd(anchorAt, startsAt, months);
    }
    await tx.membershipInvoice.updateMany({
      where: { userId, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    const invoice = await tx.membershipInvoice.create({
      data: {
        userId,
        tierVersionId: tier.versionId,
        code: `FLM${randomBytes(6).toString("hex").toUpperCase()}`,
        idempotencyKey: input.idempotencyKey,
        cycle: input.cycle,
        kind,
        amount: gross - credit,
        gross,
        credit,
        startsAt,
        endsAt,
        anchorAt,
        baseEntitlementId,
        fingerprint: fingerprint(schedule),
        expiresAt: new Date(now.getTime() + 15 * 60000),
      },
    });
    return invoice.id;
  });
}

export async function sepayMembershipAvailable() {
  return (await getSepayConfig()).configured;
}

export async function confirmMembershipInvoice(
  userId: string,
  invoiceId: string,
  accepted: boolean,
) {
  if (!accepted) fail("CONSENT_REQUIRED", "Cần đồng ý điều lệ gói hội viên.");
  return atomic(async (tx) => {
    if (!(await lockSepayConfig(tx)).configured)
      fail(
        "PAYMENT_NOT_CONFIGURED",
        "Cửa hàng chưa cấu hình thanh toán SePay cho gói hội viên.",
        503,
      );
    await lockMember(tx, userId);
    const invoice = await tx.membershipInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    if (invoice.userId !== userId)
      fail("NOT_FOUND", "Không tìm thấy hóa đơn.", 404);
    if (["PENDING", "PAID"].includes(invoice.status)) return;
    if (invoice.status !== "DRAFT" || invoice.expiresAt <= new Date())
      fail(
        "QUOTE_EXPIRED",
        "Báo giá đã hết hạn. Chọn lại gói để kiểm tra giá.",
      );
    if (invoice.fingerprint !== fingerprint(await paidSchedule(tx, userId)))
      fail(
        "PLAN_CHANGED",
        "Lịch gói đã thay đổi. Vui lòng lấy báo giá mới.",
        409,
      );
    if (!(await getSettings(tx)).memberEnabled)
      fail("MEMBERSHIP_PAUSED", "Chương trình đang tạm dừng.");
    await tx.membershipInvoice.update({
      where: { id: invoiceId },
      data: { status: "PENDING", acceptedAt: new Date() },
    });
    await tx.outbox.create({
      data: {
        userId,
        event: "membership.invoice_created",
        payload: { invoiceId },
      },
    });
    await tx.audit.create({
      data: {
        actorId: userId,
        action: "membership.purchase.consent",
        entityId: invoiceId,
        detail: { terms: MEMBERSHIP_TERMS, amount: invoice.amount },
      },
    });
  });
}

export async function cancelMembershipInvoice(
  userId: string,
  invoiceId: string,
) {
  return atomic(async (tx) => {
    await lockMember(tx, userId);
    const i = await tx.membershipInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    if (i.userId !== userId) fail("NOT_FOUND", "Không tìm thấy hóa đơn.", 404);
    if (!["DRAFT", "PENDING", "EXPIRED"].includes(i.status))
      fail(
        "INVOICE_STATE",
        "Không thể hủy hóa đơn đã nhận tiền hoặc cần đối soát.",
      );
    await tx.membershipInvoice.update({
      where: { id: i.id },
      data: { status: "CANCELLED" },
    });
  });
}

export async function getMembershipInvoice(
  invoiceId: string,
  client: Client = db,
): Promise<MembershipInvoiceView> {
  const i = await client.membershipInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { tierVersion: { include: { tier: true } }, refunds: true },
  });
  const expired =
    ["DRAFT", "PENDING"].includes(i.status) && i.expiresAt <= new Date();
  const status = expired ? "EXPIRED" : i.status;
  const sepay = await getSepayConfig(client);
  const qr =
    status === "PENDING" ? sepayQrUrl(sepay, i.amount, i.code) : undefined;
  return {
    id: i.id,
    code: i.code,
    userId: i.userId,
    cycle: i.cycle,
    kind: i.kind,
    status,
    amount: i.amount,
    gross: i.gross,
    credit: i.credit,
    startsAt: i.startsAt.toISOString(),
    endsAt: i.endsAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    activatedAt: i.activatedAt?.toISOString() ?? null,
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    reason: i.reason,
    createdAt: i.createdAt.toISOString(),
    tier: tierView(i.tierVersion),
    refunds: i.refunds.map((r) => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      status: r.status,
      reference: r.reference,
      revokeAccess: r.revokeAccess,
    })),
    paymentQr: qr,
    bank: qr ? sepay.bank : undefined,
    accountNumber: qr ? sepay.accountNumber : undefined,
    accountName: qr ? sepay.accountName : undefined,
  };
}

/** Called inside the shared payment transaction; a provider ID is unique across both purchase types. */
export async function activateMembershipInvoice(
  tx: Tx,
  invoice: MembershipInvoice,
  now = new Date(),
) {
  if (
    invoice.status !== "PENDING" ||
    !invoice.acceptedAt ||
    invoice.expiresAt <= now
  )
    return false;
  if (
    await tx.membershipRefund.count({
      where: { status: "PENDING", invoice: { userId: invoice.userId } },
    })
  )
    return false;
  const user = await tx.user.findUniqueOrThrow({
    where: { id: invoice.userId },
  });
  if (!user.memberSince || !user.verified || user.disabled) return false;
  const schedule = await paidSchedule(tx, invoice.userId);
  if (invoice.fingerprint !== fingerprint(schedule)) return false;
  const months = invoice.cycle === "MONTH" ? 1 : 12;
  let startsAt = invoice.startsAt,
    endsAt = invoice.endsAt,
    anchorAt = invoice.anchorAt;
  if (invoice.kind === "UPGRADE") {
    const base = schedule.find((e) => e.id === invoice.baseEntitlementId);
    if (!base || !live(base, now)) return false;
    await tx.membershipEntitlement.update({
      where: { id: base.id },
      data: { endsAt: now, prepaidValue: 0 },
    });
    startsAt = now;
  } else if (invoice.kind === "PURCHASE" || startsAt < now) {
    startsAt = now;
    anchorAt = now;
    endsAt = addMembershipMonths(now, months);
  }
  const entitlement = await tx.membershipEntitlement.create({
    data: {
      userId: invoice.userId,
      tierVersionId: invoice.tierVersionId,
      source: "PAID",
      sourceKey: `invoice:${invoice.id}`,
      invoiceId: invoice.id,
      startsAt,
      endsAt,
      anchorAt,
      months,
      prepaidValue: invoice.gross,
      reason:
        invoice.kind === "UPGRADE"
          ? "Nâng gói trả phí, giữ ngày kết thúc."
          : "Mua gói hội viên qua SePay.",
    },
  });
  await tx.membershipInvoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", activatedAt: now, startsAt, endsAt, anchorAt },
  });
  const summary = await resolveMembership(invoice.userId, tx, now);
  await tx.user.update({
    where: { id: invoice.userId },
    data: { tier: summary.current?.name ?? "Member" },
  });
  await memberEvent(
    tx,
    invoice.userId,
    "paid_activated",
    { invoiceId: invoice.id, amount: invoice.amount, kind: invoice.kind },
    entitlement.id,
  );
  await tx.notification.create({
    data: {
      userId: invoice.userId,
      title: "Gói hội viên đã được xác nhận",
      body: "Mở thẻ để xem thời hạn và đặc quyền của bạn.",
      url: `/membership/invoices/${invoice.id}`,
    },
  });
  return true;
}

export async function issueBirthdayReward(
  tx: Tx,
  userId: string,
  now = new Date(),
) {
  const user = await lockMember(tx, userId);
  const today = dayKey(now),
    birthday = user.birthDate?.slice(5);
  const februaryLastDay = new Date(
    Date.UTC(Number(today.slice(0, 4)), 2, 0),
  ).getUTCDate();
  if (
    !birthday ||
    (birthday !== today.slice(5) &&
      !(
        birthday === "02-29" &&
        februaryLastDay === 28 &&
        today.slice(5) === "02-28"
      ))
  )
    return;
  const s = await resolveMembership(userId, tx, now),
    t = s.current;
  if (!t || !t.birthdayPercent || !t.birthdayCap) return;
  await tx.reward.upsert({
    where: {
      userId_ruleKey_period: {
        userId,
        ruleKey: "membership-birthday",
        period: dayKey(now).slice(0, 4),
      },
    },
    update: {},
    create: {
      userId,
      ruleKey: "membership-birthday",
      period: dayKey(now).slice(0, 4),
      title: `Một món quà sinh nhật · ${t.name}`,
      percent: t.birthdayPercent,
      cap: t.birthdayCap,
      minimum: t.birthdayMinimum,
      validDays: t.birthdayDays,
      threshold: 0,
      earnedDay: dayKey(now),
      expiresAt: new Date(now.getTime() + t.birthdayDays * 86400000),
    },
  });
}

export async function membershipMaintenance(recheck = false) {
  const now = new Date();
  await db.membershipInvoice.updateMany({
    where: { status: { in: ["DRAFT", "PENDING"] }, expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  // Cursor pagination avoids starving older members on a bounded first page.
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const users = await db.user.findMany({
      where: { memberSince: { not: null }, disabled: false },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!users.length) break;
    for (const user of users)
      await atomic(async (tx) => {
        await lockMember(tx, user.id);
        if (!user.membershipMigrated) await migrateLegacyMember(tx, user.id);
        if (recheck) await syncEarnedMembership(tx, user.id);
        const s = await resolveMembership(user.id, tx);
        if (s.current?.name && s.current.name !== user.tier) {
          await tx.user.update({
            where: { id: user.id },
            data: { tier: s.current.name },
          });
          await memberEvent(tx, user.id, "effective_changed", {
            before: user.tier,
            after: s.current.name,
          });
        }
        await issueBirthdayReward(tx, user.id, now);
        for (const days of [7, 1, 0]) {
          const ending = await tx.membershipEntitlement.findMany({
            where: {
              userId: user.id,
              source: "PAID",
              revokedAt: null,
              endsAt: {
                gte: new Date(`${shiftDay(dayKey(now), days)}T00:00:00+07:00`),
                lt: new Date(
                  `${shiftDay(dayKey(now), days + 1)}T00:00:00+07:00`,
                ),
              },
            },
          });
          for (const e of ending) {
            const next = await tx.membershipEntitlement.findFirst({
              where: {
                userId: user.id,
                source: "PAID",
                revokedAt: null,
                startsAt: e.endsAt!,
                id: { not: e.id },
              },
            });
            if (next) continue;
            const key = `membership-reminder:${e.id}:${days}`;
            const exists = await tx.notification.findUnique({
              where: { dedupKey: key },
            });
            if (!exists) {
              await tx.notification.create({
                data: {
                  userId: user.id,
                  dedupKey: key,
                  title: days
                    ? `Gói hội viên còn ${days} ngày`
                    : "Gói hội viên kết thúc hôm nay",
                  body: "Bạn có thể chủ động gia hạn. Hạng tích lũy vẫn được giữ.",
                  url: "/membership",
                },
              });
              await tx.outbox.create({
                data: {
                  userId: user.id,
                  event: "notification.created",
                  payload: { url: "/membership" },
                },
              });
            }
          }
        }
      });
    count += users.length;
    cursor = users.at(-1)!.id;
  }
  return count;
}
