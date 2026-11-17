import { orderShipping, manualShippingSchema } from "./shipping";
import {
  stoppedOrderStatuses,
  hasReceivedPayment,
  statusAfterPayment,
} from "./order-workflow";
import { isOrderExpired, isPaymentOverdue } from "./order-expiry";
import { openCodReceivableTx } from "./collections";
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
  restartOrderId: z.string().min(1).max(100).optional(),
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
  address: z.string().trim().min(8).max(800),
  zoneId: z.string().nullable().optional(),
  locationId: z.string().max(100).optional(),
  shippingQuoteId: z.string().max(100).optional(),
  addressDetails: z.string().max(200).optional(),
  manualShipping: manualShippingSchema.optional(),
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
export const checkoutQuoteSchema = checkoutSchema
  .pick({
    items: true,
    zoneId: true,
    locationId: true,
    shippingQuoteId: true,
    addressDetails: true,
    address: true,
    manualShipping: true,
    deliveryDay: true,
    slotId: true,
    paymentMethod: true,
    useMember: true,
    rewardId: true,
    voucherCode: true,
  })
  .extend({ address: z.string().max(800).optional() });
export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>;
export async function quote(
  input: CheckoutQuoteInput,
  user: User | null,
  client: Tx | typeof db = db,
  options: {
    allowPastSlot?: boolean;
    shippingOwner?: string;
    allowManualShipping?: boolean;
    lockShipping?: boolean;
  } = {},
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
  const [shipping, slot] = await Promise.all([
    orderShipping(
      input,
      options.shippingOwner ?? (user ? `user:${user.id}` : undefined),
      client,
      { lock: options.lockShipping, allowManual: options.allowManualShipping },
    ),
    client.deliverySlot.findUnique({ where: { id: input.slotId } }),
  ]);
  if (!slot?.active) fail("INVALID_DELIVERY", "Khung giờ giao không khả dụng.");
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
    shipping,
    deliveryFee: shipping.fee,
    total: subtotal - discount + shipping.fee,
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
      const replay =
        (
          await db.orderPaymentAttempt.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: { order: true },
          })
        )?.order ??
        (await db.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        }));
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
    paymentDueAt?: Date | null;
    shippingOwner?: string;
    allowManualShipping?: boolean;
  } = {},
) {
  const existing =
    (
      await tx.orderPaymentAttempt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { order: true },
      })
    )?.order ??
    (await tx.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    }));
  if (existing) {
    if (
      (user && existing.userId === user.id) ||
      existing.guestHash === guestHash
    )
      return existing;
    fail("IDEMPOTENCY_CONFLICT", "Không thể dùng lại yêu cầu này.", 409);
  }
  let restart: DbOrder | null = null;
  if (input.restartOrderId) {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${input.restartOrderId} FOR UPDATE`;
    const source = await tx.order.findUnique({
      where: { id: input.restartOrderId },
    });
    if (
      !source ||
      !((user && source.userId === user.id) || source.guestHash === guestHash)
    )
      fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
    if (source.idempotencyKey === input.idempotencyKey) return source;
    if (
      source.dailyPlanId ||
      !isOrderExpired(source) ||
      !["PENDING", "CANCELLED"].includes(source.status)
    )
      fail(
        "ORDER_RESTART_UNAVAILABLE",
        "Chỉ khôi phục đơn hết hạn chưa thanh toán. Đơn có thể đã được đặt lại ở cửa sổ khác.",
        409,
      );
    if (
      await tx.payment.count({
        where: { orderId: source.id, state: { in: ["REVIEW", "MATCHED"] } },
      })
    )
      fail(
        "PAYMENT_REVIEW_PENDING",
        "Đơn có giao dịch cần đối soát. Liên hệ cửa hàng trước khi đặt lại.",
        409,
      );
    if (source.status === "PENDING")
      await cancelOrder(tx, source.id, "Tự động hủy do hết hạn thanh toán");
    restart = await tx.order.findUniqueOrThrow({ where: { id: source.id } });
    const grant = await tx.qrGrant.findUnique({
      where: { orderId: source.id },
    });
    if (restart.stockState !== "RELEASED" || grant?.claimsCount)
      fail(
        "ORDER_RESTART_UNAVAILABLE",
        "Đơn cần cửa hàng kiểm tra trước khi đặt lại.",
        409,
      );
    await tx.orderPaymentAttempt.upsert({
      where: { code: source.paymentCode ?? source.code },
      create: {
        code: source.paymentCode ?? source.code,
        idempotencyKey: source.idempotencyKey,
        orderId: source.id,
      },
      update: {},
    });
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
    shippingOwner:
      options.shippingOwner ??
      (user ? `user:${user.id}` : `guest:${guestHash}`),
    allowManualShipping: options.allowManualShipping,
    lockShipping: true,
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
  const id = restart?.id ?? `ord_${randomBytes(12).toString("hex")}`;
  const attempt = (restart?.checkoutAttempt ?? 0) + 1;
  const orderCode =
    restart?.code ?? `FLR${randomBytes(6).toString("hex").toUpperCase()}`;
  const paymentCode = restart
    ? `FLR${randomBytes(6).toString("hex").toUpperCase()}`
    : null;
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
    await tx.voucherUse.upsert({
      where: { orderId: id },
      create: { voucherId: q.voucherId, orderId: id },
      update: { voucherId: q.voucherId, state: "RESERVED" },
    });
  }
  const qrToken = token();
  let allocated = 0;
  const data = {
    id,
    code: orderCode,
    paymentCode,
    checkoutAttempt: attempt,
    status: "PENDING",
    fulfillment: "UNASSIGNED",
    stockState: "RESERVED",
    paymentStatus: "UNPAID",
    expiredAt: null,
    paidAt: null,
    deliveredAt: null,
    assignee: "",
    idempotencyKey: input.idempotencyKey,
    userId: user?.id ?? null,
    guestHash: user ? null : guestHash,
    analyticsClientId: options.analyticsClientId ?? null,
    source: restart?.source ?? options.source ?? "WEBSITE",
    createdBy: restart?.createdBy ?? options.createdBy,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    recipientName: input.recipientName,
    recipientPhone: input.recipientPhone,
    address: q.shipping.address ?? input.address,
    zoneId: q.shipping.zoneId,
    shippingMethod: q.shipping.method,
    shippingSnapshot: q.shipping.snapshot
      ? ({
          ...q.shipping.snapshot,
          addressDetails: input.addressDetails ?? "",
        } as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    shippingQuoteId:
      q.shipping.method === "DISTANCE" ? input.shippingQuoteId : null,
    deliveryDay: input.deliveryDay,
    slotId: input.slotId,
    slotLabel: q.slot.label,
    deliveryStart: localInstant(input.deliveryDay, q.slot.startHour),
    deliveryEnd: localInstant(input.deliveryDay, q.slot.endHour),
    cardMessage: input.cardMessage,
    cardWritingMode: input.cardWritingMode,
    note: input.note,
    paymentMethod: input.paymentMethod,
    manualPayment: !!options.createdBy,
    paymentDueAt: options.paymentDueAt ?? null,
    subtotal: q.subtotal,
    discount: q.discount,
    deliveryFee: q.deliveryFee,
    total: q.total,
    discountLabel: q.discountLabel,
    memberPeriodId: periodId ?? null,
    memberState: periodId ? "RESERVED" : null,
    rewardId: q.rewardId ?? null,
    expiresAt: new Date(
      Date.now() + (input.paymentMethod === "COD" ? 24 * 3600000 : 15 * 60000),
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
    paymentAttempts: {
      create: {
        code: paymentCode ?? orderCode,
        idempotencyKey: input.idempotencyKey,
      },
    },
    history: {
      create: {
        text: restart
          ? "Khách đã đặt lại đơn · Chờ xác nhận · Đã cấp hạn và mã thanh toán mới"
          : "Đã tiếp nhận đơn hàng",
      },
    },
  };
  const order = restart
    ? await tx.order.update({
        where: { id },
        data: {
          ...data,
          version: { increment: 1 },
          items: { deleteMany: {}, create: data.items.create },
          qr: {
            update: {
              ...data.qr.create,
              eligibleAt: null,
              expiresAt: null,
              revoked: false,
              claimsCount: 0,
            },
          },
        },
      })
    : await tx.order.create({ data });
  if (restart)
    await tx.audit.create({
      data: {
        actorId: user?.id ?? "GUEST",
        action: "order.restarted",
        entityId: id,
        detail: {
          attempt,
          oldPaymentCode: restart.paymentCode ?? restart.code,
          paymentCode,
          previousTotal: restart.total,
          total: order.total,
          previousDeliveryDay: restart.deliveryDay,
          deliveryDay: order.deliveryDay,
        },
      },
    });
  if (periodId)
    await tx.memberLedger.create({
      data: { periodId, orderId: id, action: "RESERVED", attempt },
    });
  if (options.notify !== false && user)
    await tx.notification.create({
      data: {
        userId: user.id,
        title: `${restart ? "Đã đặt lại đơn" : "Đã tiếp nhận đơn"} ${order.code}`,
        body: "Cửa hàng đã nhận đơn hoa của bạn. Bạn có thể theo dõi thanh toán và giao hoa tại đây.",
        url: `/orders/${order.id}`,
      },
    });
  if (options.notify !== false)
    await tx.outbox.create({
      data: {
        userId: user?.id,
        event: restart ? "order.status_changed" : "order.created",
        payload: { orderId: id, version: order.version },
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
    checkoutAttempt?: number;
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
        attempt: order.checkoutAttempt ?? 1,
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
        data: {
          periodId: order.memberPeriodId,
          orderId,
          action: "RELEASED",
          attempt: order.checkoutAttempt,
        },
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
          data: {
            periodId: period.id,
            orderId,
            action: "RETURNED",
            attempt: order.checkoutAttempt,
          },
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
  if (actor.role === "DELIVERY" && o.assignee !== actor.id)
    fail("FORBIDDEN", "Bạn chỉ được cập nhật đơn được phân công.", 403);
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
        (o.manualPayment && ["OWNER", "MANAGER"].includes(actor.role)) ||
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
      data.deliveredAt = new Date();
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
    if (action === "DELIVER") await openCodReceivableTx(tx, updated);
    if (
      action === "DELIVER" &&
      o.paymentMethod === "COD" &&
      hasReceivedPayment(updated)
    )
      await queuePurchase(tx, id);
    if (action === "DELIVER" && o.userId) await recordMembershipSpend(tx, id);
    if (action === "DELIVER" && o.dailyPlanId)
      await (await import("./daily-operations")).dailyOrderDeliveredTx(tx, id);
    if (
      (action === "CONFIRM" &&
        o.paymentMethod === "SEPAY" &&
        hasReceivedPayment(updated) &&
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
      input.code?.match(/^FL[RMD][A-F0-9]{12}$/)?.[0] ??
      input.content.toUpperCase().match(/\bFL[RMD][A-F0-9]{12}\b/)?.[0];
    if (code?.startsWith("FLD")) {
      const invoice = await tx.dailyInvoice.findUnique({ where: { code } });
      const matched =
        !!invoice &&
        invoice.amount === input.transferAmount &&
        (await (await import("./daily")).activateDailyInvoice(tx, invoice.id));
      await tx.payment.create({
        data: {
          providerId: id,
          identityHash,
          reference: input.referenceCode ?? "",
          dailyInvoiceId: invoice?.id,
          amount: input.transferAmount,
          state: matched ? "MATCHED" : "REVIEW",
          reason: matched
            ? ""
            : "Daily: kiểm tra số tiền, thời hạn hoặc lịch đã thay đổi.",
        },
      });
      if (invoice && !matched && invoice.state !== "PAID")
        await tx.dailyInvoice.update({
          where: { id: invoice.id },
          data: { state: "REVIEW" },
        });
      return { success: true, matched };
    }
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
    const attempt = code
      ? await tx.orderPaymentAttempt.findUnique({ where: { code } })
      : null;
    const o = attempt
      ? await tx.order.findUnique({ where: { id: attempt.orderId } })
      : code
        ? await tx.order.findUnique({ where: { code } })
        : null;
    const locked = o
      ? await tx.$queryRaw<
          DbOrder[]
        >`SELECT * FROM \`Order\` WHERE id = ${o.id} FOR UPDATE`
      : [];
    const order = locked[0] ?? null;
    const matched =
      order &&
      order.paymentMethod === "SEPAY" &&
      code === (order.paymentCode ?? order.code) &&
      ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
      !stoppedOrderStatuses.includes(order.status) &&
      !isPaymentOverdue(order) &&
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
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PAID",
          status: statusAfterPayment(order.status),
          paidAt: new Date(),
          version: { increment: 1 },
          history: {
            create: [
              { text: "SePay đã xác nhận thanh toán" },
              ...(order.status === "PENDING"
                ? [
                    {
                      text: "Tự động xác nhận đơn sau thanh toán · Chờ chuẩn bị",
                    },
                  ]
                : []),
            ],
          },
        },
      });
      await consumeBenefits(tx, order);
      await queuePurchase(tx, order.id);
      if (order.fulfillment === "DELIVERED")
        await recordMembershipSpend(tx, order.id);
      if (
        updated.status !== "PENDING" &&
        (await getSettings(tx)).qrTrigger === "CONFIRMED"
      )
        await unlockQr(tx, order.id, await getSettings(tx));
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
export async function expireReservations(orderId?: string) {
  const now = new Date();
  const expired = await db.order.findMany({
    where: {
      ...(orderId ? { id: orderId } : {}),
      status: "PENDING",
      fulfillment: "UNASSIGNED",
      dailyPlanId: null,
      paymentStatus: { in: ["UNPAID", "PENDING"] },
      OR: [
        { manualPayment: false, expiresAt: { lte: now } },
        {
          manualPayment: true,
          paymentMethod: "SEPAY",
          paymentDueAt: { lte: now },
        },
      ],
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
        fresh.fulfillment === "UNASSIGNED" &&
        !fresh.dailyPlanId &&
        isOrderExpired(fresh)
      ) {
        const cancelled = await cancelOrder(
          tx,
          o.id,
          "Tự động hủy do hết hạn xác nhận/thanh toán",
        );
        await tx.outbox.create({
          data: {
            userId: fresh.userId,
            event: "order.status_changed",
            payload: { orderId: o.id, version: cancelled.version },
          },
        });
        if (fresh.userId)
          await tx.notification.create({
            data: {
              userId: fresh.userId,
              title: `Đơn ${fresh.code} đã hủy`,
              body: "Đơn đã hết hạn thanh toán. Bạn có thể đặt lại để kiểm tra giá, tồn kho và chọn lịch giao mới.",
              url: `/orders/${fresh.id}`,
            },
          });
      }
    });
  if (orderId) return expired.length;
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const shippingCutoff = new Date(Date.now() - 86400000);
  await db.shippingLocation.deleteMany({
    where: { expiresAt: { lt: shippingCutoff } },
  });
  await db.shippingQuote.deleteMany({
    where: { expiresAt: { lt: shippingCutoff } },
  });
  await db.shippingRouteCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return expired.length;
}
