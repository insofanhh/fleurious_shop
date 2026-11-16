import { db } from "./db";
import { ensureCleanupJob, processJobs, sendPush } from "./jobs";
import { sendAnalytics, type AnalyticsPacket } from "./analytics";
import {
  checkOperationalNotifications,
  projectStaffNotification,
} from "./notifications";

let running: Promise<void> | null = null;
let nextRun = 0;

/** Serverless work is awaited by Next after(); leases also protect concurrent instances. */
export async function runCloudWorker(force = false) {
  if (running) return running;
  if (!force && Date.now() < nextRun) return;
  nextRun = Date.now() + 15000;
  running = drain().finally(() => {
    running = null;
  });
  return running;
}

async function drain() {
  await ensureCleanupJob();
  await processJobs();
  await checkOperationalNotifications();
  const events = await db.outbox.findMany({
    where: {
      sent: false,
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  for (const event of events) {
    const lease = await db.outbox.updateMany({
      where: {
        id: event.id,
        sent: false,
        OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
      },
      data: {
        leasedUntil: new Date(Date.now() + 60000),
        attempts: { increment: 1 },
      },
    });
    if (!lease.count) continue;
    try {
      if (event.event === "analytics.event") {
        const result = await sendAnalytics(
          event.payload as unknown as AnalyticsPacket,
        );
        await db.outbox.update({
          where: { id: event.id },
          data: {
            sent: result.complete,
            payload: JSON.parse(JSON.stringify(result.packet)),
            leasedUntil: result.complete ? null : new Date(Date.now() + 60000),
          },
        });
        continue;
      }
      await projectStaffNotification(event);
      if (
        event.userId &&
        event.event !== "notification.read" &&
        event.event !== "collection.changed" &&
        (event.payload as { push?: boolean }).push !== false
      )
        await sendPush(
          event.userId,
          event.event,
          (event.payload as { admin?: boolean }).admin === true,
          event.payload,
        );
      await db.outbox.update({
        where: { id: event.id },
        data: { sent: true, leasedUntil: null },
      });
    } catch {
      // Leave the durable event leased for a later retry; never log private payloads.
      console.error("Cloud outbox delivery failed", event.id);
    }
  }
}
