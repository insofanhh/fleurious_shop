import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { db } from "./src/lib/db";
import { hash } from "./src/lib/security";
import { processJobs, ensureCleanupJob, sendPush } from "./src/lib/jobs";
import { sendAnalytics, type AnalyticsPacket } from "./src/lib/analytics";
import {
  projectStaffNotification,
  checkOperationalNotifications,
} from "./src/lib/notifications";
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
async function main() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error("Chạy npm run setup và cấu hình SESSION_SECRET trước.");
  const app = next({ dev, hostname: "localhost", port, webpack: true });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  const io = new Server(server, {
    allowRequest: (req, done) => {
      const expected = new URL(
        process.env.APP_URL ?? `http://localhost:${port}`,
      );
      done(
        null,
        req.headers.origin === expected.origin ||
          (!req.headers.origin &&
            req.headers.host === expected.host &&
            req.headers["sec-fetch-site"] !== "cross-site"),
      );
    },
    cors: {
      origin: new URL(process.env.APP_URL ?? `http://localhost:${port}`).origin,
      credentials: true,
    },
    maxHttpBufferSize: 10000,
  });
  const pub =
    process.env.SOCKET_REDIS === "true"
      ? new Redis(process.env.REDIS_URL!, { lazyConnect: true })
      : null;
  const sub = pub?.duplicate();
  if (pub && sub) {
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
  }
  io.use(async (socket, done) => {
    try {
      const cookie = socket.request.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("fleurious_session="))
        ?.split("=")[1];
      if (cookie) {
        const session = await db.session.findUnique({
          where: { id: hash(decodeURIComponent(cookie)) },
          include: { user: true },
        });
        if (
          session &&
          session.expiresAt > new Date() &&
          !session.user.disabled
        ) {
          socket.data.userId = session.userId;
          socket.data.sessionId = session.id;
          socket.data.role = session.user.role;
        }
      }
      done();
    } catch {
      done(new Error("Không thể xác thực realtime"));
    }
  });
  io.on("connection", (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    if (["OWNER", "MANAGER", "FLORIST", "DELIVERY"].includes(socket.data.role))
      socket.join("staff:orders");
  });
  let processing = false;
  let nextOperationalCheck = 0;
  const tick = setInterval(async () => {
    if (processing) return;
    processing = true;
    try {
      await ensureCleanupJob();
      await processJobs();
      if (Date.now() >= nextOperationalCheck) {
        nextOperationalCheck = Date.now() + 60000;
        await checkOperationalNotifications().catch((error) =>
          console.error(
            "Operational notifications:",
            error instanceof Error ? error.message : "failed",
          ),
        );
      }
      const events = await db.outbox.findMany({
        where: {
          sent: false,
          OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
        take: 40,
      });
      await Promise.all(
        events.map(async (e) => {
          const lease = await db.outbox.updateMany({
            where: {
              id: e.id,
              sent: false,
              OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
            },
            data: {
              leasedUntil: new Date(Date.now() + 30000),
              attempts: { increment: 1 },
            },
          });
          if (!lease.count) return;
          if (e.event === "analytics.event") {
            const result = await sendAnalytics(
              e.payload as unknown as AnalyticsPacket,
            );
            await db.outbox.update({
              where: { id: e.id },
              data: {
                sent: result.complete,
                payload: JSON.parse(JSON.stringify(result.packet)),
                leasedUntil: result.complete
                  ? null
                  : new Date(Date.now() + 30000),
              },
            });
            return;
          }
          await projectStaffNotification(e);
          if (e.event === "settings.payment_changed") io.emit("catalog", {});
          const packet = { id: e.id, event: e.event, data: e.payload };
          if (e.userId) {
            io.to(`user:${e.userId}`).emit("update", packet);
            if (e.event !== "notification.read")
              await sendPush(
                e.userId,
                e.event,
                (e.payload as { admin?: boolean }).admin === true,
              );
          }
          if (e.event.startsWith("order."))
            io.to("staff:orders").emit("update", packet);
          await db.outbox.update({
            where: { id: e.id },
            data: { sent: true, leasedUntil: null },
          });
        }),
      );
    } catch (e) {
      console.error(
        "Background processing:",
        e instanceof Error ? e.message : "failed",
      );
    } finally {
      processing = false;
    }
  }, 3000);
  const revalidate = setInterval(async () => {
    for (const socket of io.sockets.sockets.values())
      if (socket.data.sessionId) {
        const session = await db.session.findUnique({
          where: { id: socket.data.sessionId },
          include: { user: true },
        });
        if (
          !session ||
          session.expiresAt < new Date() ||
          session.user.disabled ||
          session.user.role !== socket.data.role
        )
          socket.disconnect(true);
      }
  }, 30000);
  server.listen(port, process.env.HOST ?? "127.0.0.1", () =>
    console.log(`Fleurious ready at http://localhost:${port} · Hà Nội UTC+7`),
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(tick);
    clearInterval(revalidate);
    io.close();
    await Promise.all([pub?.quit(), sub?.quit()]);
    server.close();
    await db.$disconnect();
    process.exit(0);
  }
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
