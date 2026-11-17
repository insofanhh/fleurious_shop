import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import {
  checkoutSchema,
  quote,
  createOrderTx,
  transitionOrderTx,
} from "./commerce";
import { confirmOrderPaymentTx } from "./order-payments";
import { canCreateOrder, orderChannels } from "./order-channels";
import { fail } from "./errors";
import { dayKey } from "./time";
import { getSettings } from "./settings";

export const adminOrderSchema = checkoutSchema
  .omit({ restartOrderId: true })
  .extend({
    buyerEmail: z.union([z.email().max(200), z.literal("")]).default(""),
    customerId: z.string().min(1).max(100).optional(),
    source: z.enum(["ZALO", "FACEBOOK", "INSTAGRAM", "IN_STORE", "OTHER"]),
    initialStage: z
      .enum([
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "READY",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
      ])
      .default("PENDING"),
    initialPayment: z.enum(["UNPAID", "PAID"]).default("UNPAID"),
    paymentReference: z.string().trim().max(100).default(""),
    paymentReason: z.string().trim().max(300).default(""),
    paymentTermMinutes: z
      .number()
      .int()
      .min(15)
      .max(43200)
      .nullable()
      .optional(),
  });
export const adminQuoteSchema = adminOrderSchema
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
    customerId: true,
    initialStage: true,
  })
  .extend({ address: z.string().max(800).optional() });
export function requireOrderCreator(actor: Pick<User, "role">) {
  if (!canCreateOrder(actor.role))
    fail("FORBIDDEN", "Chỉ Owner/Manager được tạo đơn tại quản trị.", 403);
}
function validateState(input: z.infer<typeof adminOrderSchema>) {
  if (input.initialStage === "DELIVERED" && input.deliveryDay !== dayKey())
    fail("INVALID_DELIVERY_DAY", "Ngày giao của đơn đã giao phải là hôm nay.");
  if (
    input.initialPayment === "PAID" &&
    (input.paymentReference.length < 4 || input.paymentReason.length < 4)
  )
    fail(
      "PAYMENT_EVIDENCE_REQUIRED",
      "Đơn đã thu tiền cần mã giao dịch/phiếu thu và ghi chú xác minh (ít nhất 4 ký tự).",
    );
  if (input.rewardId)
    fail(
      "INVALID_DISCOUNT",
      "Chọn ưu đãi hội viên hoặc mã giảm giá khi tạo đơn tại quản trị.",
    );
}
async function customer(
  input: { customerId?: string },
  client: Tx | typeof db,
) {
  if (!input.customerId) return null;
  const user = await client.user.findFirst({
    where: { id: input.customerId, disabled: false, role: "CUSTOMER" },
  });
  if (!user)
    fail("CUSTOMER_UNAVAILABLE", "Tài khoản khách hàng không khả dụng.");
  return user;
}
export async function quoteAdminOrder(raw: unknown, actor: User) {
  requireOrderCreator(actor);
  const input = adminQuoteSchema.parse(raw);
  if (input.rewardId)
    fail(
      "INVALID_DISCOUNT",
      "Chọn ưu đãi hội viên hoặc mã giảm giá khi tạo đơn tại quản trị.",
    );
  if (input.initialStage === "DELIVERED" && input.deliveryDay !== dayKey())
    fail("INVALID_DELIVERY_DAY", "Ngày giao của đơn đã giao phải là hôm nay.");
  const q = await quote(input, await customer(input, db), db, {
    allowPastSlot: input.initialStage !== "PENDING",
    shippingOwner: `user:${actor.id}`,
    allowManualShipping: true,
  });
  return {
    subtotal: q.subtotal,
    discount: q.discount,
    deliveryFee: q.deliveryFee,
    total: q.total,
    discountLabel: q.discountLabel,
  };
}
export async function createAdminOrder(raw: unknown, actor: User) {
  requireOrderCreator(actor);
  const input = adminOrderSchema.parse(raw);
  validateState(input);
  return atomic(async (tx) => {
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
      if (existing.createdBy !== actor.id)
        fail("IDEMPOTENCY_CONFLICT", "Yêu cầu này thuộc người tạo khác.", 409);
      return existing;
    }
    if (input.expectedTotal === undefined)
      fail("QUOTE_REQUIRED", "Kiểm tra tổng tiền trước khi tạo đơn.");
    const buyer = await customer(input, tx);
    const settings = await getSettings(tx);
    const minutes =
      input.paymentTermMinutes === undefined
        ? settings.manualPaymentHours * 60
        : input.paymentTermMinutes;
    let order = await createOrderTx(tx, input, buyer, `admin:${actor.id}`, {
      source: input.source,
      createdBy: actor.id,
      notify: false,
      shippingOwner: `user:${actor.id}`,
      allowManualShipping: true,
      allowPastSlot: input.initialStage !== "PENDING",
      paymentDueAt: minutes ? new Date(Date.now() + minutes * 60000) : null,
    });
    if (input.manualShipping)
      await tx.audit.create({
        data: {
          actorId: actor.id,
          action: "order.shipping_override",
          entityId: order.id,
          detail: input.manualShipping,
        },
      });
    if (input.initialPayment === "PAID")
      order = await confirmOrderPaymentTx(
        tx,
        order.id,
        {
          version: order.version,
          reference: input.paymentReference,
          reason: input.paymentReason,
        },
        actor,
        false,
      );
    const stages = [
      "PENDING",
      "CONFIRMED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ];
    const actions = ["CONFIRM", "PREPARE", "READY", "DISPATCH", "DELIVER"];
    for (const action of actions.slice(0, stages.indexOf(input.initialStage))) {
      if (action === "CONFIRM" && order.status !== "PENDING") continue;
      order = await transitionOrderTx(
        tx,
        order.id,
        action,
        order.version,
        actor,
        false,
      );
    }
    await tx.orderHistory.create({
      data: {
        orderId: order.id,
        text: `Tạo tại quản trị · ${orderChannels[input.source]}`,
      },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "order.admin_created",
        entityId: order.id,
        detail: {
          source: input.source,
          initialStage: input.initialStage,
          initialPayment: input.initialPayment,
          customerId: buyer?.id ?? null,
        },
      },
    });
    if (buyer)
      await tx.notification.create({
        data: {
          userId: buyer.id,
          title: `Cửa hàng đã tạo đơn ${order.code}`,
          body: `Đơn từ ${orderChannels[input.source]} đã được ghi nhận. Bạn có thể theo dõi tại đây.`,
          url: `/orders/${order.id}`,
        },
      });
    await tx.outbox.create({
      data: {
        userId: buyer?.id,
        event: "order.created",
        payload: {
          orderId: order.id,
          version: order.version,
          source: input.source,
        },
      },
    });
    return order;
  });
}
