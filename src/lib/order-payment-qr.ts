import { db } from "./db";
import { requireOrderCreator } from "./admin-orders";
import { getSepayConfig, sepayQrUrl } from "./sepay-settings";
import { stoppedOrderStatuses } from "./order-workflow";
import { isPaymentOverdue, paymentDeadlineIso } from "./order-expiry";
import { fail } from "./errors";
import sharp from "sharp";
import { z } from "zod";
import { atomic } from "./transaction";

export async function getOrderPaymentQr(
  actor: { id: string; role: string },
  id: string,
) {
  requireOrderCreator(actor);
  const order = await db.order.findUniqueOrThrow({ where: { id } });
  const config = await getSepayConfig();
  const available =
    order.paymentMethod === "SEPAY" &&
    ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
    !stoppedOrderStatuses.includes(order.status);
  const overdue = available && isPaymentOverdue(order);
  return {
    id: order.id,
    code: order.code,
    amount: order.total,
    paymentStatus: order.paymentStatus,
    version: order.version,
    url:
      available && !overdue
        ? (sepayQrUrl(config, order.total, order.code) ?? null)
        : null,
    bank: config.bank,
    accountNumber: config.accountNumber,
    accountName: config.accountName,
    deadline: paymentDeadlineIso(order) ?? null,
    overdue,
    manualPayment: order.manualPayment,
    canEditTerms: available && order.manualPayment,
    serverNow: new Date().toISOString(),
  };
}
export async function setOrderPaymentTerms(
  actor: { id: string; role: string },
  id: string,
  raw: unknown,
) {
  requireOrderCreator(actor);
  const input = z
    .object({
      version: z.number().int().positive(),
      minutes: z.number().int().min(15).max(43200).nullable(),
      reason: z.string().trim().min(4).max(300),
    })
    .parse(raw);
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    if (order.version !== input.version)
      fail("STALE_ORDER_VERSION", "Đơn đã thay đổi, hãy tải lại.", 409);
    if (
      !order.manualPayment ||
      order.paymentMethod !== "SEPAY" ||
      !["UNPAID", "PENDING"].includes(order.paymentStatus) ||
      stoppedOrderStatuses.includes(order.status)
    )
      fail(
        "PAYMENT_TERMS_LOCKED",
        "Chỉ đổi hạn cho đơn chuyển khoản thủ công còn chờ thanh toán.",
      );
    const deadline =
      input.minutes === null
        ? null
        : new Date(Date.now() + input.minutes * 60000);
    await tx.order.update({
      where: { id },
      data: {
        paymentDueAt: deadline,
        version: { increment: 1 },
        history: {
          create: { text: `Cập nhật hạn thanh toán · ${input.reason}` },
        },
      },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "order.payment_terms",
        entityId: id,
        detail: { ...input, deadline: deadline?.toISOString() ?? null },
      },
    });
    await tx.outbox.create({
      data: {
        userId: order.userId,
        event: "order.status_changed",
        payload: { orderId: id, version: order.version + 1 },
      },
    });
    return { success: true };
  });
}

/** Fetch only the server-generated bank QR URL, never a client-supplied image URL. */
export async function downloadOrderPaymentQr(
  actor: { id: string; role: string },
  id: string,
  fetcher = fetch,
) {
  const data = await getOrderPaymentQr(actor, id);
  if (!data.url)
    fail(
      "PAYMENT_QR_UNAVAILABLE",
      "Đơn đã thanh toán, đã dừng, quá hạn hoặc chưa cấu hình ngân hàng.",
      409,
    );
  const response = await fetcher(data.url, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    fail(
      "PAYMENT_QR_DOWNLOAD_FAILED",
      "Chưa tải được QR ngân hàng, vui lòng thử lại.",
      502,
    );
  if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024)
    fail("INVALID_QR_IMAGE", "Ảnh QR vượt giới hạn.", 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 4 * 1024 * 1024)
    fail("INVALID_QR_IMAGE", "Ảnh QR vượt giới hạn.", 502);
  const png = await sharp(bytes, { limitInputPixels: 16000000 })
    .png()
    .toBuffer();
  return { png, code: data.code };
}
