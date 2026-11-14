import { stoppedOrderStatuses, hasReceivedPayment } from "./order-workflow";
import { isOrderExpired } from "./order-expiry";
import { getSepayConfig, lockSepayConfig } from "./sepay-settings";
import { randomBytes } from "node:crypto";
import { Prisma, type User, type Order as DbOrder } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { fail } from "./errors";
import { getSettings, type ShopSettings } from "./settings";
import { dayKey, monthKey, localInstant, streakStats } from "./time";
import { encrypt, hash, token } from "./security";
import { queuePurchase } from "./analytics";
import { getRewardRules } from "./reward-rules";
import {
  resolveMembership,
  membershipPeriod,
  lockMember,
  recordMembershipSpend,
  activateMembershipInvoice,
} from "./membership";
import { atomic, type Tx } from "./transaction";
export { atomic } from "./transaction";
export const checkoutSchema = z.object({
  expectedTotal: z.number().int().min(0).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(30),
  buyerName: z.string().trim().min(2).max(100),
  buyerEmail: z.email().max(200),
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z
    .string()
    .regex(/^(\+84|0)[0-9]{9,10}$/, "Số điện thoại không hợp lệ"),
  address: z.string().trim().min(8).max(300),
  zoneId: z.string(),
  deliveryDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotId: z.string(),
  cardMessage: z.string().max(500).default(""),
  cardWritingMode: z.enum(["AUTO", "HANDWRITTEN"]).default("AUTO"),
  note: z.string().max(500).default(""),
  paymentMethod: z.enum(["SEPAY", "COD"]),
  useMember: z.boolean().default(false),
  rewardId: z.string().optional(),
  voucherCode: z.string().max(40).optional(),
  idempotencyKey: z.string().min(16).max(100),
});
export type Checkout = z.infer<typeof checkoutSchema>;
export const checkoutQuoteSchema = checkoutSchema.pick({
  items: true,
  zoneId: true,
  deliveryDay: true,
  slotId: true,
  paymentMethod: true,
  useMember: true,
  rewardId: true,
  voucherCode: true,
});
export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>;
export async function quote(
  input: CheckoutQuoteInput,
  user: User | null,
  client: Tx | typeof db = db,
  options: { allowPastSlot?: boolean } = {},
) {
  const settings = await getSettings(client);
  if (new Set(input.items.map((i) => i.variantId)).size !== input.items.length)
    fail("DUPLICATE_ITEM", "Vui lòng gộp sản phẩm trùng trong giỏ.");
  const variants = await client.productVariant.findMany({
    where: {
      id: { in: input.items.map((i) => i.variantId) },
      product: { active: true },
    },
    include: { product: true },
  });
  if (variants.length !== input.items.length)
    fail("PRODUCT_UNAVAILABLE", "Có sản phẩm đã ngừng bán.");
  const items = input.items.map((i) => {
    const v = variants.find((v) => v.id === i.variantId)!;
    if (v.stock - v.reserved < i.quantity)
      fail("OUT_OF_STOCK", `${v.product.name} không đủ số lượng.`);
    return {
      ...i,
      name: v.product.name,
      image: v.product.image,
      variantName: v.name,
      price: v.price,
    };
  });
  const [zone, slot] = await Promise.all([
    client.deliveryZone.findUnique({ where: { id: input.zoneId } }),
    client.deliverySlot.findUnique({ where: { id: input.slotId } }),
  ]);
  if (!zone?.active || !slot?.active)
    fail("INVALID_DELIVERY", "Khu vực hoặc khung giờ không khả dụng.");
  if (
    input.deliveryDay < dayKey() ||
    input.deliveryDay > dayKey(new Date(Date.now() + 60 * 86400000)) ||
    !Number.isFinite(localInstant(input.deliveryDay).getTime()) ||
    dayKey(localInstant(input.deliveryDay)) !== input.deliveryDay ||
    settings.blackoutDates.includes(input.deliveryDay)
  )
    fail("INVALID_DATE", "Ngày giao không khả dụng.");
  if (
    !options.allowPastSlot &&
    localInstant(input.deliveryDay, slot.startHour).getTime() <
      Date.now() + settings.minimumLeadHours * 3600000
  )
    fail(
      "DELIVERY_CUTOFF",
      "Khung giờ này đã qua hạn đặt. Vui lòng chọn giờ khác.",
    );
  const booking = await client.slotBooking.findUnique({
    where: { day_slotId: { day: input.deliveryDay, slotId: slot.id } },
  });
  if (booking && booking.count >= slot.capacity)
    fail(
      "DELIVERY_SLOT_FULL",
      "Khung giờ đã đủ đơn. Vui lòng chọn khung giờ khác.",
    );
  if (input.paymentMethod === "COD" && !settings.codEnabled)
    fail("COD_DISABLED", "Thanh toán khi nhận hàng đang tạm ngừng.");
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (subtotal > 1000000000)
    fail(
      "ORDER_TOO_LARGE",
      "Đơn có giá trị lớn; vui lòng liên hệ cửa hàng để được hỗ trợ.",
    );
  let discount = 0,
    discountLabel = "",
    member = false,
    rewardId: string | undefined,
    voucherId: string | undefined;
  let discountBase = subtotal;
  let memberLimit = 0;
  let eligibleVariantIds = items.map((i) => i.variantId);
  if (
    [input.useMember, !!input.rewardId, !!input.voucherCode].filter(Boolean)
      .length > 1
  )
    fail(
      "DISCOUNTS_NOT_STACKABLE",
      "Chỉ chọn một ưu đãi tiền hàng cho mỗi đơn.",
    );
  if (input.useMember) {
    if (!user?.memberSince || !user.verified)
      fail("NOT_MEMBER", "Bạn chưa có quyền lợi hội viên khả dụng.");
    const membership = await resolveMembership(user.id, client);
    if (!membership.current)
      fail("NOT_MEMBER", "Bạn chưa có quyền lợi hội viên khả dụng.");
    const benefits = membership.current;
    memberLimit = membership.limit;
    if (subtotal < benefits.minimum)
      fail(
        "MEMBER_MINIMUM",
        "Tiền hoa chưa đạt mức tối thiểu của hạng hội viên.",
      );
    if (membership.remaining <= 0)
      fail(
        "MEMBER_QUOTA_EXHAUSTED",
        "Bạn đã dùng hết lượt hội viên. Bỏ chọn ưu đãi để mua theo giá thường.",
      );
    discount = Math.min(
      Math.floor((subtotal * benefits.percent) / 100),
      benefits.cap,
    );
    member = discount > 0;
    discountLabel = `${benefits.name} −${benefits.percent}%`;
  }
  if (input.rewardId) {
    const r = await client.reward.findUnique({ where: { id: input.rewardId } });
    if (
      !r ||
      r.userId !== user?.id ||
      r.status !== "AVAILABLE" ||
      r.expiresAt <= new Date()
    )
      fail(
        "REWARD_UNAVAILABLE",
        "Ưu đãi không khả dụng hoặc đơn chưa đủ điều kiện.",
      );
    const eligible = r.productId
      ? items
          .filter((i) =>
            variants.some(
              (v) => v.id === i.variantId && v.productId === r.productId,
            ),
          )
          .reduce((s, i) => s + i.price * i.quantity, 0)
      : subtotal;
    if (!eligible || eligible < r.minimum)
      fail("REWARD_SCOPE", "Giỏ chưa đủ tiền hoa thuộc phạm vi ưu đãi.");
    discountBase = eligible;
    if (r.productId)
      eligibleVariantIds = variants
        .filter((v) => v.productId === r.productId)
        .map((v) => v.id);
    discount = Math.min(Math.floor((eligible * r.percent) / 100), r.cap);
    discountLabel = r.title;
    rewardId = r.id;
  }
  if (input.voucherCode) {
    const v = await client.voucher.findUnique({
      where: { code: input.voucherCode.toUpperCase() },
    });
    if (
      !v?.active ||
      v.expiresAt <= new Date() ||
      v.used >= v.limit ||
      subtotal < v.minimum
    )
      fail(
        "VOUCHER_UNAVAILABLE",
        "Mã ưu đãi không khả dụng hoặc đơn chưa đủ điều kiện.",
      );
    discount = Math.min(Math.floor((subtotal * v.percent) / 100), v.cap);
    discountLabel = v.title;
    voucherId = v.id;
  }
  return {
    items,
    subtotal,
    discount,
    discountLabel,
    discountBase,
    eligibleVariantIds,
    deliveryFee: zone.fee,
    total: subtotal - discount + zone.fee,
    member,
    memberLimit,
    rewardId,
    voucherId,
    slot,
    settings,
  };
}
export async function createOrder(
  input: Checkout,
  user: User | null,
  guestHash: string,
  options: { analyticsClientId?: string } = {},
) {
  return atomic((tx) =>
    createOrderTx(tx, input, user, guestHash, options),
  ).catch(async (error) => {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await db.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (
        replay &&
        (replay.userId === user?.id || replay.guestHash === guestHash)
      )
        return replay;
    }
    throw error;
  });
}
export async function createOrderTx(
  tx: Tx,
  input: Checkout,
  user: User | null,
  guestHash: string,
  options: {
    analyticsClientId?: string;
    source?: string;
    createdBy?: string;
    notify?: boolean;
    allowPastSlot?: boolean;
  } = {},
) {
  const existing = await tx.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (
      (user && existing.userId === user.id) ||
      existing.guestHash === guestHash
    )
      return existing;
    fail("IDEMPOTENCY_CONFLICT", "Không thể dùng lại yêu cầu này.", 409);
  }
  if (
    input.paymentMethod === "SEPAY" &&
    !(await lockSepayConfig(tx)).configured
  )
    fail(
      "PAYMENT_NOT_CONFIGURED",
      "Thanh toán SePay chưa được cửa hàng cấu hình. Vui lòng chọn COD.",
      503,
    );
  if (user) await lockMember(tx, user.id);
  const q = await quote(input, user, tx, {
    allowPastSlot: options.allowPastSlot,
  });
  if (input.expectedTotal !== undefined && input.expectedTotal !== q.total)
    fail(
      "PRICE_CHANGED",
      "Giá hoặc ưu đãi vừa thay đổi. Vui lòng kiểm tra lại tổng tiền trước khi đặt.",
      409,
    );
  let periodId: string | undefined;
  if (q.member && user) {
    const period = await membershipPeriod(
      tx,
      user.id,
      await resolveMembership(user.id, tx),
    );
    const changed =
      await tx.$executeRaw`UPDATE MemberPeriod SET reserved = reserved + 1 WHERE id = ${period.id} AND reserved + consumed < \`limit\``;
    if (!changed)
      fail(
        "MEMBER_QUOTA_EXHAUSTED",
        "Lượt hội viên vừa được dùng ở đơn khác.",
        409,
      );
    periodId = period.id;
  }
  for (const item of q.items) {
    const changed =
      await tx.$executeRaw`UPDATE ProductVariant SET reserved = reserved + ${item.quantity} WHERE id = ${item.variantId} AND stock - reserved >= ${item.quantity}`;
    if (!changed) fail("OUT_OF_STOCK", "Sản phẩm vừa hết hàng.", 409);
  }
  await tx.slotBooking.upsert({
    where: { day_slotId: { day: input.deliveryDay, slotId: input.slotId } },
    create: { day: input.deliveryDay, slotId: input.slotId },
    update: {},
  });
  if (
    !(await tx.$executeRaw`UPDATE SlotBooking SET count = count + 1 WHERE day = ${input.deliveryDay} AND slotId = ${input.slotId} AND count < ${q.slot.capacity}`)
  )
    fail("DELIVERY_SLOT_FULL", "Khung giờ vừa đầy.", 409);
  const id = `ord_${randomBytes(12).toString("hex")}`;
  if (q.rewardId) {
    const result = await tx.reward.updateMany({
      where: { id: q.rewardId, status: "AVAILABLE" },
      data: { status: "RESERVED", reservedOrderId: id },
    });
    if (!result.count)
      fail("REWARD_UNAVAILABLE", "Ưu đãi đang được dùng ở đơn khác.", 409);
  }
  if (q.voucherId) {
    if (
      !(await tx.$executeRaw`UPDATE Voucher SET used = used + 1 WHERE id = ${q.voucherId} AND used < \`limit\``)
    )
      fail("VOUCHER_UNAVAILABLE", "Mã đã hết lượt.", 409);
    await tx.voucherUse.create({
      data: { voucherId: q.voucherId, orderId: id },
    });
  }
  const qrToken = token();
  let allocated = 0;
  const order = await tx.order.create({
    data: {
      id,
      code: `FLR${randomBytes(6).toString("hex").toUpperCase()}`,
      idempotencyKey: input.idempotencyKey,
      userId: user?.id,
      guestHash: user ? null : guestHash,
      analyticsClientId: options.analyticsClientId,
      source: options.source ?? "WEBSITE",
      createdBy: options.createdBy,
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      address: input.address,
      zoneId: input.zoneId,
      deliveryDay: input.deliveryDay,
      slotId: input.slotId,
      slotLabel: q.slot.label,
      deliveryStart: localInstant(input.deliveryDay, q.slot.startHour),
      deliveryEnd: localInstant(input.deliveryDay, q.slot.endHour),
      cardMessage: input.cardMessage,
      cardWritingMode: input.cardWritingMode,
      note: input.note,
      paymentMethod: input.paymentMethod,
      subtotal: q.subtotal,
      discount: q.discount,
      deliveryFee: q.deliveryFee,
      total: q.total,
      discountLabel: q.discountLabel,
      memberPeriodId: periodId,
      memberState: periodId ? "RESERVED" : null,
      rewardId: q.rewardId,
      expiresAt: new Date(
        Date.now() +
          (input.paymentMethod === "COD" ? 24 * 3600000 : 15 * 60000),
      ),
      items: {
        create: q.items.map((item) => {
          const eligible = q.eligibleVariantIds.includes(item.variantId);
          const lastEligible = q.items
            .filter((i) => q.eligibleVariantIds.includes(i.variantId))
            .at(-1)?.variantId;
          const discount = !eligible
            ? 0
            : item.variantId === lastEligible
              ? q.discount - allocated
              : Math.floor(
                  (q.discount * item.price * item.quantity) / q.discountBase,
                );
          allocated += discount;
          return { ...item, discount };
        }),
      },
      qr: {
        create: {
          tokenHash: hash(qrToken),
          tokenEncrypted: encrypt(qrToken),
          maxClaims: q.settings.qrMaxClaims,
        },
      },
      history: { create: { text: "Đã tiếp nhận đơn hàng" } },
    },
  });
  if (periodId)
    await tx.memberLedger.create({
      data: { periodId, orderId: id, action: "RESERVED" },
    });
  if (options.notify !== false && user)
    await tx.notification.create({
      data: {
        userId: user.id,
        title: `Đã tiếp nhận đơn ${order.code}`,
        body: "Cửa hàng đã nhận đơn hoa của bạn. Bạn có thể theo dõi thanh toán và giao hoa tại đây.",
        url: `/orders/${order.id}`,
      },
    });
  if (options.notify !== false)
    await tx.outbox.create({
      data: {
        userId: user?.id,
        event: "order.created",
        payload: { orderId: id, version: 1 },
      },
    });
  return order;
}
export async function consumeBenefits(
  tx: Tx,
  order: {
    id: string;
    memberPeriodId: string | null;
    memberState: string | null;
    rewardId: string | null;
  },
) {
  if (order.memberPeriodId && order.memberState === "RESERVED") {
    await tx.memberPeriod.update({
      where: { id: order.memberPeriodId },
      data: { reserved: { decrement: 1 }, consumed: { increment: 1 } },
    });
    await tx.memberLedger.create({
      data: {
        periodId: order.memberPeriodId,
        orderId: order.id,
        action: "CONSUMED",
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { memberState: "CONSUMED" },
    });
  }
  if (order.rewardId)
    await tx.reward.updateMany({
      where: {
        id: order.rewardId,
        status: "RESERVED",
        reservedOrderId: order.id,
      },
      data: { status: "USED" },
    });
  await tx.voucherUse.updateMany({
    where: { orderId: order.id, state: "RESERVED" },
    data: { state: "USED" },
  });
}
export async function unlockQr(
  tx: Tx,
  orderId: string,
  settings: ShopSettings,
) {
  await tx.qrGrant.updateMany({
    where: { orderId, eligibleAt: null, revoked: false },
    data: {
      eligibleAt: new Date(),
      expiresAt: new Date(Date.now() + settings.qrHours * 3600000),
    },
  });
}
export async function cancelOrder(tx: Tx, orderId: string, reason: string) {
  return terminateOrder(tx, orderId, reason, false);
}
export async function stopOrderForRefund(
  tx: Tx,
  orderId: string,
  reason: string,
) {
  return terminateOrder(tx, orderId, reason, true);
}
async function terminateOrder(
  tx: Tx,
  orderId: string,
  reason: string,
  refund: boolean,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  if (stoppedOrderStatuses.includes(order.status)) return order;
  if (!refund && hasReceivedPayment(order))
    fail(
      "USE_REFUND",
      "Đơn đã nhận tiền không thể hủy. Hãy tạo yêu cầu hoàn tiền.",
    );
  if (refund && !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus))
    fail("NOT_PAID", "Chỉ hoàn đơn đã nhận tiền.");
  if (!refund && !["UNASSIGNED", "PREPARING"].includes(order.fulfillment))
    fail("CANNOT_CANCEL", "Đơn đã sẵn giao, cần liên hệ cửa hàng.");
  if (order.stockState === "RESERVED")
    for (const item of order.items)
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reserved: { decrement: item.quantity } },
      });
  if (order.fulfillment !== "DELIVERED")
    await tx.slotBooking.updateMany({
      where: { day: order.deliveryDay, slotId: order.slotId, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  if (order.fulfillment !== "DELIVERED") {
    if (order.memberPeriodId && order.memberState === "RESERVED") {
      await tx.memberPeriod.update({
        where: { id: order.memberPeriodId },
        data: { reserved: { decrement: 1 } },
      });
      await tx.memberLedger.create({
        data: { periodId: order.memberPeriodId, orderId, action: "RELEASED" },
      });
    }
    if (order.memberPeriodId && order.memberState === "CONSUMED") {
      const period = await tx.memberPeriod.findUniqueOrThrow({
        where: { id: order.memberPeriodId },
      });
      if (period.month === monthKey()) {
        await tx.memberPeriod.update({
          where: { id: period.id },
          data: { consumed: { decrement: 1 } },
        });
        await tx.memberLedger.create({
          data: { periodId: period.id, orderId, action: "RETURNED" },
        });
      }
    }
    if (order.rewardId)
      await tx.reward.updateMany({
        where: {
          id: order.rewardId,
          reservedOrderId: order.id,
          status: { in: ["RESERVED", "USED"] },
        },
        data: { status: "AVAILABLE", reservedOrderId: null },
      });
    const use = await tx.voucherUse.findUnique({ where: { orderId } });
    if (use && use.state !== "RELEASED") {
      await tx.voucherUse.update({
        where: { id: use.id },
        data: { state: "RELEASED" },
      });
      await tx.voucher.update({
        where: { id: use.voucherId },
        data: { used: { decrement: 1 } },
      });
    }
  }
  await tx.qrGrant.update({ where: { orderId }, data: { revoked: true } });
  // Claimed memories remain visible, but invalidated days no longer contribute to reward progress.
  const grant = await tx.qrGrant.findUniqueOrThrow({ where: { orderId } });
  await tx.activeDay.updateMany({
    where: { sourceGrantId: grant.id },
    data: { valid: false },
  });
  const affected = await tx.qrClaim.findMany({
    where: { grantId: grant.id },
    select: { userId: true },
  });
  for (const { userId } of affected) {
    const validDays = await tx.activeDay.findMany({
      where: { userId, valid: true },
      select: { day: true },
    });
    const rewards = await tx.reward.findMany({
      where: {
        userId,
        status: { in: ["AVAILABLE", "WAITING_BUDGET", "RESERVED"] },
      },
    });
    for (const reward of rewards) {
      const stats = streakStats(
        validDays.map((d) => d.day),
        reward.earnedDay || dayKey(),
      );
      if (
        (reward.ruleKey.startsWith("monthly") ? stats.monthly : stats.current) <
        reward.threshold
      ) {
        await tx.reward.update({
          where: { id: reward.id },
          data: { status: "REVOKED" },
        });
        if (reward.status === "RESERVED" && reward.reservedOrderId) {
          const pending = await tx.$queryRaw<
            DbOrder[]
          >`SELECT * FROM \`Order\` WHERE id=${reward.reservedOrderId} FOR UPDATE`;
          if (
            pending[0]?.status === "PENDING" &&
            pending[0].paymentStatus === "UNPAID"
          ) {
            await cancelOrder(
              tx,
              pending[0].id,
              "Ưu đãi nguồn không còn hợp lệ; vui lòng đặt lại với giá đã kiểm tra",
            );
            await tx.outbox.create({
              data: {
                userId: pending[0].userId,
                event: "order.status_changed",
                payload: {
                  orderId: pending[0].id,
                  version: pending[0].version + 1,
                },
              },
            });
          }
        }
        if (["AVAILABLE", "RESERVED"].includes(reward.status)) {
          await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\` = 'reward_budget' FOR UPDATE`;
          const budget = await tx.setting.findUniqueOrThrow({
            where: { key: "reward_budget" },
          });
          await tx.setting.update({
            where: { key: "reward_budget" },
            data: {
              value: {
                committed: Math.max(
                  0,
                  Number((budget.value as { committed: number }).committed) -
                    reward.cap,
                ),
              },
            },
          });
        }
      }
    }
    await tx.outbox.create({
      data: {
        userId,
        event: "streak.day_activated",
        payload: { recompute: true },
      },
    });
  }
  if (refund) {
    const existing = await tx.refund.aggregate({
      where: { orderId },
      _sum: { amount: true, merchandiseAmount: true },
    });
    const amount = order.total - (existing._sum.amount ?? 0);
    if (amount > 0)
      await tx.refund.create({
        data: {
          orderId,
          amount,
          merchandiseAmount: Math.max(
            0,
            order.subtotal -
              order.discount -
              (existing._sum.merchandiseAmount ?? 0),
          ),
          reason,
        },
      });
  }
  return tx.order.update({
    where: { id: orderId },
    data: {
      status: refund ? "REFUND_PENDING" : "CANCELLED",
      expiredAt:
        !refund && isOrderExpired(order)
          ? (order.expiredAt ?? new Date())
          : order.expiredAt,
      stockState: order.stockState === "CONSUMED" ? "CONSUMED" : "RELEASED",
      memberState:
        order.fulfillment === "DELIVERED"
          ? order.memberState
          : order.memberPeriodId
            ? "RELEASED"
            : null,
      version: { increment: 1 },
      history: { create: { text: reason } },
    },
  });
}
export async function transitionOrder(
  id: string,
  action: string,
  expectedVersion: number,
  actor: User,
) {
  return atomic((tx) =>
    transitionOrderTx(tx, id, action, expectedVersion, actor),
  );
}
export async function transitionOrderTx(
  tx: Tx,
  id: string,
  action: string,
  expectedVersion: number,
  actor: User,
  notify = true,
) {
  const settings = await getSettings(tx);
  await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
  const o = await tx.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!o) fail("NOT_FOUND", "Không tìm thấy đơn.", 404);
  if (o.version !== expectedVersion)
    fail(
      "STALE_ORDER_VERSION",
      "Đơn vừa được cập nhật. Vui lòng tải lại.",
      409,
    );
  if (!["OWNER", "MANAGER", "FLORIST", "DELIVERY"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền thao tác đơn hàng.", 403);
  if (stoppedOrderStatuses.includes(o.status) || o.status === "COMPLETED")
    fail("INVALID_TRANSITION", "Đơn đã kết thúc.");
  if (action !== "CANCEL" && isOrderExpired(o))
    fail("ORDER_EXPIRED", "Đơn đã hết hạn giữ hoa. Vui lòng tạo đơn mới.");
  if (actor.role === "FLORIST" && !["PREPARE", "READY"].includes(action))
    fail("FORBIDDEN", "Bạn không có quyền thao tác này.", 403);
  if (actor.role === "DELIVERY" && !["DISPATCH", "DELIVER"].includes(action))
    fail("FORBIDDEN", "Bạn không có quyền thao tác này.", 403);
  let updated;
  if (action === "CANCEL")
    updated = await cancelOrder(tx, id, "Cửa hàng đã hủy đơn");
  else {
    const data: Prisma.OrderUpdateInput = { version: { increment: 1 } };
    const labels: Record<string, string> = {
      CONFIRM: "Cửa hàng đã xác nhận",
      PREPARE: "Đang chuẩn bị hoa",
      READY: "Hoa đã sẵn sàng",
      DISPATCH: "Đang giao hoa",
      DELIVER: "Đã giao hoa thành công",
    };
    if (
      action === "CONFIRM" &&
      o.status === "PENDING" &&
      (o.paymentMethod === "COD" ||
        ["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus))
    ) {
      data.status = "CONFIRMED";
      await consumeBenefits(tx, o);
    } else if (
      action === "PREPARE" &&
      o.status === "CONFIRMED" &&
      o.fulfillment === "UNASSIGNED"
    )
      data.fulfillment = "PREPARING";
    else if (action === "READY" && o.fulfillment === "PREPARING")
      data.fulfillment = "READY";
    else if (action === "DISPATCH" && o.fulfillment === "READY")
      data.fulfillment = "OUT_FOR_DELIVERY";
    else if (action === "DELIVER" && o.fulfillment === "OUT_FOR_DELIVERY") {
      data.fulfillment = "DELIVERED";
      data.status = "COMPLETED";
      if (
        o.paymentMethod === "COD" &&
        ["UNPAID", "PENDING"].includes(o.paymentStatus)
      )
        data.paymentStatus = "PAID";
      if (o.stockState === "RESERVED") {
        for (const item of o.items)
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: {
              reserved: { decrement: item.quantity },
              stock: { decrement: item.quantity },
            },
          });
        data.stockState = "CONSUMED";
      }
    } else fail("INVALID_TRANSITION", "Không thể chuyển sang trạng thái này.");
    data.history = { create: { text: labels[action] } };
    updated = await tx.order.update({ where: { id }, data });
    if (action === "DELIVER" && o.paymentMethod === "COD")
      await queuePurchase(tx, id);
    if (action === "DELIVER" && o.userId) await recordMembershipSpend(tx, id);
    if (
      (action === "CONFIRM" &&
        o.paymentMethod === "SEPAY" &&
        settings.qrTrigger === "CONFIRMED") ||
      action === "DELIVER"
    )
      await unlockQr(tx, id, settings);
  }
  await tx.audit.create({
    data: {
      actorId: actor.id,
      action: `order.${action.toLowerCase()}`,
      entityId: id,
      detail: { previousVersion: expectedVersion },
    },
  });
  if (notify)
    await tx.outbox.create({
      data: {
        userId: o.userId,
        event: "order.status_changed",
        payload: { orderId: id, version: updated.version },
      },
    });
  if (notify && o.userId)
    await tx.notification.create({
      data: {
        userId: o.userId,
        title: `Đơn ${o.code}`,
        body:
          action === "CANCEL"
            ? "Đơn đã hủy"
            : updated.fulfillment === "DELIVERED"
              ? "Hoa đã tới nơi. QR giữ chuỗi đã sẵn sàng!"
              : "Đơn hàng của bạn vừa được cập nhật.",
        url: `/orders/${id}`,
      },
    });
  return updated;
}
export async function claimQr(rawToken: string, user: User) {
  const settings = await getSettings();
  const customRules = (await getRewardRules()).rules;
  if (!settings.streakEnabled)
    fail("STREAK_PAUSED", "Chương trình đang tạm dừng.");
  if (!user.verified)
    fail("VERIFY_EMAIL", "Vui lòng xác minh email trước khi nhận ngày.", 403);
  return atomic(async (tx) => {
    // Lock the user before the grant: concurrent different QR claims cannot waste a QR on the same day.
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${user.id} FOR UPDATE`;
    const grant = await tx.qrGrant.findUnique({
      where: { tokenHash: hash(rawToken) },
      include: { order: { include: { items: true } } },
    });
    if (!grant) fail("QR_NOT_FOUND", "Không tìm thấy mã QR.", 404);
    await tx.$queryRaw`SELECT id FROM QrGrant WHERE id = ${grant.id} FOR UPDATE`;
    const fresh = await tx.qrGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    const claimed = await tx.qrClaim.findUnique({
      where: { userId_grantId: { userId: user.id, grantId: grant.id } },
    });
    if (fresh.revoked || stoppedOrderStatuses.includes(grant.order.status))
      fail("QR_REVOKED", "Mã QR đã bị thu hồi.");
    if (claimed) return { alreadyClaimed: true, day: claimed.day };
    if (!fresh.eligibleAt || !fresh.expiresAt)
      fail("QR_PENDING", "QR đang chờ đơn hàng đủ điều kiện.");
    if (fresh.expiresAt <= new Date()) fail("QR_EXPIRED", "Mã QR đã hết hạn.");
    if (fresh.claimsCount >= fresh.maxClaims)
      fail("QR_ALREADY_CLAIMED", "Mã QR đã được nhận hết lượt.");
    const today = dayKey();
    const existingDay = await tx.activeDay.findUnique({
      where: { userId_day: { userId: user.id, day: today } },
    });
    if (existingDay?.valid)
      fail(
        "DAY_ALREADY_ACTIVE",
        "Hôm nay bạn đã có hoa. Mã mới chưa bị sử dụng.",
      );
    const granted =
      await tx.$executeRaw`UPDATE QrGrant SET claimsCount = claimsCount + 1 WHERE id = ${fresh.id} AND claimsCount < maxClaims AND revoked = false AND eligibleAt IS NOT NULL AND expiresAt > UTC_TIMESTAMP(3)`;
    if (!granted)
      fail(
        "QR_ALREADY_CLAIMED",
        "Mã QR vừa được nhận hoặc không còn hiệu lực.",
        409,
      );
    await tx.qrClaim.create({
      data: { grantId: fresh.id, userId: user.id, day: today },
    });
    const item = grant.order.items[0];
    const dayData = {
      userId: user.id,
      day: today,
      image: item.image,
      productName: item.name,
      sourceGrantId: fresh.id,
      valid: true,
    };
    await tx.activeDay.upsert({
      where: { userId_day: { userId: user.id, day: today } },
      create: dayData,
      update: { ...dayData, createdAt: new Date() },
    });
    const days = await tx.activeDay.findMany({
      where: { userId: user.id, valid: true },
      select: { day: true },
    });
    const stats = streakStats(
      days.map((d) => d.day),
      today,
    );
    const rules = [
      {
        key: "monthly",
        progress: stats.monthly,
        threshold: settings.monthlyThreshold,
        percent: settings.monthlyPercent,
        title: `${settings.monthlyThreshold} ngày có hoa trong tháng`,
        cap: settings.rewardCap,
        minimum: settings.rewardMinimum,
        validDays: settings.rewardDays,
        productId: null as string | null,
      },
      {
        key: "consecutive",
        progress: stats.current,
        threshold: settings.consecutiveThreshold,
        percent: settings.consecutivePercent,
        title: `${settings.consecutiveThreshold} ngày liên tiếp`,
        cap: settings.rewardCap,
        minimum: settings.rewardMinimum,
        validDays: settings.rewardDays,
        productId: null as string | null,
      },
      ...customRules
        .filter(
          (r) =>
            r.active &&
            (!r.startsOn || today >= r.startsOn) &&
            (!r.endsOn || today <= r.endsOn),
        )
        .map((r) => ({
          key: `${r.kind}:${r.id}`,
          progress: r.kind === "monthly" ? stats.monthly : stats.current,
          threshold: r.threshold,
          percent: r.percent,
          title: r.name,
          cap: r.cap,
          minimum: r.minimum,
          validDays: r.validDays,
          productId: r.productId,
        })),
    ];
    // Stable rule keys survive settings edits. Crossing is exact, so a new month does not reissue old streak milestones.
    for (const rule of rules.filter((r) => r.progress === r.threshold)) {
      await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\` = 'reward_budget' FOR UPDATE`;
      const budget = await tx.setting.findUniqueOrThrow({
        where: { key: "reward_budget" },
      });
      const used = Number((budget.value as { committed: number }).committed);
      const funded = used + rule.cap <= settings.campaignBudget;
      const exists = await tx.reward.findUnique({
        where: {
          userId_ruleKey_period: {
            userId: user.id,
            ruleKey: rule.key,
            period: today.slice(0, 7),
          },
        },
      });
      if (!exists || exists.status === "REVOKED") {
        const scopeProduct = rule.productId
          ? await tx.product.findUnique({
              where: { id: rule.productId },
              select: { name: true },
            })
          : null;
        const rewardData = {
          userId: user.id,
          ruleKey: rule.key,
          period: today.slice(0, 7),
          title: `Giảm ${rule.percent}% · ${rule.title}${scopeProduct ? ` · Chỉ ${scopeProduct.name}` : ""}`,
          percent: rule.percent,
          cap: rule.cap,
          minimum: rule.minimum,
          productId: rule.productId,
          validDays: rule.validDays,
          threshold: rule.threshold,
          earnedDay: today,
          status: funded ? "AVAILABLE" : "WAITING_BUDGET",
          expiresAt: new Date(Date.now() + rule.validDays * 86400000),
        };
        const reward = await tx.reward.upsert({
          where: {
            userId_ruleKey_period: {
              userId: user.id,
              ruleKey: rule.key,
              period: today.slice(0, 7),
            },
          },
          create: rewardData,
          update: rewardData,
        });
        if (funded)
          await tx.setting.update({
            where: { key: "reward_budget" },
            data: { value: { committed: used + rule.cap } },
          });
        await tx.notification.create({
          data: {
            userId: user.id,
            title: funded
              ? "Bạn vừa nhận ưu đãi mới!"
              : "Đã ghi nhận mốc thưởng của bạn",
            body: funded
              ? reward.title
              : `${reward.title} · đang chờ cửa hàng bổ sung ngân sách. Ngày có hoa và quyền nhận thưởng đã được giữ.`,
            url: "/account/rewards",
          },
        });
      }
    }
    await tx.outbox.create({
      data: {
        userId: user.id,
        event: "streak.day_activated",
        payload: { day: today, ...stats },
      },
    });
    return { day: today, ...stats };
  });
}
export const sepaySchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().min(1)]),
    transferType: z.enum(["in", "out"]),
    transferAmount: z.number().int().positive(),
    accountNumber: z.string(),
    content: z.string().default(""),
    code: z.string().nullish(),
    referenceCode: z.string().optional(),
  })
  .passthrough();
export async function receiveSepay(
  input: z.infer<typeof sepaySchema>,
): Promise<{
  success: boolean;
  ignored?: boolean;
  duplicate?: boolean;
  matched?: boolean;
}> {
  if (input.transferType !== "in") return { success: true, ignored: true };
  if (input.accountNumber !== (await getSepayConfig()).accountNumber)
    fail("ACCOUNT_MISMATCH", "Tài khoản nhận không hợp lệ.", 400);
  return atomic(async (tx) => {
    const id = String(input.id);
    const identityHash = input.referenceCode?.trim()
      ? hash(
          `${input.accountNumber}:${input.referenceCode.trim().toUpperCase()}`,
        )
      : null;
    if (await tx.payment.findUnique({ where: { providerId: id } }))
      return { success: true, duplicate: true };
    if (
      identityHash &&
      (await tx.payment.findUnique({ where: { identityHash } }))
    )
      return { success: true, duplicate: true };
    const code =
      input.code?.match(/^FL[RM][A-F0-9]{12}$/)?.[0] ??
      input.content.toUpperCase().match(/\bFL[RM][A-F0-9]{12}\b/)?.[0];
    if (code?.startsWith("FLM")) {
      const lookup = await tx.membershipInvoice.findUnique({ where: { code } });
      if (lookup) await lockMember(tx, lookup.userId);
      if (lookup)
        await tx.$queryRaw`SELECT id FROM MembershipInvoice WHERE id=${lookup.id} FOR UPDATE`;
      const invoice = lookup
        ? await tx.membershipInvoice.findUniqueOrThrow({
            where: { id: lookup.id },
          })
        : null;
      const matched =
        !!invoice &&
        invoice.amount === input.transferAmount &&
        (await activateMembershipInvoice(tx, invoice));
      await tx.payment.create({
        data: {
          providerId: id,
          identityHash,
          reference: input.referenceCode ?? "",
          membershipInvoiceId: invoice?.id,
          amount: input.transferAmount,
          state: matched ? "MATCHED" : "REVIEW",
          reason: matched
            ? ""
            : "Hội viên: kiểm tra mã, số tiền, thời hạn hoặc lịch gói đã thay đổi.",
        },
      });
      if (invoice && !matched && invoice.status !== "PAID")
        await tx.membershipInvoice.update({
          where: { id: invoice.id },
          data: {
            status: "REVIEW",
            reason:
              "Đã nhận giao dịch cần đối soát. Quyền hội viên chưa được cấp.",
          },
        });
      await tx.audit.create({
        data: {
          actorId: "SEPAY",
          action: "payment.membership.webhook",
          entityId: id,
          detail: JSON.parse(JSON.stringify(input)),
        },
      });
      return { success: true, matched };
    }
    const o = code ? await tx.order.findUnique({ where: { code } }) : null;
    const locked = o
      ? await tx.$queryRaw<
          DbOrder[]
        >`SELECT * FROM \`Order\` WHERE id = ${o.id} FOR UPDATE`
      : [];
    const order = locked[0] ?? null;
    const matched =
      order &&
      order.paymentMethod === "SEPAY" &&
      ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
      !stoppedOrderStatuses.includes(order.status) &&
      order.expiresAt > new Date() &&
      order.total === input.transferAmount;
    const manual =
      order &&
      order.paymentMethod === "SEPAY" &&
      hasReceivedPayment(order) &&
      order.total === input.transferAmount &&
      input.referenceCode
        ? await tx.audit.findFirst({
            where: { entityId: order.id, action: "order.payment_confirmed" },
            orderBy: { createdAt: "desc" },
          })
        : null;
    const manuallyMatched = !!(
      manual &&
      (manual.detail as { reference?: string }).reference
        ?.trim()
        .toUpperCase() === input.referenceCode?.trim().toUpperCase()
    );
    await tx.payment.create({
      data: {
        providerId: id,
        identityHash,
        reference: input.referenceCode ?? "",
        orderId: order?.id,
        amount: input.transferAmount,
        state: matched || manuallyMatched ? "MATCHED" : "REVIEW",
        reason: manuallyMatched
          ? "Đối chiếu giao dịch đã được quản lý xác nhận; không ghi nhận thu tiền lần hai."
          : matched
            ? ""
            : "Cần đối soát: mã, số tiền, hạn hoặc trạng thái đơn không khớp",
      },
    });
    if (matched && order) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PAID",
          version: { increment: 1 },
          history: { create: { text: "SePay đã xác nhận thanh toán" } },
        },
      });
      await consumeBenefits(tx, order);
      await queuePurchase(tx, order.id);
      if (order.userId)
        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `Đã thanh toán đơn ${order.code}`,
            body: "SePay đã xác nhận thanh toán. Cửa hàng sẽ tiếp tục chuẩn bị hoa cho bạn.",
            url: `/orders/${order.id}`,
          },
        });
      await tx.outbox.create({
        data: {
          userId: order.userId,
          event: "order.status_changed",
          payload: { orderId: order.id, version: order.version + 1 },
        },
      });
    }
    return { success: true, matched: !!matched || manuallyMatched };
  });
}
export async function expireReservations() {
  const expired = await db.order.findMany({
    where: {
      status: "PENDING",
      paymentStatus: { in: ["UNPAID", "PENDING"] },
      expiresAt: { lt: new Date() },
    },
    take: 50,
    select: { id: true },
  });
  for (const o of expired)
    await atomic(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${o.id} FOR UPDATE`;
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: o.id } });
      if (
        fresh.status === "PENDING" &&
        ["UNPAID", "PENDING"].includes(fresh.paymentStatus) &&
        fresh.expiresAt < new Date()
      ) {
        await cancelOrder(tx, o.id, "Đơn hết thời gian xác nhận/thanh toán");
        await tx.outbox.create({
          data: {
            userId: fresh.userId,
            event: "order.status_changed",
            payload: { orderId: o.id, version: fresh.version + 1 },
          },
        });
      }
    });
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return expired.length;
}
