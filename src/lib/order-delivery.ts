import type { User } from "@prisma/client";
import { z } from "zod";
import { atomic } from "./transaction";
import { transitionOrderTx } from "./commerce";
import { confirmOrderPaymentTx } from "./order-payments";
import { fail } from "./errors";

/** A financial confirmation and delivery commit together, or both roll back. */
export async function deliverOrder(id: string, raw: unknown, actor: User) {
  const input = z
    .object({
      version: z.number().int().positive(),
      collection: z.enum(["UNPAID", "SHOP", "SHIPPER", "SHIPPER_REPORT"]),
      reference: z.string().trim().max(100).default(""),
      reason: z.string().trim().max(300).default(""),
      collectorId: z.string().max(100).optional(),
    })
    .parse(raw);
  if (
    actor.role === "DELIVERY" &&
    !["UNPAID", "SHIPPER_REPORT"].includes(input.collection)
  )
    fail("FORBIDDEN", "Kế toán hoặc quản lý cần xác minh phiếu thu hộ.", 403);
  if (
    input.collection === "SHIPPER_REPORT" &&
    (actor.role !== "DELIVERY" ||
      input.reference.length < 4 ||
      input.reason.length < 4)
  )
    fail(
      "INVALID_COLLECTION_REPORT",
      "Báo cáo thu hộ cần phiếu thu và ghi chú tối thiểu 4 ký tự.",
    );
  return atomic(async (tx) => {
    let order = await transitionOrderTx(
      tx,
      id,
      "DELIVER",
      input.version,
      actor,
      false,
    );
    if (
      input.collection === "SHIPPER_REPORT" &&
      ["UNPAID", "PENDING"].includes(order.paymentStatus)
    ) {
      const debt = await tx.codReceivable.findUniqueOrThrow({
        where: { orderId: id },
      });
      await tx.collectionEvent.create({
        data: {
          receivableId: debt.id,
          actorId: actor.id,
          action: "COLLECTION_REPORTED",
          note: `${actor.name} báo đã thu hộ · chờ xác minh · ${input.reference} · ${input.reason}`.slice(
            0,
            500,
          ),
        },
      });
    }
    if (
      ["SHOP", "SHIPPER"].includes(input.collection) &&
      ["UNPAID", "PENDING"].includes(order.paymentStatus)
    )
      order = await confirmOrderPaymentTx(
        tx,
        id,
        {
          version: order.version,
          destination: input.collection,
          reference: input.reference,
          reason: input.reason,
          collectorId: input.collectorId,
        },
        actor,
        false,
      );
    await tx.outbox.create({
      data: {
        userId: order.userId,
        event: "order.status_changed",
        payload: { orderId: id, version: order.version },
      },
    });
    if (order.userId)
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: `Đơn ${order.code}`,
          body: "Hoa đã tới nơi. QR giữ chuỗi đã sẵn sàng!",
          url: `/orders/${id}`,
        },
      });
    return order;
  });
}
