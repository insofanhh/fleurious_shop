import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { enqueueCloudSchedule } from "../src/lib/cloud-schedule";

const day = "2099-11-14";
const start = Math.floor(Date.parse(`${day}T00:00:00+07:00`) / 60000);
after(async () => {
  await db.jobRun.deleteMany({
    where: {
      OR: [
        { id: { startsWith: `digest:${day}` } },
        { id: { startsWith: `streak-reminders:${day}` } },
        ...[
          "cleanup",
          "daily-maintenance",
          "membership-maintenance",
          "delivery-reminders",
          "reconcile",
          "collection-reminders",
        ].map((name) => ({
          id: {
            in: [start, start + 420, start + 1230, start + 1231].map(
              (minute) =>
                `${name}:${name === "reconcile" ? Math.floor(minute / 15) * 15 : ["cleanup", "daily-maintenance"].includes(name) ? minute : Math.floor(minute / 5) * 5}`,
            ),
          },
        })),
      ],
    },
  });
  await db.$disconnect();
});
test("cloud minute scheduler is retry-safe and follows 07:00/20:30 in Hanoi", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  const first = new Date(`${day}T00:00:00+07:00`);
  assert.equal(await enqueueCloudSchedule(first), 6);
  assert.equal(await enqueueCloudSchedule(first), 6);
  assert.equal(await db.jobRun.count({ where: { id: `cleanup:${start}` } }), 1);
  assert.equal(await db.jobRun.count({ where: { id: `digest:${day}` } }), 0);
  await enqueueCloudSchedule(new Date(`${day}T07:00:00+07:00`));
  assert.equal(await db.jobRun.count({ where: { id: `digest:${day}` } }), 1);
  assert.equal(
    await db.jobRun.count({ where: { id: `streak-reminders:${day}` } }),
    0,
  );
  await enqueueCloudSchedule(new Date(`${day}T20:30:00+07:00`));
  await enqueueCloudSchedule(new Date(`${day}T20:31:00+07:00`));
  assert.equal(await db.jobRun.count({ where: { id: `digest:${day}` } }), 1);
  assert.equal(
    await db.jobRun.count({ where: { id: `streak-reminders:${day}` } }),
    1,
  );
});
