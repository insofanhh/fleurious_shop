import { after } from "next/server";
import { equal } from "@/lib/security";
import { enqueueCloudSchedule } from "@/lib/cloud-schedule";
import { runCloudWorker } from "@/lib/cloud-worker";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function schedule(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !equal(
      request.headers.get("authorization") ?? "",
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const queued = await enqueueCloudSchedule();
  after(async () => {
    await runCloudWorker(true).catch(() =>
      console.error("Scheduled worker retry required"),
    );
  });
  return Response.json(
    { accepted: true, queued, timezone: "Asia/Ho_Chi_Minh" },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
export const POST = schedule;
export const GET = schedule;
