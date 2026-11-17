import type { Outbox, Prisma } from "@prisma/client";
import { db } from "./db";
import { can } from "./auth-policy";
import { dayKey, money } from "./time";
import { notifyCollectionOpened } from "./collections";

const staffRoles = [
  "OWNER",
  "MANAGER",
  "FLORIST",
  "DELIVERY",
  "MARKETING",
  "ACCOUNTANT",
];
const areas = [
  "orders",
  "calendar",
  "customers",
  "payments",
  "content",
  "settings",
  "products",
];
export function notificationScope(
  userId: string,
  role: string,
  admin: boolean,
): Prisma.NotificationWhereInput {
  return admin
    ? {
        userId,
        OR: areas
          .filter((area) => can(role, area))
          .map((area): Prisma.NotificationWhereInput => ({
            dedupKey: { startsWith: `staff:${area}:` },
          }))
          .concat(can(role, "calendar") ? [{ url: "/admin/calendar" }] : []),
      }
    : {
        userId,
        NOT: { url: { startsWith: "/admin/" } },
        OR: [
          { dedupKey: null },
          { NOT: { dedupKey: { startsWith: "staff:" } } },
        ],
      };
}

/** One durable inbox entry per recipient and event, even when an outbox lease retries. */
export async function notifyStaff(
  key: string,
  area: string,
  title: string,
  body: string,
  url: string,
) {
  const recipients = await db.user.findMany({
    where: { disabled: false, role: { in: staffRoles } },
    select: { id: true, role: true },
  });
  for (const user of recipients.filter((user) => can(user.role, area))) {
    await db.$transaction(async (tx) => {
      const created = await tx.notification.createMany({
        data: [
          {
            userId: user.id,
            dedupKey: `staff:${area}:${key}:${user.id}`,
            title,
            body,
            url,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count)
        await tx.outbox.create({
          data: {
            userId: user.id,
            event: "notification.created",
            payload: { admin: true, key },
          },
        });
    });
  }
}

export async function projectStaffNotification(event: Outbox) {
  const payload = event.payload as Record<string, unknown>;
  if (event.event.startsWith("daily.") && typeof payload.planId === "string") {
    await notifyStaff(
      event.id,
      event.event.includes("refund") ? "payments" : "orders",
      event.event === "daily.action_required"
        ? "Lịch Daily cần xử lý"
        : "Cập nhật Fleurious Daily",
      "Mở lịch hoa để xem thanh toán, các lượt giao và việc cần chuẩn bị.",
      `/admin/daily?plan=${payload.planId}`,
    );
    return;
  }
  if (event.event.startsWith("order.") && typeof payload.orderId === "string") {
    const order = await db.order.findUnique({ where: { id: payload.orderId } });
    if (!order) return;
    const labels: Record<string, string> = {
      PENDING: "Chờ xác nhận",
      CONFIRMED: "Đã xác nhận",
      CANCELLED: "Đã hủy",
      REFUND_PENDING: "Chờ hoàn tiền",
      REFUNDED: "Đã hoàn tiền",
      PARTIALLY_REFUNDED: "Đã hoàn một phần",
      COMPLETED: "Hoàn thành",
      PREPARING: "Đang chuẩn bị",
      READY: "Sẵn sàng giao",
      OUT_FOR_DELIVERY: "Đang giao",
      DELIVERED: "Đã giao",
      UNASSIGNED: "Chờ chuẩn bị",
      PAID: "Đã thanh toán",
      UNPAID: "Chưa thanh toán",
    };
    await notifyStaff(
      event.id,
      "orders",
      event.event === "order.created"
        ? `Đơn hàng mới · ${order.code}`
        : `Cập nhật đơn · ${order.code}`,
      `${money(order.total)} · ${labels[order.status] ?? order.status} · ${labels[order.fulfillment] ?? order.fulfillment} · ${labels[order.paymentStatus] ?? order.paymentStatus}`,
      `/admin/orders?q=${encodeURIComponent(order.code)}`,
    );
    if (order.fulfillment === "DELIVERED")
      await notifyCollectionOpened(order.id);
  } else if (event.event === "user.registered" && event.userId) {
    const user = await db.user.findUnique({ where: { id: event.userId } });
    if (user)
      await notifyStaff(
        event.id,
        "customers",
        "Khách hàng mới đăng ký",
        `${user.name} vừa tạo tài khoản tại Fleurious.`,
        "/admin/customers",
      );
  } else if (event.event === "review.created") {
    await notifyStaff(
      event.id,
      "content",
      "Đánh giá mới chờ duyệt",
      "Một khách hàng vừa gửi đánh giá sản phẩm. Mở mục đánh giá để kiểm tra.",
      "/admin/reviews",
    );
  } else if (
    event.event === "membership.invoice_created" &&
    typeof payload.invoiceId === "string"
  ) {
    const invoice = await db.membershipInvoice.findUnique({
      where: { id: payload.invoiceId },
      include: { tierVersion: { include: { tier: true } } },
    });
    if (invoice)
      await notifyStaff(
        event.id,
        "customers",
        "Đăng ký gói hội viên mới",
        `${invoice.code} · ${invoice.tierVersion.tier.name} · ${invoice.cycle === "YEAR" ? "Gói năm" : "Gói tháng"} · ${money(invoice.amount)} · Chờ thanh toán`,
        "/admin/members",
      );
  } else if (event.event === "membership.changed" && event.userId) {
    const titles: Record<string, string> = {
      enrolled: "Hội viên mới",
      paid_activated: "Gói hội viên đã thanh toán",
      earned: "Khách hàng đạt hạng mới",
      admin_granted: "Đã cấp hạng hội viên",
      admin_revoked: "Đã thu hồi hạng hội viên",
    };
    const title = titles[String(payload.action)];
    const user = title
      ? await db.user.findUnique({ where: { id: event.userId } })
      : null;
    if (user)
      await notifyStaff(
        event.id,
        "customers",
        title,
        `${user.name} · Mở quản lý hội viên để xem quyền lợi và giao dịch.`,
        "/admin/members",
      );
  }
}

/** Persistent operational alerts are checked once a minute; keys prevent alert spam. */
export async function checkOperationalNotifications() {
  const [payments, jobs, refunds, variants, waiting] = await Promise.all([
    db.payment.findMany({
      where: { state: "REVIEW" },
      take: 50,
      orderBy: { id: "desc" },
    }),
    db.jobRun.findMany({
      where: { status: "FAILED" },
      take: 30,
      orderBy: { updatedAt: "desc" },
    }),
    db.membershipRefund.findMany({
      where: { status: "PENDING" },
      take: 30,
      include: { invoice: true },
    }),
    db.productVariant.findMany({
      where: { product: { active: true } },
      include: { product: { select: { name: true } } },
    }),
    db.reward.count({ where: { status: "WAITING_BUDGET" } }),
  ]);
  for (const payment of payments)
    await notifyStaff(
      `payment:${payment.id}`,
      "payments",
      "Giao dịch SePay cần đối soát",
      `${money(payment.amount)} · ${payment.reason || "Giao dịch chưa khớp tự động."}`,
      "/admin/payments",
    );
  for (const job of jobs)
    await notifyStaff(
      `job:${job.id}:${job.updatedAt.getTime()}`,
      "settings",
      "Tác vụ nền thất bại",
      `${job.name} đã thất bại sau ${job.attempts} lần thử. Mở tác vụ nền để kiểm tra.`,
      "/admin/jobs",
    );
  for (const refund of refunds)
    await notifyStaff(
      `refund:${refund.id}`,
      "customers",
      "Yêu cầu hoàn phí hội viên",
      `${refund.invoice.code} · ${money(refund.amount)} đang chờ xử lý.`,
      "/admin/members",
    );
  const low = variants.filter((v) => v.stock - v.reserved <= 3);
  if (low.length)
    await notifyStaff(
      `stock:${dayKey()}`,
      "products",
      "Hoa sắp hết hàng",
      `${low.length} lựa chọn còn tối đa 3 sản phẩm có thể bán. Kiểm tra tồn kho trước khi nhận thêm đơn.`,
      "/admin/inventory",
    );
  if (waiting)
    await notifyStaff(
      `reward-budget:${dayKey()}`,
      "customers",
      "Ưu đãi đang chờ ngân sách",
      `${waiting} phần thưởng giữ chuỗi đang chờ mở ngân sách.`,
      "/admin/streaks",
    );
}
