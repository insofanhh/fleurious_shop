import { stoppedOrderStatuses } from "./order-workflow";
import { db } from "./db";
import { decrypt } from "./security";
import { fail } from "./errors";
import type { FlowerCard } from "./flower-card";

export async function getOrderCard(
  actor: { id: string; role: string },
  id: string,
) {
  if (!["OWNER", "MANAGER", "FLORIST"].includes(actor.role))
    fail(
      "FORBIDDEN",
      "Chỉ quản lý và nhân viên chuẩn bị hoa được tải card giữ chuỗi.",
      403,
    );
  const order = await db.order.findUnique({
    where: { id },
    include: { qr: true },
  });
  if (!order?.qr) fail("NOT_FOUND", "Đơn chưa có QR giữ chuỗi.", 404);
  const grant = order.qr;
  const state =
    grant.revoked || stoppedOrderStatuses.includes(order.status)
      ? "REVOKED"
      : grant.expiresAt && grant.expiresAt <= new Date()
        ? "EXPIRED"
        : grant.claimsCount >= grant.maxClaims
          ? "EXHAUSTED"
          : grant.eligibleAt
            ? "READY"
            : "PENDING";
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000");
  const card: FlowerCard = {
    code: order.code,
    buyerName: order.dailyPlanId
      ? ((
          await db.dailyPlan.findUnique({
            where: { id: order.dailyPlanId },
            select: { senderName: true },
          })
        )?.senderName ?? order.buyerName)
      : order.buyerName,
    recipientName: order.recipientName,
    message: order.cardMessage,
    writingMode:
      order.cardWritingMode === "HANDWRITTEN" ? "HANDWRITTEN" : "AUTO",
    qrUrl: new URL(`/q/${decrypt(grant.tokenEncrypted)}`, origin).href,
  };
  return {
    card,
    state,
    printable: state === "READY" || state === "PENDING",
    remaining: Math.max(0, grant.maxClaims - grant.claimsCount),
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    localUrl:
      origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1" ||
      origin.protocol !== "https:",
    longMessage:
      order.cardWritingMode !== "HANDWRITTEN" && order.cardMessage.length > 250,
    writingMode: card.writingMode,
  };
}
