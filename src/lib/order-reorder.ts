import { atomic } from "./transaction";
import { cancelOrder } from "./commerce";
import { isOrderExpired } from "./order-expiry";
import { fail } from "./errors";
import { hash } from "./security";

export async function prepareReorder(
  id: string,
  userId?: string,
  guestToken?: string,
) {
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (
      !order ||
      !(
        (order.userId && order.userId === userId) ||
        (guestToken && order.guestHash === hash(guestToken))
      )
    )
      fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
    if (!isOrderExpired(order))
      fail("ORDER_NOT_EXPIRED", "Chỉ đặt lại từ đơn đã hết hạn.");
    if (order.status === "PENDING") {
      const stopped = await cancelOrder(
        tx,
        order.id,
        "Đơn hết thời gian xác nhận/thanh toán",
      );
      await tx.outbox.create({
        data: {
          userId: order.userId,
          event: "order.status_changed",
          payload: { orderId: id, version: stopped.version },
        },
      });
    }
    const variants = await tx.productVariant.findMany({
      where: {
        id: { in: order.items.map((i) => i.variantId) },
        product: { active: true },
      },
      include: { product: true },
    });
    const items: { variantId: string; quantity: number }[] = [];
    const notices: string[] = [];
    for (const item of order.items) {
      const variant = variants.find((v) => v.id === item.variantId);
      const quantity = Math.min(
        item.quantity,
        Math.max(0, (variant?.stock ?? 0) - (variant?.reserved ?? 0)),
        20,
      );
      if (quantity > 0) items.push({ variantId: item.variantId, quantity });
      if (quantity < item.quantity)
        notices.push(
          `${item.name} · ${quantity ? `còn ${quantity} sản phẩm` : "hết hàng hoặc ngừng bán"}`,
        );
    }
    return {
      items,
      notices,
      draft: {
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        address: order.address,
        zoneId: order.zoneId,
        cardMessage: order.cardMessage,
        cardWritingMode: order.cardWritingMode,
        note: order.note,
      },
      code: order.code,
    };
  });
}
