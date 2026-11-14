import { stoppedOrderStatuses } from "./order-workflow";
import * as webpush from "web-push";
import { db } from "./db";
import { expireReservations } from "./commerce";
import { dayKey, shiftDay, localInstant } from "./time";
import { getSettings } from "./settings";
import { atomic } from "./commerce";
import { membershipMaintenance } from "./membership";
import { reconcileSepay } from "./sepay-reconcile";
export async function fundWaitingRewards() {
  const settings = await getSettings();
  await atomic(async (tx) => {
    await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\` = 'reward_budget' FOR UPDATE`;
    const budget = await tx.setting.findUniqueOrThrow({
      where: { key: "reward_budget" },
    });
    let used = Number((budget.value as { committed: number }).committed);
    const waiting = await tx.reward.findMany({
      where: { status: "WAITING_BUDGET" },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const reward of waiting) {
      if (used + reward.cap > settings.campaignBudget) break;
      await tx.reward.update({
        where: { id: reward.id },
        data: {
          status: "AVAILABLE",
          expiresAt: new Date(Date.now() + reward.validDays * 86400000),
        },
      });
      used += reward.cap;
      await tx.notification.create({
        data: {
          userId: reward.userId,
          title: "Ưu đãi của bạn đã sẵn sàng",
          body: reward.title,
          url: "/account/rewards",
        },
      });
      await tx.outbox.create({
        data: {
          userId: reward.userId,
          event: "reward.issued",
          payload: { rewardId: reward.id },
        },
      });
    }
    await tx.setting.update({
      where: { key: "reward_budget" },
      data: { value: { committed: used } },
    });
  });
}
export async function ensureCleanupJob() {
  await db.jobRun.upsert({
    where: {
      id: `membership-maintenance:${Math.floor(Date.now() / 300000) * 5}`,
    },
    create: {
      id: `membership-maintenance:${Math.floor(Date.now() / 300000) * 5}`,
      name: "membership-maintenance",
      status: "QUEUED",
      detail: "",
    },
    update: {},
  });
  const id = `cleanup:${Math.floor(Date.now() / 60000)}`;
  await db.jobRun.upsert({
    where: { id },
    create: { id, name: "cleanup", status: "QUEUED", detail: "" },
    update: {},
  });
}
async function notifyOnce(
  userId: string,
  key: string,
  title: string,
  body: string,
  url: string,
) {
  if (url.startsWith("/admin/")) key = `staff:calendar:${key}`;
  await atomic(async (tx) => {
    const exists = await tx.notification.findUnique({
      where: { dedupKey: key },
    });
    if (exists) return;
    await tx.notification.create({
      data: { userId, dedupKey: key, title, body, url },
    });
    await tx.outbox.create({
      data: {
        userId,
        event: "notification.created",
        payload: { url, admin: url.startsWith("/admin/") },
      },
    });
  });
}
export async function processJobs(onlyId?: string) {
  await db.jobRun.updateMany({
    where: {
      status: "RUNNING",
      attempts: { gte: 3 },
      updatedAt: { lt: new Date(Date.now() - 300000) },
    },
    data: { status: "FAILED" },
  });
  await db.jobRun.updateMany({
    where: {
      status: "RUNNING",
      attempts: { lt: 3 },
      updatedAt: { lt: new Date(Date.now() - 300000) },
    },
    data: { status: "QUEUED" },
  });
  const jobs = await db.jobRun.findMany({
    where: {
      status: "QUEUED",
      availableAt: { lte: new Date() },
      attempts: { lt: 3 },
      ...(onlyId ? { id: onlyId } : {}),
    },
    take: 5,
    orderBy: { createdAt: "asc" },
  });
  for (const job of jobs) {
    const locked = await db.jobRun.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });
    if (!locked.count) continue;
    try {
      const count = await expireReservations();
      await fundWaitingRewards();
      if (["membership-maintenance", "membership-recheck"].includes(job.name))
        await membershipMaintenance(job.name === "membership-recheck");
      if (job.name === "reconcile") await reconcileSepay();
      if (job.name === "delivery-reminders") {
        const orders = await db.order.findMany({
          where: {
            status: "CONFIRMED",
            deliveryDay: dayKey(),
            userId: { not: null },
            fulfillment: { not: "DELIVERED" },
          },
          take: 200,
        });
        for (const o of orders)
          if (
            o.deliveryStart &&
            o.deliveryStart.getTime() - Date.now() <= 2 * 3600000 &&
            o.deliveryStart > new Date()
          )
            await notifyOnce(
              o.userId!,
              `delivery:${o.id}:${o.deliveryDay}:${o.slotId}`,
              "Hoa sắp lên đường",
              `Đơn ${o.code} dự kiến giao trong khung ${o.slotLabel}.`,
              `/orders/${o.id}`,
            );
      }
      if (job.name === "streak-reminders") {
        const candidates = await db.activeDay.findMany({
          where: { day: shiftDay(dayKey(), -1), valid: true },
          include: { user: { include: { pushes: true } } },
          take: 200,
        });
        for (const d of candidates)
          if (
            d.user.pushes.length &&
            !(await db.activeDay.findUnique({
              where: { userId_day: { userId: d.userId, day: dayKey() } },
            }))
          )
            await notifyOnce(
              d.userId,
              `streak:${d.userId}:${dayKey()}`,
              "Một ngày mới đang chờ hoa",
              "Nếu bạn có QR còn hạn, hãy thêm một kỷ niệm vào lịch hôm nay.",
              "/streak",
            );
      }
      if (job.name === "digest") {
        const orders = await db.order.count({
          where: {
            deliveryDay: dayKey(),
            status: { notIn: stoppedOrderStatuses },
          },
        });
        const managers = await db.user.findMany({
          where: { role: { in: ["OWNER", "MANAGER"] } },
          select: { id: true },
        });
        for (const u of managers)
          await notifyOnce(
            u.id,
            `digest:${u.id}:${dayKey()}`,
            "Lịch hoa hôm nay",
            `${orders} đơn dự kiến giao hôm nay. Mở lịch để phân công và chuẩn bị.`,
            "/admin/calendar",
          );
      }
      await db.jobRun.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          detail: JSON.stringify({
            expiredOrders: count,
            timeZone: "Asia/Ho_Chi_Minh",
            day: dayKey(),
          }),
        },
      });
    } catch (e) {
      await db.jobRun.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= 2 ? "FAILED" : "QUEUED",
          availableAt: new Date(Date.now() + 30000 * Math.pow(2, job.attempts)),
          detail: e instanceof Error ? e.message : "Unknown failure",
        },
      });
    }
  }
}
export async function sendPush(userId: string, event: string, admin = false) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hello@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
  });
  for (const s of subscriptions)
    try {
      await webpush.sendNotification(
        s.subscription as unknown as webpush.PushSubscription,
        JSON.stringify({
          title: "Fleurious · Một cập nhật nhỏ",
          body: admin
            ? "Cửa hàng vừa có cập nhật mới. Mở bảng thông báo để xem chi tiết."
            : event.startsWith("order.")
              ? "Đơn hoa của bạn vừa được cập nhật."
              : "Lịch hoa hoặc ưu đãi của bạn vừa có điều mới.",
          url: admin ? "/admin/notifications" : "/notifications",
        }),
        { TTL: 3600 },
      );
    } catch (error) {
      if (
        (error as { statusCode?: number }).statusCode === 410 ||
        (error as { statusCode?: number }).statusCode === 404
      )
        await db.pushSubscription.delete({ where: { id: s.id } });
    }
}
