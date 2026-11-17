export function isOrderExpired(
  order: {
    status: string;
    paymentStatus: string;
    expiresAt: string | Date;
    expiredAt?: string | Date | null;
    manualPayment?: boolean;
    paymentDueAt?: string | Date | null;
    paymentMethod?: string;
    fulfillment?: string;
  },
  now = Date.now(),
) {
  return (
    ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
    (!!order.expiredAt ||
      (order.status === "PENDING" &&
        (!order.fulfillment || order.fulfillment === "UNASSIGNED") &&
        (!order.manualPayment || order.paymentMethod === "SEPAY") &&
        isPaymentOverdue(order, now)))
  );
}
export function paymentDeadline(order: {
  manualPayment?: boolean;
  paymentDueAt?: string | Date | null;
  expiresAt: string | Date;
}) {
  return order.manualPayment ? (order.paymentDueAt ?? null) : order.expiresAt;
}
export function paymentDeadlineIso(
  order: Parameters<typeof paymentDeadline>[0],
) {
  const value = paymentDeadline(order);
  return value ? new Date(value).toISOString() : undefined;
}
export function isPaymentOverdue(
  order: Parameters<typeof paymentDeadline>[0],
  now = Date.now(),
) {
  const value = paymentDeadline(order);
  return !!value && new Date(value).getTime() <= now;
}
export function deadlineSeconds(expiresAt: string, now: number) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) || 0;
}
export function formatCountdown(seconds: number) {
  const parts = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ];
  return (parts[0] ? parts : parts.slice(1))
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
