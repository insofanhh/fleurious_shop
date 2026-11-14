import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { hash } from "./security";
import { AppError, fail } from "./errors";
export { AppError, fail } from "./errors";
export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function handle(fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return json(
        {
          error: "Mục này đã tồn tại hoặc yêu cầu đã được xử lý.",
          code: "CONFLICT",
        },
        409,
      );
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025")
      return json({ error: "Không tìm thấy dữ liệu.", code: "NOT_FOUND" }, 404);
    if (e instanceof AppError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error: e.issues[0]?.message ?? "Dữ liệu không hợp lệ",
          code: "INVALID_INPUT",
        },
        400,
      );
    console.error(
      "Request failed",
      e instanceof Prisma.PrismaClientKnownRequestError
        ? e.code
        : e instanceof Error
          ? e.name
          : "unknown",
    );
    return json(
      { error: "Chưa thể xử lý. Vui lòng thử lại.", code: "INTERNAL_ERROR" },
      500,
    );
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(process.env.APP_URL ?? request.url).origin)
    fail("INVALID_ORIGIN", "Yêu cầu không hợp lệ.", 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    fail("INVALID_CONTENT_TYPE", "Chỉ chấp nhận JSON.", 415);
}
export async function rateLimit(key: string, limit = 20, windowSeconds = 60) {
  const id = hash(`${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`);
  const row = await db.rateLimit.upsert({
    where: { id },
    create: { id, expiresAt: new Date(Date.now() + windowSeconds * 1000) },
    update: { count: { increment: 1 } },
  });
  if (row.count > limit)
    fail("RATE_LIMIT", "Bạn thao tác quá nhanh. Vui lòng thử lại sau.", 429);
}
