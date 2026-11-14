import { upgradeWebSocket } from "@vercel/functions";
import { NextRequest } from "next/server";
import { currentUser, SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { hash } from "@/lib/security";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const expected = new URL(process.env.APP_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected)
    return new Response("Forbidden", { status: 403 });
  if (process.env.VERCEL !== "1")
    return new Response("Use the local Socket.IO endpoint", { status: 404 });
  const user = await currentUser();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const staff =
    user && ["OWNER", "MANAGER", "FLORIST", "DELIVERY"].includes(user.role);
  const allowed: Prisma.OutboxWhereInput[] = [
    { event: "settings.payment_changed" },
  ];
  if (user)
    allowed.push({ userId: user.id, NOT: { event: "analytics.event" } });
  if (staff) allowed.push({ event: { startsWith: "order." } });
  return upgradeWebSocket(
    (ws) => {
      let busy = false;
      let validationAt = 0;
      const seen = new Map<string, number>();
      const startedAt = Date.now();
      const interval = setInterval(async () => {
        if (busy || ws.readyState !== 1) return;
        busy = true;
        try {
          if (user && Date.now() >= validationAt) {
            const session =
              token &&
              (await db.session.findUnique({
                where: { id: hash(token) },
                include: { user: true },
              }));
            if (
              !session ||
              session.expiresAt <= new Date() ||
              session.user.disabled ||
              session.user.role !== user.role
            ) {
              ws.close(1008, "Session expired");
              return;
            }
            validationAt = Date.now() + 30000;
          }
          const cutoff = Math.max(startedAt, Date.now() - 60000);
          const events = await db.outbox.findMany({
            where: { createdAt: { gte: new Date(cutoff) }, OR: allowed },
            orderBy: { createdAt: "desc" },
            take: 200,
            select: { id: true, event: true, createdAt: true },
          });
          const fresh = events.filter((event) => !seen.has(event.id));
          for (const event of fresh)
            seen.set(event.id, event.createdAt.getTime());
          for (const [id, time] of seen) if (time < cutoff) seen.delete(id);
          if (fresh.length)
            ws.send(
              JSON.stringify({
                type: fresh.some((e) => e.event === "settings.payment_changed")
                  ? "catalog"
                  : "sync",
              }),
            );
          // Reconnect before the platform duration limit; the client reloads its snapshot.
          if (Date.now() - startedAt > 240000) ws.close(1000, "Reconnect");
        } catch {
          ws.close(1011, "Please reconnect");
        } finally {
          busy = false;
        }
      }, 3000);
      const stop = () => clearInterval(interval);
      ws.on("close", stop);
      ws.on("error", stop);
      ws.send(JSON.stringify({ type: "sync" }));
    },
    { maxPayload: 1024 },
  );
}
