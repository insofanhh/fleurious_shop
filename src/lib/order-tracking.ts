import { z } from "zod";
import { db } from "./db";
import { fail } from "./errors";
import { getSepayConfig, sepayQrUrl } from "./sepay-settings";
import { stoppedOrderStatuses } from "./order-workflow";
import { expireReservations } from "./commerce";
import {
  isOrderExpired,
  isPaymentOverdue,
  paymentDeadlineIso,
} from "./order-expiry";

export const trackingInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(6)
    .max(40)
    .regex(/^[A-Z0-9-]+$/),
});
/** Public tracking is a separate allowlist; never reuse the customer's full order serializer. */
async function findTrackingOrder(raw: unknown) {
  const input = trackingInputSchema.safeParse(raw);
  if (!input.success)
    fail(
      "TRACKING_NOT_FOUND",
      "Không tìm thấy đơn. Kiểm tra lại mã được cửa hàng cung cấp.",
      404,
    );
  const candidate = await db.order.findUnique({
    where: { code: input.data.code },
    select: { id: true },
  });
  if (candidate) await expireReservations(candidate.id);
  const order = await db.order.findUnique({
    where: { code: input.data.code },
    select: {
      code: true,
      paymentCode: true,
      status: true,
      fulfillment: true,
      paymentStatus: true,
      paymentMethod: true,
      total: true,
      createdAt: true,
      deliveryDay: true,
      slotLabel: true,
      deliveredAt: true,
      expiresAt: true,
      expiredAt: true,
      manualPayment: true,
      paymentDueAt: true,
      items: {
        select: { name: true, variantName: true, quantity: true, image: true },
      },
    },
  });
  if (!order)
    fail(
      "TRACKING_NOT_FOUND",
      "Không tìm thấy đơn. Kiểm tra lại mã được cửa hàng cung cấp.",
      404,
    );
  return order;
}
function canPay(order: Awaited<ReturnType<typeof findTrackingOrder>>) {
  return (
    order.paymentMethod === "SEPAY" &&
    ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
    !stoppedOrderStatuses.includes(order.status) &&
    !isOrderExpired(order) &&
    !isPaymentOverdue(order)
  );
}
export async function trackOrder(raw: unknown) {
  const order = await findTrackingOrder(raw);
  return {
    canPay: canPay(order),
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    deliveryDay: order.deliveryDay,
    slotLabel: order.slotLabel,
    deliveredAt: order.deliveredAt,
    expired: isOrderExpired(order),
    paymentOverdue:
      ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
      isPaymentOverdue(order),
    items: order.items,
    serverNow: new Date().toISOString(),
  };
}
/** Public payment contains bank transfer instructions only; no customer or order internals. */
export async function trackingPayment(raw: unknown) {
  const order = await findTrackingOrder(raw);
  if (!canPay(order))
    fail(
      "PAYMENT_QR_UNAVAILABLE",
      "Đơn đã thanh toán, đã dừng hoặc hết thời gian thanh toán.",
      409,
    );
  const config = await getSepayConfig();
  const url = sepayQrUrl(config, order.total, order.paymentCode ?? order.code);
  if (!url)
    fail(
      "PAYMENT_QR_UNAVAILABLE",
      "Cửa hàng chưa sẵn sàng nhận chuyển khoản. Vui lòng liên hệ Fleurious.",
      409,
    );
  return {
    code: order.paymentCode ?? order.code,
    amount: order.total,
    url,
    bank: config.bank,
    accountNumber: config.accountNumber,
    accountName: config.accountName,
    expiresAt: paymentDeadlineIso(order),
    serverNow: new Date().toISOString(),
  };
}
export type TrackingPaymentResult = Awaited<ReturnType<typeof trackingPayment>>;
export type TrackingResult = {
  canPay: boolean;
  code: string;
  status: string;
  fulfillment: string;
  paymentStatus: string;
  createdAt: string;
  deliveryDay: string;
  slotLabel: string;
  deliveredAt: string | null;
  expired: boolean;
  paymentOverdue: boolean;
  serverNow: string;
  items: {
    name: string;
    variantName: string;
    quantity: number;
    image: string;
  }[];
};
