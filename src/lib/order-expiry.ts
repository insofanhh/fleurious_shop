export function isOrderExpired(
  order: {
    status: string;
    paymentStatus: string;
    expiresAt: string | Date;
    expiredAt?: string | Date | null;
  },
  now = Date.now(),
) {
  return (
    ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
    (!!order.expiredAt ||
      (order.status === "PENDING" &&
        new Date(order.expiresAt).getTime() <= now))
  );
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
