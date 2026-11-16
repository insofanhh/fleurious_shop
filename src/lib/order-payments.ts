import { z } from "zod";
import type { User } from "@prisma/client";
import { atomic, type Tx } from "./transaction";
import { fail } from "./errors";
import { consumeBenefits, stopOrderForRefund } from "./commerce";
import { stoppedOrderStatuses, statusAfterPayment } from "./order-workflow";
import { queuePurchase } from "./analytics";
import { recordMembershipRefund, recordMembershipSpend } from "./membership";
import { receiptSchema, recordCodReceiptTx } from "./collections";
import { unlockQr } from "./commerce";
import { getSettings } from "./settings";

function financialActor(actor: Pick<User, "role">) {
  if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền xác nhận tiền.", 403);
}
async function changed(
  tx: Tx,
  order: { id: string; userId: string | null; code: string },
  version: number,
  body: string,
) {
  await tx.outbox.create({
    data: {
      userId: order.userId,
      event: "order.status_changed",
      payload: { orderId: order.id, version },
    },
  });
  if (order.userId)
    await tx.notification.create({
      data: {
        userId: order.userId,
        title: `Đơn ${order.code}`,
        body,
        url: `/orders/${order.id}`,
      },
    });
}
export const manualPaymentSchema = receiptSchema;
export async function confirmOrderPayment(
  id: string,
  raw: unknown,
  actor: User,
) {
  return atomic((tx) => confirmOrderPaymentTx(tx, id, raw, actor));
}
export async function confirmOrderPaymentTx(
  tx: Tx,
  id: string,
  raw: unknown,
  actor: User,
  notify = true,
) {
  financialActor(actor);
  const input = manualPaymentSchema.parse(raw);
  await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({ where: { id } });
  if (
    order.paymentStatus === "PAID" &&
    !stoppedOrderStatuses.includes(order.status)
  )
    return order;
  if (order.version !== input.version)
    fail(
      "STALE_ORDER_VERSION",
      "Đơn đã thay đổi. Tải lại trước khi xác nhận tiền.",
      409,
    );
  if (
    stoppedOrderStatuses.includes(order.status) ||
    !["UNPAID", "PENDING"].includes(order.paymentStatus)
  )
    fail(
      "INVALID_PAYMENT_STATE",
      "Không thể xác nhận tiền cho đơn đã dừng hoặc hoàn tiền.",
    );
  if (
    !order.manualPayment &&
    order.status === "PENDING" &&
    order.expiresAt <= new Date()
  )
    fail(
      "ORDER_EXPIRED",
      "Đơn đã hết hạn giữ hàng. Không thể xác nhận tiền; cần đối soát hoặc tạo đơn mới.",
    );
  await consumeBenefits(tx, order);
  await recordCodReceiptTx(tx, order, input, actor);
  const updated = await tx.order.update({
    where: { id },
    data: {
      paymentStatus: "PAID",
      status: statusAfterPayment(order.status),
      paidAt: new Date(),
      version: { increment: 1 },
      history: {
        create: [
          {
            text: `Đã nhận đủ ${order.total.toLocaleString("vi-VN")} VND · xác nhận thủ công · ${input.reference}`,
          },
          ...(order.status === "PENDING"
            ? [{ text: "Tự động xác nhận đơn sau thanh toán · Chờ chuẩn bị" }]
            : []),
        ],
      },
    },
  });
  await queuePurchase(tx, id);
  if (order.fulfillment === "DELIVERED") await recordMembershipSpend(tx, id);
  const settings = await getSettings(tx);
  if (
    order.paymentMethod === "SEPAY" &&
    updated.status !== "PENDING" &&
    settings.qrTrigger === "CONFIRMED"
  )
    await unlockQr(tx, id, settings);
  await tx.audit.create({
    data: {
      actorId: actor.id,
      action: "order.payment_confirmed",
      entityId: id,
      detail: { ...input, amount: order.total, method: order.paymentMethod },
    },
  });
  // A verified late transfer may already exist in the review inbox. Resolve
  // only an unambiguous order/amount/bank-reference match, never a second receipt.
  if (order.paymentMethod === "SEPAY") {
    const reviews = await tx.payment.findMany({
      where: {
        orderId: id,
        amount: order.total,
        reference: input.reference,
        state: "REVIEW",
      },
      take: 2,
    });
    if (reviews.length === 1)
      await tx.payment.update({
        where: { id: reviews[0].id },
        data: {
          state: "MATCHED",
          reason:
            "Đã đối soát thủ công theo mã tham chiếu ngân hàng và phiếu xác nhận thu tiền.",
        },
      });
  }
  if (notify)
    await changed(
      tx,
      order,
      updated.version,
      "Cửa hàng đã xác nhận nhận đủ tiền thanh toán.",
    );
  return updated;
}
export async function stopAndRefundOrder(
  id: string,
  version: number,
  reason: string,
  actor: User,
) {
  if (!["OWNER", "MANAGER"].includes(actor.role))
    fail("FORBIDDEN", "Chỉ quản lý được dừng đơn để hoàn tiền.", 403);
  const input = z
    .object({
      version: z.number().int().positive(),
      reason: z.string().trim().min(4).max(300),
    })
    .parse({ version, reason });
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    if (order.status === "REFUND_PENDING") return order;
    if (order.version !== input.version)
      fail("STALE_ORDER_VERSION", "Đơn đã thay đổi. Vui lòng tải lại.", 409);
    if (
      !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) ||
      stoppedOrderStatuses.includes(order.status)
    )
      fail(
        "INVALID_REFUND_STATE",
        "Chỉ dừng và hoàn tiền cho đơn đã nhận tiền còn hiệu lực.",
      );
    const updated = await stopOrderForRefund(
      tx,
      id,
      `Dừng đơn, chờ hoàn tiền: ${input.reason}`,
    );
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "order.refund_requested",
        entityId: id,
        detail: input,
      },
    });
    await changed(
      tx,
      order,
      updated.version,
      "Đơn đã dừng và chuyển sang chờ hoàn tiền. Chưa xác nhận tiền đã được hoàn.",
    );
    return updated;
  });
}
export const orderRefundSchema = z.object({
  version: z.number().int().positive(),
  amount: z.number().int().positive(),
  merchandiseAmount: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(4).max(300),
});
export async function requestOrderRefund(
  id: string,
  raw: unknown,
  actor: User,
) {
  if (!["OWNER", "MANAGER"].includes(actor.role))
    fail("FORBIDDEN", "Chỉ quản lý được tạo yêu cầu hoàn đơn.", 403);
  const input = orderRefundSchema.parse(raw);
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    if (order.version !== input.version)
      fail("STALE_ORDER_VERSION", "Đơn đã thay đổi. Vui lòng tải lại.", 409);
    if (
      !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) ||
      order.status === "REFUND_PENDING"
    )
      fail("NOT_PAID", "Đơn chưa nhận tiền hoặc đã có yêu cầu hoàn toàn bộ.");
    const sum = await tx.refund.aggregate({
      where: { orderId: id },
      _sum: { amount: true, merchandiseAmount: true },
    });
    const left = order.total - (sum._sum.amount ?? 0),
      merchLeft =
        order.subtotal - order.discount - (sum._sum.merchandiseAmount ?? 0);
    if (input.amount > left)
      fail("REFUND_EXCEEDS_PAYMENT", "Tổng hoàn vượt số tiền đã nhận.");
    const merchandiseAmount =
      input.merchandiseAmount ?? Math.min(input.amount, Math.max(0, merchLeft));
    if (
      merchandiseAmount > input.amount ||
      merchandiseAmount > merchLeft ||
      merchandiseAmount < Math.max(0, input.amount - (left - merchLeft)) ||
      (input.amount === left && merchandiseAmount !== merchLeft)
    )
      fail(
        "INVALID_REFUND_ALLOCATION",
        "Phần hoàn tiền hoa không hợp lệ. Hoàn toàn bộ phải bao gồm toàn bộ tiền hoa còn lại.",
      );
    const refund = await tx.refund.create({
      data: {
        orderId: id,
        amount: input.amount,
        merchandiseAmount,
        reason: input.reason,
      },
    });
    const updated =
      input.amount === left && !stoppedOrderStatuses.includes(order.status)
        ? await stopOrderForRefund(
            tx,
            id,
            `Dừng đơn, chờ hoàn tiền: ${input.reason}`,
          )
        : await tx.order.update({
            where: { id },
            data: {
              version: { increment: 1 },
              history: {
                create: {
                  text: `Đề nghị hoàn một phần: ${input.amount.toLocaleString("vi-VN")} VND`,
                },
              },
            },
          });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "refund.request",
        entityId: refund.id,
        detail: { ...input, merchandiseAmount },
      },
    });
    await changed(
      tx,
      order,
      updated.version,
      "Cửa hàng đã tạo yêu cầu hoàn tiền cho đơn hoa.",
    );
    return refund;
  });
}
export async function completeOrderRefund(
  id: string,
  reference: string,
  actor: User,
) {
  financialActor(actor);
  const input = z
    .object({ reference: z.string().trim().min(4).max(100) })
    .parse({ reference });
  return atomic(async (tx) => {
    const lookup = await tx.refund.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${lookup.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM Refund WHERE id=${id} FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id } });
    if (refund.status === "COMPLETED") return refund;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: refund.orderId },
    });
    if (!["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus))
      fail("NOT_PAID", "Không thể ghi nhận hoàn cho đơn chưa nhận tiền.");
    const sum = await tx.refund.aggregate({
      where: { orderId: order.id, status: "COMPLETED" },
      _sum: { amount: true },
    });
    const total = (sum._sum.amount ?? 0) + refund.amount;
    if (total > order.total)
      fail("REFUND_EXCEEDS_PAYMENT", "Tổng hoàn vượt số tiền đã nhận.");
    const completed = await tx.refund.update({
      where: { id },
      data: { status: "COMPLETED", reference: input.reference },
    });
    const full = total === order.total;
    if (full && !stoppedOrderStatuses.includes(order.status))
      await stopOrderForRefund(
        tx,
        order.id,
        "Dừng đơn sau đối soát hoàn toàn bộ tiền",
      );
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
        ...(full ? { status: "REFUNDED" } : {}),
        version: { increment: 1 },
        history: {
          create: {
            text: `Đã hoàn ${refund.amount.toLocaleString("vi-VN")} VND · ${input.reference}`,
          },
        },
      },
    });
    await recordMembershipRefund(tx, id);
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "refund.completed",
        entityId: id,
        detail: input,
      },
    });
    await changed(
      tx,
      order,
      updated.version,
      full
        ? "Đơn đã được hoàn toàn bộ tiền."
        : "Đơn đã được hoàn một phần tiền.",
    );
    return completed;
  });
}
