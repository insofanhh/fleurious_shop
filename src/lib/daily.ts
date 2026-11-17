import { randomBytes } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import { fail } from "./errors";
import { analyticsEnabled, queueAnalytics } from "./analytics";
import { can } from "./auth-policy";
import { dayKey, localInstant, shiftDay } from "./time";
import { isDailyCategory, productClassifications } from "./catalogue";
import { allocateDailyFlowers } from "./daily-selection";
import { getSettings } from "./settings";
import { orderShipping } from "./shipping";
import { getSepayConfig, lockSepayConfig, sepayQrUrl } from "./sepay-settings";
import {
  defaultDailyPolicy,
  dailyPolicySchema,
  type DailyPolicy,
  type DailyOfferingView,
} from "./daily-types";
import {
  dailyAmounts,
  dailyDay,
  dailyLockAt,
  validateDailyDates,
} from "./daily-pricing";
import type { ShippingSnapshot } from "./shipping-types";

type Actor = Pick<User, "id" | "role">;
type Client = Tx | typeof db;
const key = "daily_program";
export async function dailyCommittedSubsidy(client: Client = db) {
  const sum = await client.dailyDelivery.aggregate({
    where: {
      OR: [
        { reservation: { in: ["HELD", "CONFIRMED"] } },
        { state: "UNSCHEDULED", plan: { state: { in: ["ACTIVE", "PAUSED"] } } },
      ],
    },
    _sum: { subsidy: true },
  });
  return sum._sum.subsidy ?? 0;
}
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const code = () => `FLD${randomBytes(6).toString("hex").toUpperCase()}`;
const idSchema = z.string().min(1).max(100);
const short = z.string().trim().max(100);
const versionSchema = z.number().int().positive();
const prefsSchema = z.object({
  colors: z.array(z.string().max(40)).max(10).default([]),
  avoidTags: z.array(z.string().max(40)).max(20).default([]),
  style: z.string().trim().max(80).default(""),
  surprise: z.boolean().default(false),
});
const dateInput = z.object({
  day: z.string(),
  slotId: idSchema,
  offeringId: idSchema.optional(),
  autoSelected: z.boolean().default(false),
  message: z.string().max(800).optional(),
  writingMode: z.enum(["AUTO", "HANDWRITTEN"]).default("AUTO"),
});
export const dailyQuoteSchema = z.object({
  budgetCode: z.string().default("catalog"),
  mode: z.enum(["SELF", "AUTO", "MIXED"]),
  days: z.array(dateInput).min(1).max(31),
  preferences: prefsSchema.default({
    colors: [],
    avoidTags: [],
    style: "",
    surprise: false,
  }),
  theme: z.string().max(40).default("Dịu dàng"),
  shippingQuoteId: idSchema,
  locationId: idSchema,
  addressDetails: z.string().trim().max(200).default(""),
  recipientName: z.string().trim().min(2).max(100).default("Người nhận"),
  senderName: short.default("Bạn"),
  recipientPhone: z.string().trim().max(30).default(""),
  expectedVersion: versionSchema.optional(),
});
export const dailyCreateSchema = dailyQuoteSchema.extend({
  idempotencyKey: z.string().min(10).max(100),
  expectedTotal: z.number().int().positive(),
  expectedVersion: versionSchema,
  accepted: z.literal(true),
  recipientPhone: z
    .string()
    .trim()
    .regex(/^[+0-9 .()-]{8,20}$/, "Nhập số điện thoại người nhận hợp lệ."),
});
export async function dailyConfig(client: Client = db) {
  const row = await client.setting.findUnique({ where: { key } });
  return {
    policy: row
      ? dailyPolicySchema.parse({
          ...(row.value as object),
          pricingMode: "PRODUCT",
        })
      : defaultDailyPolicy,
    version: row?.version ?? 1,
  };
}
export async function lockDaily(tx: Tx) {
  await tx.$executeRaw`INSERT INTO Setting (\`key\`, value, version, updatedAt) VALUES ('daily_guard', '{}', 1, NOW(3)) ON DUPLICATE KEY UPDATE \`key\`=\`key\``;
  await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='daily_guard' FOR UPDATE`;
}
function staff(actor: Actor, area = "orders") {
  if (!can(actor.role, area))
    fail("FORBIDDEN", "Bạn không có quyền quản lý mục này.", 403);
}
function manager(actor: Actor) {
  if (!["OWNER", "MANAGER"].includes(actor.role))
    fail("FORBIDDEN", "Chỉ quản lý được thực hiện thay đổi này.", 403);
}
async function history(
  tx: Tx,
  planId: string,
  actorId: string,
  action: string,
  detail: unknown,
) {
  await tx.dailyHistory.create({
    data: { planId, actorId, action, detail: json(detail) },
  });
}
async function changed(
  tx: Tx,
  plan: { id: string; userId: string },
  event: string,
  body: string,
  dedup?: string,
) {
  if (
    dedup &&
    (await tx.notification.findUnique({ where: { dedupKey: dedup } }))
  )
    return;
  await tx.notification.create({
    data: {
      userId: plan.userId,
      title: "Fleurious Daily",
      body,
      url: `/account/daily/${plan.id}`,
      dedupKey: dedup,
    },
  });
  await tx.outbox.create({
    data: { userId: plan.userId, event, payload: { planId: plan.id } },
  });
}
export async function dailyOfferings(
  client: Client = db,
  admin = false,
): Promise<DailyOfferingView[]> {
  const rows = await client.dailyOffering.findMany({
    where: admin ? {} : { active: true },
    orderBy: { createdAt: "asc" },
  });
  const variants = await client.productVariant.findMany({
    where: { id: { in: rows.map((o) => o.variantId) } },
    include: {
      product: { include: { taxonomies: { include: { taxonomy: true } } } },
    },
  });
  return rows.flatMap((o) => {
    const v = variants.find((v) => v.id === o.variantId);
    if (!v) return [];
    const inDaily = productClassifications(v.product).categories.some(
      isDailyCategory,
    );
    if (!admin && (!v.product.active || !inDaily)) return [];
    return [
      {
        id: o.id,
        variantId: o.variantId,
        budgetCode: o.budgetCode,
        name: v.product.name,
        description: o.description,
        tags: o.tags as string[],
        premium: o.premium,
        price: v.price,
        active: o.active && v.product.active && inDaily,
        image: v.product.image,
        productId: v.productId,
        productName: v.product.name,
        color: v.product.color,
        variantName: v.name,
        ...(admin ? { cost: o.cost, capacity: o.capacity } : {}),
      },
    ];
  });
}
export async function dailyPublic() {
  const [{ policy, version }, offerings, slots, settings] = await Promise.all([
    dailyConfig(),
    dailyOfferings(),
    db.deliverySlot.findMany({
      where: { active: true },
      orderBy: { startHour: "asc" },
    }),
    getSettings(),
  ]);
  // Public policy excludes raw costs, campaign budget and internal capacity.
  const publicPolicy = {
    ...policy,
    packingCost: 0,
    minimumMargin: 0,
    campaignBudget: 0,
    capacityPerDay: 0,
    blackoutDates: [
      ...new Set([...policy.blackoutDates, ...settings.blackoutDates]),
    ],
  };
  return {
    policy: publicPolicy,
    version,
    offerings,
    slots: slots.map(({ id, label, startHour, endHour }) => ({
      id,
      label,
      startHour,
      endHour,
    })),
    today: dayKey(),
    serverNow: new Date().toISOString(),
  };
}
export async function suggestDailyFlowers(userId: string, raw: unknown) {
  const input = z
    .object({
      days: z
        .array(dateInput.pick({ day: true, slotId: true, offeringId: true }))
        .min(1)
        .max(31),
      seed: z.string().min(8).max(100),
      offeringIds: z.array(idSchema).min(1).max(1000),
      preferences: prefsSchema,
    })
    .parse(raw);
  const [{ policy }, settings, pool, slots] = await Promise.all([
    dailyConfig(),
    getSettings(),
    dailyOfferings(db, true),
    db.deliverySlot.findMany({ where: { active: true } }),
  ]);
  if (!policy.enabled)
    fail("DAILY_DISABLED", "Fleurious Daily đang chuẩn bị mở lịch mới.");
  const sorted = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
  validateDailyDates(
    sorted.map((d) => ({
      day: d.day,
      startHour: slots.find((s) => s.id === d.slotId)?.startHour ?? -1000,
    })),
    policy,
    settings.blackoutDates,
  );
  const supply = await db.dailyDelivery.groupBy({
    by: ["day", "offeringId"],
    where: {
      day: { in: sorted.map((d) => d.day) },
      reservation: { in: ["HELD", "CONFIRMED"] },
    },
    _count: { _all: true },
  });
  const eligible = pool.filter(
    (o) =>
      o.active &&
      input.offeringIds.includes(o.id) &&
      !input.preferences.avoidTags.some((t) =>
        o.tags.some((tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase()),
      ),
  );
  return allocateDailyFlowers(
    sorted.map((d) => ({
      ...d,
      choices: eligible
        .filter(
          (o) =>
            (supply.find((s) => s.day === d.day && s.offeringId === o.id)
              ?._count._all ?? 0) < (o.capacity ?? 0),
        )
        .map((o) => ({
          ...o,
          priority: o.tags.includes(input.preferences.style) ? 3 : 0,
        })),
    })),
    `${userId}:${input.seed}`,
  );
}
export async function publishDaily(actor: Actor, raw: unknown) {
  staff(actor, "settings");
  const input = z
    .object({ version: versionSchema, policy: dailyPolicySchema })
    .parse(raw);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const current = await dailyConfig(tx);
    if (current.version !== input.version)
      fail(
        "STALE_VERSION",
        "Cấu hình vừa thay đổi. Tải lại trước khi lưu.",
        409,
      );
    if (input.policy.enabled) {
      const offerings = await dailyOfferings(tx);
      if (!offerings.length)
        fail(
          "DAILY_POOL_EMPTY",
          "Thêm sản phẩm vào danh mục Hoa mỗi ngày và chuẩn bị size bán trước khi mở bán.",
        );
    }
    await tx.setting.upsert({
      where: { key },
      create: { key, value: json(input.policy), version: current.version + 1 },
      update: { value: json(input.policy), version: { increment: 1 } },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "daily.policy_published",
        entityId: key,
        detail: { version: current.version + 1 },
      },
    });
    await tx.outbox.create({
      data: { event: "catalog.changed", payload: { daily: true } },
    });
    return dailyConfig(tx);
  });
}
export async function saveDailyOffering(
  actor: Actor,
  raw: unknown,
  id?: string,
) {
  staff(actor, "settings");
  const data = z
    .object({
      variantId: idSchema,
      budgetCode: z.string().max(30).default("catalog"),
      description: z.string().trim().max(1000),
      tags: z.array(z.string().trim().min(1).max(40)).max(30),
      premium: z.number().int().min(0).max(10000000),
      cost: z.number().int().min(0).max(10000000),
      capacity: z.number().int().min(1).max(500),
      active: z.boolean(),
    })
    .parse(raw);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const variant = await tx.productVariant.findUnique({
      where: { id: data.variantId },
      include: {
        product: { include: { taxonomies: { include: { taxonomy: true } } } },
      },
    });
    if (!variant) fail("NOT_FOUND", "Size hoa không tồn tại.", 404);
    if (
      !productClassifications(variant.product).categories.some(isDailyCategory)
    )
      fail(
        "DAILY_CATEGORY",
        "Chọn danh mục Hoa mỗi ngày trong sản phẩm trước khi thêm mẫu.",
      );
    const duplicate = await tx.dailyOffering.findUnique({
      where: {
        variantId_budgetCode: {
          variantId: data.variantId,
          budgetCode: data.budgetCode,
        },
      },
    });
    if (duplicate && duplicate.id !== id)
      fail(
        "DAILY_OFFERING_EXISTS",
        "Sản phẩm và size này đã có trong nhóm ngân sách. Hãy chỉnh mẫu đã có hoặc chọn size khác.",
        409,
      );
    const saved = { ...data, name: variant.product.name };
    const result = id
      ? await tx.dailyOffering.update({ where: { id }, data: saved })
      : await tx.dailyOffering.create({ data: saved });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "daily.offering_saved",
        entityId: result.id,
        detail: { active: data.active },
      },
    });
    return result;
  });
}
async function checkCapacity(
  tx: Tx,
  day: string,
  slotId: string,
  policy: DailyPolicy,
  offeringId?: string,
  excludeId?: string,
) {
  const slot = await tx.deliverySlot.findUnique({ where: { id: slotId } });
  if (!slot?.active) fail("DAILY_SLOT", "Khung giao đã ngừng nhận lịch.");
  const booking = await tx.slotBooking.findUnique({
    where: { day_slotId: { day, slotId } },
  });
  if ((booking?.count ?? 0) >= slot.capacity)
    fail("DELIVERY_SLOT_FULL", `Khung ${slot.label} ngày ${day} vừa đầy.`, 409);
  const base = {
    day,
    reservation: { in: ["HELD", "CONFIRMED"] },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
  if ((await tx.dailyDelivery.count({ where: base })) >= policy.capacityPerDay)
    fail("DAILY_CAPACITY", `Ngày ${day} đã đủ lịch Daily.`, 409);
  if (offeringId) {
    const o = await tx.dailyOffering.findUnique({ where: { id: offeringId } });
    if (
      !o?.active ||
      (await tx.dailyDelivery.count({ where: { ...base, offeringId } })) >=
        o.capacity
    )
      fail("DAILY_SUPPLY", `Mẫu hoa ngày ${day} đã đủ lượng chuẩn bị.`, 409);
  }
  return slot;
}
async function reserve(tx: Tx, day: string, slotId: string, capacity: number) {
  await tx.slotBooking.upsert({
    where: { day_slotId: { day, slotId } },
    create: { day, slotId },
    update: {},
  });
  if (
    !(await tx.$executeRaw`UPDATE SlotBooking SET count=count+1 WHERE day=${day} AND slotId=${slotId} AND count<${capacity}`)
  )
    fail("DELIVERY_SLOT_FULL", `Khung giao ngày ${day} vừa đầy.`, 409);
}
async function release(
  tx: Tx,
  d: { id: string; day: string; slotId: string; reservation: string },
) {
  if (!["HELD", "CONFIRMED"].includes(d.reservation)) return;
  await tx.slotBooking.updateMany({
    where: { day: d.day, slotId: d.slotId, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
  await tx.dailyDelivery.update({
    where: { id: d.id },
    data: { reservation: "RELEASED" },
  });
}
export async function expireDailyTx(tx: Tx, now = new Date()) {
  const plans = await tx.dailyPlan.findMany({
    where: { state: "PENDING_PAYMENT", expiresAt: { lte: now } },
    include: { deliveries: true },
    take: 1,
  });
  for (const p of plans) {
    // Bound the transaction even for a month of deliveries over a remote DB.
    for (const d of p.deliveries.filter((d) => d.reservation === "HELD"))
      await tx.slotBooking.updateMany({
        where: { day: d.day, slotId: d.slotId, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
    await tx.dailyDelivery.updateMany({
      where: { planId: p.id, reservation: "HELD" },
      data: { reservation: "RELEASED" },
    });
    await tx.dailyPlan.update({
      where: { id: p.id },
      data: { state: "EXPIRED", version: { increment: 1 } },
    });
    await tx.dailyInvoice.updateMany({
      where: { planId: p.id, state: "PENDING", kind: "PURCHASE" },
      data: { state: "EXPIRED" },
    });
  }
  await tx.dailyInvoice.updateMany({
    where: { state: "PENDING", kind: "UPGRADE", expiresAt: { lte: now } },
    data: { state: "EXPIRED" },
  });
  return plans.length;
}
async function quotation(
  client: Client,
  raw: unknown,
  userId: string,
  now = new Date(),
) {
  const input = dailyQuoteSchema.parse(raw),
    { policy, version } = await dailyConfig(client);
  if (!policy.enabled)
    fail("DAILY_DISABLED", "Fleurious Daily đang chuẩn bị mở lịch mới.");
  if (input.expectedVersion && input.expectedVersion !== version)
    fail("PRICE_CHANGED", "Giá gói vừa cập nhật. Xem lại báo giá.", 409);
  const settings = await getSettings(client);
  const slots = await client.deliverySlot.findMany({ where: { active: true } });
  const sorted = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
  validateDailyDates(
    sorted.map((d) => ({
      day: d.day,
      startHour: slots.find((s) => s.id === d.slotId)?.startHour ?? -1000,
    })),
    policy,
    settings.blackoutDates,
    now,
  );
  const shipping = await orderShipping(input, `user:${userId}`, client);
  const meters = shipping.snapshot?.distanceMeters;
  if (meters === null || meters === undefined)
    fail("DAILY_SHIPPING", "Cần báo giá quãng đường Goong cho lịch Daily.");
  const amounts = dailyAmounts(
    policy,
    input.budgetCode,
    sorted.length,
    shipping.fee,
    meters,
  );
  const pool = await dailyOfferings(client, true);
  const dateKeys = sorted.map((d) => d.day);
  const [supply, bookings] = await Promise.all([
    client.dailyDelivery.groupBy({
      by: ["day", "offeringId"],
      where: {
        day: { in: dateKeys },
        reservation: { in: ["HELD", "CONFIRMED"] },
      },
      _count: { _all: true },
    }),
    client.slotBooking.findMany({ where: { day: { in: dateKeys } } }),
  ]);
  const templates = policy.messages.filter((m) => m.theme === input.theme);
  const messages = [
    ...new Map(
      (templates.length ? templates : policy.messages).map((m) => [m.text, m]),
    ).values(),
  ];
  if (messages.length < sorted.filter((d) => d.message === undefined).length)
    fail(
      "DAILY_MESSAGE_POOL",
      "Chủ đề chưa có đủ lời chúc khác nhau. Chọn chủ đề khác hoặc tự viết thêm lời nhắn.",
    );
  const usedMessages = new Set<string>();
  let allocated = 0,
    flowerGross = 0;
  const days = [];
  const eligible = pool.filter(
    (o) =>
      o.active &&
      (policy.pricingMode === "PRODUCT" || o.budgetCode === input.budgetCode) &&
      !input.preferences.avoidTags.some((t) =>
        o.tags.some((tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase()),
      ),
  );
  if (input.mode === "SELF" && sorted.some((d) => !d.offeringId))
    fail(
      "DAILY_SELECTION",
      "Chọn mẫu cho từng ngày hoặc cho phép Fleurious chọn giúp.",
    );
  const selections = allocateDailyFlowers(
    sorted.map((d) => ({
      ...d,
      choices: eligible
        .filter(
          (o) =>
            (policy.pricingMode === "PRODUCT" ||
              !o.premium ||
              d.offeringId === o.id) &&
            (supply.find((s) => s.day === d.day && s.offeringId === o.id)
              ?._count._all ?? 0) < (o.capacity ?? 0),
        )
        .map((o) => ({
          ...o,
          priority:
            (input.preferences.colors.includes(o.color) ? 5 : 0) +
            (o.tags.includes(input.preferences.style) ? 3 : 0),
        })),
    })),
    `${userId}:${sorted.map((d) => d.day).join(",")}`,
  );
  for (const [index, d] of sorted.entries()) {
    const slot = slots.find((s) => s.id === d.slotId);
    if (!slot) fail("DAILY_SLOT", "Chọn khung giờ giao hợp lệ.");
    const offering = eligible.find(
      (o) => o.id === selections[index].offeringId,
    );
    if (!offering)
      fail(
        "DAILY_POOL_EMPTY",
        `Chưa có mẫu phù hợp ngày ${d.day}. Thử lịch khác hoặc liên hệ cửa hàng.`,
      );
    if (
      (supply.find((s) => s.day === d.day && s.offeringId === offering.id)
        ?._count._all ?? 0) >= (offering.capacity ?? 0)
    )
      fail("DAILY_SUPPLY", `Mẫu hoa ngày ${d.day} đã đủ lượng chuẩn bị.`, 409);
    const base =
      policy.pricingMode === "PRODUCT" ? offering.price : amounts.base;
    flowerGross += base;
    const discount =
      policy.pricingMode === "PRODUCT"
        ? Math.round((flowerGross * amounts.percent) / 100) - allocated
        : index === sorted.length - 1
          ? amounts.discount - allocated
          : Math.floor(amounts.discount / sorted.length);
    allocated += discount;
    // Prefer each day's original position so editing one wish does not shift all later wishes.
    let template = d.message;
    if (template === undefined) {
      const offset = index % messages.length;
      template = [...messages.slice(offset), ...messages.slice(0, offset)].find(
        (m) => !usedMessages.has(m.text),
      )!.text;
      usedMessages.add(template);
    }
    const message = template
      .replaceAll("{recipient}", input.recipientName)
      .replaceAll("{sender}", input.senderName);
    if (message.length > 800)
      fail(
        "DAILY_MESSAGE",
        "Lời chúc sau khi điền tên không được vượt 800 ký tự.",
      );
    const total =
      base -
      discount +
      (policy.pricingMode === "PRODUCT" ? 0 : offering.premium) +
      shipping.fee -
      amounts.subsidy;
    const margin =
      total - (offering.cost ?? 0) - policy.packingCost - shipping.fee;
    if (margin < policy.minimumMargin)
      fail(
        "DAILY_MARGIN",
        `Lịch ngày ${d.day} cần cửa hàng điều chỉnh giá hoặc phí hỗ trợ.`,
      );
    const count = supply
      .filter((s) => s.day === d.day)
      .reduce((n, s) => n + s._count._all, 0);
    const booking = bookings.find(
      (b) => b.day === d.day && b.slotId === d.slotId,
    );
    if (
      count >= policy.capacityPerDay ||
      (booking?.count ?? 0) >= slot.capacity
    )
      fail("DAILY_CAPACITY", `Ngày ${d.day} hoặc khung giờ đã đủ lịch.`, 409);
    days.push({
      ...d,
      offeringId: offering.id,
      approved: !!d.offeringId && !d.autoSelected,
      selectionSnapshot: offering,
      message,
      slotLabel: slot.label,
      startHour: slot.startHour,
      endHour: slot.endHour,
      lockAt: dailyLockAt(d.day, policy),
      base,
      discount,
      premium: policy.pricingMode === "PRODUCT" ? 0 : offering.premium,
      shippingGross: shipping.fee,
      subsidy: amounts.subsidy,
      total,
    });
  }
  const committed = await dailyCommittedSubsidy(client);
  if (
    committed + days.reduce((n, d) => n + d.subsidy, 0) >
    policy.campaignBudget
  )
    fail(
      "DAILY_SHIP_BUDGET",
      "Ưu đãi ship tạm hết ngân sách. Liên hệ cửa hàng để được hỗ trợ.",
      409,
    );
  return {
    input,
    policy,
    version,
    shipping,
    days,
    total: days.reduce((n, d) => n + d.total, 0),
    discount: allocated,
    percent: amounts.percent,
    subsidy: days.reduce((n, d) => n + d.subsidy, 0),
    shippingTotal: days.reduce((n, d) => n + d.shippingGross - d.subsidy, 0),
    expiresAt: new Date(now.getTime() + policy.holdMinutes * 60000),
  };
}
export async function quoteDaily(userId: string, raw: unknown) {
  const q = await quotation(db, raw, userId);
  return {
    version: q.version,
    total: q.total,
    discount: q.discount,
    percent: q.percent,
    subsidy: q.subsidy,
    shippingTotal: q.shippingTotal,
    days: q.days.map(({ selectionSnapshot, ...d }) => ({
      ...d,
      selection: {
        id: selectionSnapshot.id,
        name: selectionSnapshot.name,
        image: selectionSnapshot.image,
        variantName: selectionSnapshot.variantName,
      },
    })),
    terms: q.policy.terms,
    serverNow: new Date().toISOString(),
  };
}
export async function createDaily(
  user: User,
  raw: unknown,
  options: { analyticsClientId?: string } = {},
) {
  const input = dailyCreateSchema.parse(raw);
  return atomic(async (tx) => {
    const bank = await lockSepayConfig(tx);
    if (!bank.configured)
      fail(
        "PAYMENT_NOT_CONFIGURED",
        "Cửa hàng chưa bật thanh toán SePay.",
        503,
      );
    await lockDaily(tx);
    const existing = await tx.dailyPlan.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== user.id)
        fail("CONFLICT", "Yêu cầu đã được dùng.", 409);
      return existing;
    }
    await expireDailyTx(tx);
    const q = await quotation(tx, input, user.id);
    if (q.total !== input.expectedTotal)
      fail(
        "PRICE_CHANGED",
        "Giá hoặc lịch vừa thay đổi. Kiểm tra tổng tiền trước khi thanh toán.",
        409,
      );
    const p = await tx.dailyPlan.create({
      data: {
        code: code(),
        idempotencyKey: input.idempotencyKey,
        userId: user.id,
        buyerName: user.name,
        buyerEmail: user.email,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        senderName: input.senderName,
        address: q.shipping.address ?? "",
        shippingSnapshot: json(q.shipping.snapshot),
        policy: json({ ...q.policy, version: q.version }),
        budgetCode: input.budgetCode,
        selectionMode: input.mode,
        preferences: json(input.preferences),
        total: q.total,
        subsidy: q.subsidy,
        expiresAt: q.expiresAt,
      },
    });
    const allocations = [];
    const slotMap = new Map(
      (
        await tx.deliverySlot.findMany({
          where: { id: { in: q.days.map((d) => d.slotId) } },
        })
      ).map((s) => [s.id, s]),
    );
    await tx.slotBooking.createMany({
      data: q.days.map((d) => ({ day: d.day, slotId: d.slotId })),
      skipDuplicates: true,
    });
    const deliveryRows = [];
    for (const d of q.days) {
      const slot = slotMap.get(d.slotId)!;
      if (
        !(await tx.$executeRaw`UPDATE SlotBooking SET count=count+1 WHERE day=${d.day} AND slotId=${d.slotId} AND count<${slot.capacity}`)
      )
        fail("DELIVERY_SLOT_FULL", `Khung giao ngày ${d.day} vừa đầy.`, 409);
      const deliveryId = `dld_${randomBytes(12).toString("hex")}`;
      deliveryRows.push({
        id: deliveryId,
        planId: p.id,
        day: d.day,
        slotId: d.slotId,
        slotLabel: d.slotLabel,
        startHour: d.startHour,
        endHour: d.endHour,
        lockAt: d.lockAt,
        offeringId: d.offeringId,
        approved: d.approved,
        selectionSnapshot: json(d.selectionSnapshot),
        message: d.message,
        writingMode: d.writingMode,
        base: d.base,
        discount: d.discount,
        premium: d.premium,
        shippingGross: d.shippingGross,
        subsidy: d.subsidy,
        total: d.total,
      });
      allocations.push({ deliveryId, amount: d.total });
    }
    await tx.dailyDelivery.createMany({ data: deliveryRows });
    await tx.dailyInvoice.create({
      data: {
        planId: p.id,
        code: p.code,
        amount: p.total,
        allocation: json(allocations),
        expiresAt: p.expiresAt,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await history(tx, p.id, user.id, "created", {
      version: q.version,
      total: p.total,
      days: q.days.map((d) => d.day),
      analyticsClientId: options.analyticsClientId,
    });
    await changed(
      tx,
      p,
      "daily.created",
      "Lịch hoa đã được giữ tạm. Thanh toán trong thời hạn để xác nhận toàn bộ lịch.",
    );
    return p;
  });
}
export async function activateDailyInvoice(
  tx: Tx,
  invoiceId: string,
  now = new Date(),
  attribution?: { actorId: string; reference: string },
) {
  await lockDaily(tx);
  const invoice = await tx.dailyInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
  });
  const plan = await tx.dailyPlan.findUniqueOrThrow({
    where: { id: invoice.planId },
  });
  if (invoice.state !== "PENDING" || invoice.expiresAt <= now) return false;
  if (invoice.kind === "PURCHASE") {
    if (plan.state !== "PENDING_PAYMENT") return false;
    const ds = await tx.dailyDelivery.findMany({ where: { planId: plan.id } });
    if (ds.some((d) => d.reservation !== "HELD" || d.lockAt <= now))
      return false;
    await tx.dailyDelivery.updateMany({
      where: { planId: plan.id, reservation: "HELD" },
      data: { reservation: "CONFIRMED" },
    });
    await tx.dailyPlan.update({
      where: { id: plan.id },
      data: { state: "ACTIVE", version: { increment: 1 } },
    });
  } else {
    const change = invoice.change as {
      deliveryId: string;
      version: number;
      offeringId: string;
      selection: DailyOfferingView;
    };
    const d = await tx.dailyDelivery.findUnique({
      where: { id: change.deliveryId },
    });
    if (
      !d ||
      d.planId !== plan.id ||
      d.version !== change.version ||
      d.orderId ||
      d.lockAt <= now ||
      !["ACTIVE", "PAUSED"].includes(plan.state)
    )
      return false;
    const chosen = await tx.dailyOffering.findUnique({
      where: { id: change.offeringId },
    });
    if (!chosen?.active) return false;
    const used = await tx.dailyDelivery.count({
      where: {
        day: d.day,
        offeringId: chosen.id,
        id: { not: d.id },
        reservation: { in: ["HELD", "CONFIRMED"] },
      },
    });
    if (used >= chosen.capacity) return false;
    await tx.dailyDelivery.update({
      where: { id: d.id },
      data: {
        offeringId: change.offeringId,
        selectionSnapshot: json(change.selection),
        approved: true,
        premium: { increment: invoice.amount },
        total: { increment: invoice.amount },
        version: { increment: 1 },
      },
    });
    await tx.dailyPlan.update({
      where: { id: plan.id },
      data: { total: { increment: invoice.amount }, version: { increment: 1 } },
    });
  }
  await tx.dailyInvoice.update({
    where: { id: invoice.id },
    data: { state: "PAID", paidAt: now },
  });
  if (analyticsEnabled()) {
    const consent = await tx.dailyHistory.findFirst({
      where: { planId: plan.id, action: "created" },
    });
    const clientId = (consent?.detail as { analyticsClientId?: string })
      ?.analyticsClientId;
    if (clientId) {
      const ds = await tx.dailyDelivery.findMany({
        where: { planId: plan.id },
      });
      const shipping =
        invoice.kind === "PURCHASE"
          ? ds.reduce((n, d) => n + d.shippingGross - d.subsidy, 0)
          : 0;
      await queueAnalytics(tx, {
        clientId,
        eventId: `daily-purchase:${invoice.id}`,
        name: "purchase",
        userId: plan.userId,
        params: {
          transaction_id: invoice.code,
          currency: "VND",
          value: invoice.amount - shipping,
          shipping,
          items: [
            {
              item_id: `daily:${plan.budgetCode}`,
              item_name:
                invoice.kind === "PURCHASE"
                  ? "Fleurious Daily"
                  : "Nâng cấp hoa Daily",
              quantity: 1,
              price: invoice.amount - shipping,
            },
          ],
        },
      });
    }
  }
  await history(tx, plan.id, attribution?.actorId ?? "SEPAY", "paid", {
    invoiceId: invoice.id,
    amount: invoice.amount,
    method: attribution ? "MANUAL" : "SEPAY",
    ...(attribution ? { reference: attribution.reference } : {}),
  });
  await changed(
    tx,
    plan,
    "daily.activated",
    invoice.kind === "PURCHASE"
      ? "Đã nhận thanh toán. Lịch hoa của bạn đã được xác nhận."
      : "Đã nhận phụ thu và cập nhật mẫu hoa.",
  );
  return true;
}
export async function dailyPlanView(id: string, actor: Actor, admin = false) {
  const p = await db.dailyPlan.findUnique({
    where: { id },
    include: {
      deliveries: {
        orderBy: { day: "asc" },
        include: {
          order: {
            select: {
              id: true,
              code: true,
              status: true,
              fulfillment: true,
              paymentStatus: true,
              version: true,
            },
          },
        },
      },
      invoices: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      history: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!p || (!admin && p.userId !== actor.id))
    fail("NOT_FOUND", "Không tìm thấy lịch hoa.", 404);
  if (admin) staff(actor, can(actor.role, "payments") ? "payments" : "orders");
  const { webhookKey, apiToken, ...bank } = await getSepayConfig();
  const finance = !admin || can(actor.role, "payments");
  const slots = await db.deliverySlot.findMany({
    where: { active: true },
    select: { id: true, label: true, startHour: true, endHour: true },
  });
  return {
    ...p,
    pricingMode: (p.policy as unknown as DailyPolicy).pricingMode ?? "BUDGET",
    policy: {
      ...(p.policy as object),
      packingCost: undefined,
      minimumMargin: undefined,
      campaignBudget: undefined,
    },
    deliveries: p.deliveries.map((d) => {
      const s = d.selectionSnapshot as DailyOfferingView | null;
      return {
        ...d,
        selectionSnapshot: s
          ? { ...s, cost: undefined, capacity: undefined }
          : null,
        message: admin && actor.role === "DELIVERY" ? "" : d.message,
        total: finance ? d.total : undefined,
        base: finance ? d.base : undefined,
        discount: finance ? d.discount : undefined,
        premium: finance ? d.premium : undefined,
        shippingGross: finance ? d.shippingGross : undefined,
        subsidy: finance ? d.subsidy : undefined,
      };
    }),
    invoices: finance
      ? p.invoices.map((i) => ({
          ...i,
          change: undefined,
          allocation: undefined,
          paymentQr:
            i.state === "PENDING" && i.expiresAt > new Date()
              ? sepayQrUrl(
                  { ...bank, webhookKey: "", apiToken: "" },
                  i.amount,
                  i.code,
                )
              : undefined,
          bank: bank.bank,
          accountNumber: bank.accountNumber,
          accountName: bank.accountName,
        }))
      : [],
    refunds: finance ? p.refunds : [],
    history: admin && actor.role === "DELIVERY" ? [] : p.history,
    total: finance ? p.total : undefined,
    receivedAmount: finance
      ? ((
          await db.payment.aggregate({
            where: { dailyInvoiceId: { in: p.invoices.map((i) => i.id) } },
            _sum: { amount: true },
          })
        )._sum.amount ?? 0)
      : undefined,
    slots,
    reviewPayments:
      admin && finance
        ? await db.payment.findMany({
            where: {
              dailyInvoiceId: { in: p.invoices.map((i) => i.id) },
              state: "REVIEW",
            },
            select: {
              id: true,
              reference: true,
              amount: true,
              dailyInvoiceId: true,
              reason: true,
            },
          })
        : [],
    serverNow: new Date().toISOString(),
  };
}
export async function listDaily(actor: Actor, admin = false, day?: string) {
  if (admin) staff(actor, can(actor.role, "payments") ? "payments" : "orders");
  return db.dailyPlan.findMany({
    where: admin
      ? day
        ? { deliveries: { some: { day: dailyDay(day) } } }
        : {}
      : { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      code: true,
      buyerName: true,
      recipientName: true,
      state: true,
      version: true,
      createdAt: true,
      ...(!admin || can(actor.role, "payments") ? { total: true } : {}),
      deliveries: {
        select: {
          id: true,
          day: true,
          state: true,
          issue: true,
          orderId: true,
        },
        orderBy: { day: "asc" },
      },
      refunds: { select: { id: true, state: true } },
    },
  });
}
export async function dailyAvailability(from: string, to: string) {
  dailyDay(from);
  dailyDay(to);
  if (to < from || to > shiftDay(from, 31))
    fail("DAILY_RANGE", "Chỉ xem tối đa một tháng mỗi lần.");
  const [{ policy }, slots, bookings, settings] = await Promise.all([
    dailyConfig(),
    db.deliverySlot.findMany({ where: { active: true } }),
    db.slotBooking.findMany({ where: { day: { gte: from, lte: to } } }),
    getSettings(),
  ]);
  const result = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const used = await db.dailyDelivery.count({
      where: { day, reservation: { in: ["HELD", "CONFIRMED"] } },
    });
    const closed =
      policy.blackoutDates.includes(day) ||
      settings.blackoutDates.includes(day) ||
      day > shiftDay(dayKey(), policy.horizonDays);
    result.push({
      day,
      slots: slots.map((s) => ({
        id: s.id,
        available:
          policy.enabled &&
          !closed &&
          used < policy.capacityPerDay &&
          (bookings.find((b) => b.day === day && b.slotId === s.id)?.count ??
            0) < s.capacity &&
          localInstant(day, s.startHour).getTime() >=
            Date.now() + policy.leadHours * 3600000 &&
          dailyLockAt(day, policy) > new Date(),
      })),
    });
  }
  return result;
}
async function ownedPlan(tx: Tx, id: string, actor: Actor, admin = false) {
  const p = await tx.dailyPlan.findUniqueOrThrow({ where: { id } });
  if (admin) staff(actor);
  else if (p.userId !== actor.id)
    fail("NOT_FOUND", "Không tìm thấy lịch hoa.", 404);
  return p;
}
export async function editDailyDelivery(
  actor: Actor,
  id: string,
  deliveryId: string,
  raw: unknown,
  admin = false,
) {
  if (admin && !["OWNER", "MANAGER", "FLORIST"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền sửa mẫu hoặc lịch hoa.", 403);
  const input = z
    .object({
      version: versionSchema,
      message: z.string().max(800).optional(),
      writingMode: z.enum(["AUTO", "HANDWRITTEN"]).optional(),
      day: z.string().optional(),
      slotId: idSchema.optional(),
      pause: z.boolean().optional(),
      offeringId: idSchema.optional(),
      approve: z.boolean().optional(),
      idempotencyKey: z.string().min(10).max(100).optional(),
    })
    .parse(raw);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const p = await ownedPlan(tx, id, actor, admin),
      policy = p.policy as unknown as DailyPolicy;
    if (!["ACTIVE", "PAUSED"].includes(p.state))
      fail("DAILY_STATE", "Chỉ chỉnh lịch đã thanh toán còn hiệu lực.");
    const d = await tx.dailyDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    if (d.planId !== id) fail("NOT_FOUND", "Không tìm thấy lượt giao.", 404);
    if (d.version !== input.version)
      fail(
        "STALE_VERSION",
        "Lượt giao vừa được cập nhật. Tải lại trước khi sửa.",
        409,
      );
    if (input.writingMode !== undefined && input.writingMode !== d.writingMode)
      fail(
        "DAILY_WRITING_MODE_LOCKED",
        "Cách viết thiệp đã được chốt khi đặt lịch và không thể thay đổi.",
        409,
      );
    if (
      ["FULFILLED", "CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(d.state)
    )
      fail("DAILY_LOCKED", "Lượt này đã kết thúc hoặc đang hoàn tiền.");
    const order = d.orderId
      ? await tx.order.findUniqueOrThrow({ where: { id: d.orderId } })
      : null;
    const changedSchedule =
      input.day !== undefined ||
      input.slotId !== undefined ||
      input.pause ||
      input.offeringId !== undefined;
    if (
      changedSchedule &&
      ((d.state !== "UNSCHEDULED" && d.lockAt <= new Date()) || d.orderId) &&
      !(admin && !d.orderId && input.approve)
    )
      fail("DAILY_LOCKED", "Đã qua hạn sửa lịch/mẫu. Liên hệ cửa hàng.");
    if (
      input.message !== undefined &&
      (dailyLockAt(d.day, policy, true) <= new Date() ||
        (order && order.fulfillment !== "UNASSIGNED"))
    )
      fail(
        "DAILY_MESSAGE_LOCKED",
        "Thiệp đã được chốt hoặc đơn đang chuẩn bị.",
      );
    const data: Prisma.DailyDeliveryUpdateInput = { version: { increment: 1 } };
    if (input.message !== undefined) data.message = input.message;
    if (input.pause) {
      if (d.orderId)
        fail("DAILY_LOCKED", "Đơn đã chuẩn bị cần cửa hàng xử lý.");
      await release(tx, d);
      data.state = "UNSCHEDULED";
      data.reservation = "RELEASED";
    } else if (input.day || input.slotId) {
      const day = input.day ?? d.day,
        slotId = input.slotId ?? d.slotId,
        settings = await getSettings(tx);
      const slot = await tx.deliverySlot.findUniqueOrThrow({
        where: { id: slotId },
      });
      validateDailyDates(
        [{ day, startHour: slot.startHour }],
        policy,
        settings.blackoutDates,
      );
      const original = await tx.dailyHistory.findFirst({
        where: { planId: id, action: "created" },
      });
      const originalDays = (original?.detail as { days: string[] })?.days ?? [
        d.day,
      ];
      if (day > shiftDay([...originalDays].sort().at(-1)!, policy.graceDays))
        fail("DAILY_RESCHEDULE_LIMIT", "Ngày bù vượt thời hạn của gói.");
      if (
        day !== d.day ||
        slotId !== d.slotId ||
        d.reservation === "RELEASED"
      ) {
        await release(tx, d);
        await checkCapacity(
          tx,
          day,
          slotId,
          policy,
          d.offeringId ?? undefined,
          d.id,
        );
        await reserve(tx, day, slotId, slot.capacity);
      }
      Object.assign(data, {
        day,
        slotId,
        slotLabel: slot.label,
        startHour: slot.startHour,
        endHour: slot.endHour,
        lockAt: dailyLockAt(day, policy),
        state: "SCHEDULED",
        reservation: "CONFIRMED",
        issue: "",
      });
    }
    if (input.offeringId) {
      const o = (await dailyOfferings(tx, true)).find(
        (o) =>
          o.id === input.offeringId &&
          o.active &&
          (policy.pricingMode === "PRODUCT" || o.budgetCode === p.budgetCode),
      );
      if (!o)
        fail(
          "DAILY_OFFERING",
          "Mẫu không thuộc ngân sách hoặc đã ngừng cung cấp.",
        );
      const prefs = p.preferences as z.infer<typeof prefsSchema>;
      if (
        prefs.avoidTags.some((t) =>
          o.tags.some(
            (tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase(),
          ),
        )
      )
        fail("DAILY_OFFERING", "Mẫu chứa loài hoa đã yêu cầu tránh.");
      const currentFlower = d.base - d.discount + d.premium;
      const originalCount = await tx.dailyDelivery.count({
        where: { planId: id },
      });
      const percent =
        [...policy.tiers]
          .sort((a, b) => b.count - a.count)
          .find((t) => originalCount >= t.count)?.percent ?? 0;
      const difference =
        policy.pricingMode === "PRODUCT"
          ? o.id === d.offeringId
            ? 0
            : o.price - Math.round((o.price * percent) / 100) - currentFlower
          : o.premium - d.premium;
      if (difference < 0)
        fail(
          "DAILY_PREMIUM_REFUND",
          "Đổi xuống mẫu ít phụ thu hơn cần cửa hàng hỗ trợ hoàn phần chênh lệch.",
        );
      const used = await tx.dailyDelivery.count({
        where: {
          day: d.day,
          offeringId: o.id,
          id: { not: d.id },
          reservation: { in: ["HELD", "CONFIRMED"] },
        },
      });
      if (used >= (o.capacity ?? 0))
        fail("DAILY_SUPPLY", "Mẫu đã đủ lịch ngày này.", 409);
      if (difference > 0) {
        if (!input.idempotencyKey)
          fail("IDEMPOTENCY_REQUIRED", "Thiếu mã yêu cầu đổi mẫu.");
        const previous = await tx.dailyInvoice.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (previous) {
          if (previous.planId !== id) fail("CONFLICT", "Yêu cầu đã dùng.", 409);
          return { invoiceId: previous.id };
        }
        await lockSepayConfig(tx);
        await tx.dailyInvoice.updateMany({
          where: { planId: id, kind: "UPGRADE", state: "PENDING" },
          data: { state: "CANCELLED" },
        });
        const amount = difference,
          expiry = new Date(
            Math.min(
              Date.now() + policy.holdMinutes * 60000,
              d.lockAt.getTime(),
            ),
          );
        const invoice = await tx.dailyInvoice.create({
          data: {
            planId: id,
            code: code(),
            kind: "UPGRADE",
            amount,
            allocation: [{ deliveryId: d.id, amount }],
            change: json({
              deliveryId: d.id,
              version: d.version,
              offeringId: o.id,
              selection: o,
            }),
            idempotencyKey: input.idempotencyKey,
            expiresAt: expiry,
          },
        });
        return { invoiceId: invoice.id };
      }
      Object.assign(data, {
        offeringId: o.id,
        selectionSnapshot: json(o),
        approved: true,
        issue: "",
        state: "SCHEDULED",
      });
    }
    if (input.approve) {
      if (d.orderId)
        fail("DAILY_LOCKED", "Đơn đã sinh, không duyệt lại mẫu qua lịch hẹn.");
      if (!admin) fail("FORBIDDEN", "Chỉ cửa hàng được duyệt mẫu.", 403);
      data.approved = true;
      data.issue = "";
      data.state = "SCHEDULED";
    }
    await tx.dailyDelivery.update({ where: { id: d.id }, data });
    if (order && input.message !== undefined)
      await tx.order.update({
        where: { id: order.id },
        data: {
          cardMessage: input.message ?? d.message,
          version: { increment: 1 },
          history: {
            create: {
              text: "Lời nhắn Daily vừa thay đổi; dùng bản thiệp mới nhất.",
            },
          },
        },
      });
    const remaining = await tx.dailyDelivery.count({
      where: {
        planId: id,
        reservation: "CONFIRMED",
        state: { in: ["SCHEDULED", "ATTENTION", "MATERIALIZED"] },
      },
    });
    await tx.dailyPlan.update({
      where: { id },
      data: {
        version: { increment: 1 },
        state: remaining ? "ACTIVE" : "PAUSED",
      },
    });
    await history(tx, id, actor.id, "delivery_updated", {
      deliveryId,
      day: input.day,
      pause: input.pause,
      messageChanged: input.message !== undefined,
      approve: input.approve,
    });
    await changed(
      tx,
      p,
      "daily.delivery_changed",
      "Lịch hoa hoặc lời nhắn vừa được cập nhật.",
    );
    return { success: true };
  });
}
