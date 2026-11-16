export const journeySteps = [
  { id: "PENDING", label: "Đã nhận đơn" },
  { id: "UNASSIGNED", label: "Đã xác nhận" },
  { id: "PREPARING", label: "Đang chuẩn bị hoa" },
  { id: "READY", label: "Sẵn sàng giao" },
  { id: "OUT_FOR_DELIVERY", label: "Đang giao hoa" },
  { id: "DELIVERED", label: "Đã giao hoa" },
];
export function journeyState(order: {
  status: string;
  fulfillment: string;
  expired?: boolean;
}) {
  const stopped =
    !!order.expired ||
    ["CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(order.status);
  const current =
    order.status === "PENDING"
      ? 0
      : Math.max(
          0,
          journeySteps.findIndex((step) => step.id === order.fulfillment),
        );
  return {
    current,
    stopped,
    animateNext: !stopped && current < journeySteps.length - 1,
  };
}
