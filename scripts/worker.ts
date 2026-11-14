import "dotenv/config";
import { processJobs, ensureCleanupJob } from "../src/lib/jobs";
import { db } from "../src/lib/db";
import { Worker } from "bullmq";
import { redisConnection } from "../src/lib/queue";
const worker =
  process.env.QUEUE_DRIVER === "redis"
    ? new Worker("fleurious-jobs", async (job) => processJobs(job.data.id), {
        connection: redisConnection(true),
      })
    : null;
worker?.on("error", () =>
  console.error(
    "Redis worker connection unavailable; database polling continues.",
  ),
);
let running = false;
const interval = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await ensureCleanupJob();
    await processJobs();
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Worker error");
  } finally {
    running = false;
  }
}, 5000);
console.log(
  "Durable MySQL worker running. Jobs use database leases and idempotent operations.",
);
process.on("SIGINT", async () => {
  clearInterval(interval);
  await worker?.close();
  await db.$disconnect();
  process.exit(0);
});
