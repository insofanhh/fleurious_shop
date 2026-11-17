import { db } from "./db";
import { dayKey } from "./time";

/** One minute trigger from cron-job.org; time buckets and unique IDs make retries safe. */
export async function enqueueCloudSchedule(now = new Date()) {
  const minute = Math.floor(now.getTime() / 60000);
  const local = new Date(now.getTime() + 7 * 3600000);
  const clock = local.getUTCHours() * 60 + local.getUTCMinutes();
  const jobs = [
    { id: `daily-maintenance:${minute}`, name: "daily-maintenance" },
    {
      id: `collection-reminders:${Math.floor(minute / 5) * 5}`,
      name: "collection-reminders",
    },
    { id: `cleanup:${minute}`, name: "cleanup" },
    {
      id: `membership-maintenance:${Math.floor(minute / 5) * 5}`,
      name: "membership-maintenance",
    },
    {
      id: `delivery-reminders:${Math.floor(minute / 5) * 5}`,
      name: "delivery-reminders",
    },
    { id: `reconcile:${Math.floor(minute / 15) * 15}`, name: "reconcile" },
    ...(clock >= 7 * 60
      ? [{ id: `digest:${dayKey(now)}`, name: "digest" }]
      : []),
    ...(clock >= 20 * 60 + 30
      ? [{ id: `streak-reminders:${dayKey(now)}`, name: "streak-reminders" }]
      : []),
  ];
  for (const job of jobs)
    await db.jobRun.upsert({
      where: { id: job.id },
      create: { ...job, status: "QUEUED", detail: "" },
      update: {},
    });
  return jobs.length;
}
