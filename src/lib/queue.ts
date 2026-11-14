import { Queue } from "bullmq";
export function redisConnection(blocking = false) {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    maxRetriesPerRequest: blocking ? null : 1,
    connectTimeout: 2000,
    enableOfflineQueue: blocking,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
let queue: Queue | undefined;
export async function enqueueJob(id: string) {
  if (process.env.QUEUE_DRIVER !== "redis") return;
  try {
    if (!queue) {
      queue = new Queue("fleurious-jobs", {
        connection: redisConnection(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      });
      queue.on("error", () => {});
    }
    await queue.add("run", { id }, { jobId: id.replaceAll(":", "-") });
  } catch {
    console.warn(
      "Redis queue unavailable; durable database worker will recover the job.",
    );
  }
}
