import { isOrderExpired } from "./order-expiry";
type WorkflowOrder = {
  dailyPlanId?: string | null;
  expiresAt?: string | Date;
  expiredAt?: string | Date | null;
  status: string;
  fulfillment: string;
  paymentStatus: string;
  paymentMethod: string;
  manualPayment?: boolean;
  refundPendingAmount?: number;
};
export const stoppedOrderStatuses = ["CANCELLED", "REFUND_PENDING", "REFUNDED"];
export function isDeliveredOrder(order: {
  status: string;
  fulfillment: string;
}) {
  return order.status === "COMPLETED" && order.fulfillment === "DELIVERED";
}
/** Payment confirms a new order; preparation/delivery progress is never reset. */
export function statusAfterPayment(status: string) {
  return status === "PENDING" ? "CONFIRMED" : status;
}
export function hasReceivedPayment(
  order: Pick<WorkflowOrder, "paymentStatus">,
) {
  return ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
    order.paymentStatus,
  );
}
export function orderLane(order: WorkflowOrder) {
  if (
    ["REFUND_PENDING", "REFUNDED"].includes(order.status) ||
    order.paymentStatus === "REFUNDED"
  )
    return "REFUND";
  if (order.status === "CANCELLED")
    return hasReceivedPayment(order) || (order.refundPendingAmount ?? 0) > 0
      ? "REFUND"
      : "CANCELLED";
  if (
    order.status === "COMPLETED" &&
    (order.paymentStatus === "PARTIALLY_REFUNDED" ||
      (order.refundPendingAmount ?? 0) > 0)
  )
    return "REFUND";
  return order.status === "PENDING" ? "PENDING" : order.fulfillment;
}
export function orderActions(o: WorkflowOrder, role: string) {
  const finance = ["OWNER", "MANAGER"].includes(role);
  const actions: { value: string; label: string }[] = [];
  if (stoppedOrderStatuses.includes(o.status)) return actions;
  if (o.expiresAt && isOrderExpired({ ...o, expiresAt: o.expiresAt }))
    return finance ? [{ value: "CANCEL", label: "Đóng đơn hết hạn" }] : [];
  if (o.status !== "COMPLETED") {
    if (
      o.status === "PENDING" &&
      (o.paymentMethod === "COD" ||
        o.manualPayment ||
        ["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus))
    )
      actions.push({ value: "CONFIRM", label: "Xác nhận đơn" });
    if (o.status === "CONFIRMED" && o.fulfillment === "UNASSIGNED")
      actions.push({ value: "PREPARE", label: "Bắt đầu chuẩn bị" });
    if (o.fulfillment === "PREPARING")
      actions.push({ value: "READY", label: "Đã sẵn sàng" });
    if (o.fulfillment === "READY")
      actions.push({ value: "DISPATCH", label: "Bắt đầu giao" });
    if (o.fulfillment === "OUT_FOR_DELIVERY")
      actions.push({
        value: "DELIVER",
        label: "Đã giao thành công",
      });
    if (
      finance &&
      !hasReceivedPayment(o) &&
      ["UNASSIGNED", "PREPARING"].includes(o.fulfillment)
    )
      actions.push({ value: "CANCEL", label: "Hủy đơn" });
  }
  if (
    finance &&
    !o.dailyPlanId &&
    ["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus)
  )
    actions.push({
      value: "REQUEST_REFUND",
      label:
        o.status === "COMPLETED"
          ? "Hoàn tiền đơn đã giao"
          : "Dừng đơn & hoàn tiền",
    });
  return actions.filter(
    (a) =>
      finance ||
      (role === "FLORIST" && ["PREPARE", "READY"].includes(a.value)) ||
      (role === "DELIVERY" && ["DISPATCH", "DELIVER"].includes(a.value)),
  );
}
