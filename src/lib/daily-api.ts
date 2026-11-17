import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dailyPreparationCsv } from "./daily-export";
import { dayKey } from "./time";
import type { User } from "@prisma/client";
import { z } from "zod";
import { json, rateLimit } from "./api";
import { fail } from "./errors";
import { db } from "./db";
import { can } from "./auth-policy";
import { isDailyCategory } from "./catalogue";
import { dailyCalendarMonth } from "./daily-calendar";
import { reconcileDailyPayment, confirmDailyPayment } from "./daily-finance";
import {
  dailyPublic,
  suggestDailyFlowers,
  dailyAvailability,
  dailyConfig,
  dailyOfferings,
  publishDaily,
  saveDailyOffering,
  quoteDaily,
  createDaily,
  listDaily,
  dailyPlanView,
  editDailyDelivery,
} from "./daily";
import {
  cancelUnpaidDaily,
  requestDailyRefund,
  completeDailyRefund,
  dailyMaintenance,
  refundDailyTransfer,
} from "./daily-operations";

export async function handleDailyApi(
  req: NextRequest,
  path: string[],
  user: User | null,
  body: () => Promise<unknown>,
) {
  const method = req.method,
    admin = path[0] === "admin" && path[1] === "daily",
    action = path.join("/");
  if (path[0] !== "daily" && !admin) return null;
  if (action === "daily/config" && method === "GET")
    return json(await dailyPublic());
  if (action === "daily/availability" && method === "GET")
    return json(
      await dailyAvailability(
        req.nextUrl.searchParams.get("from") ?? "",
        req.nextUrl.searchParams.get("to") ?? "",
      ),
    );
  if (!user)
    fail("UNAUTHORIZED", "Vui lòng đăng nhập để quản lý lịch hoa.", 401);
  if (admin && !(can(user.role, "orders") || can(user.role, "payments")))
    fail("FORBIDDEN", "Bạn không có quyền xem lịch Daily.", 403);
  if (action === "admin/daily/calendar" && method === "GET")
    return json(
      await dailyCalendarMonth(user, req.nextUrl.searchParams.get("month")),
    );
  if (action === "admin/daily/export" && method === "GET") {
    const day = req.nextUrl.searchParams.get("day") ?? dayKey();
    return new NextResponse(await dailyPreparationCsv(user, day), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fleurious-daily-${day}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (action === "daily/quote" && method === "POST") {
    await rateLimit(`daily:quote:${user.id}`, 90, 300);
    return json(await quoteDaily(user.id, await body()));
  }
  if (action === "daily/suggestions" && method === "POST") {
    await rateLimit(`daily:suggestions:${user.id}`, 90, 300);
    return json(await suggestDailyFlowers(user.id, await body()));
  }
  if (action === "daily/plans" && method === "POST") {
    await rateLimit(`daily:create:${user.id}`, 15, 300);
    const consent = z
      .uuid()
      .safeParse(req.cookies.get("fleurious_analytics_id")?.value);
    const p = await createDaily(user, await body(), {
      analyticsClientId:
        req.cookies.get("fleurious_analytics")?.value === "yes" &&
        consent.success
          ? consent.data
          : undefined,
    });
    return json(await dailyPlanView(p.id, user), 201);
  }
  if (
    (action === "daily/plans" || action === "admin/daily") &&
    method === "GET"
  )
    return json(
      await listDaily(
        user,
        admin,
        req.nextUrl.searchParams.get("day") ?? undefined,
      ),
    );
  if (action === "admin/daily/settings") {
    if (!can(user.role, "settings"))
      fail("FORBIDDEN", "Bạn không có quyền cấu hình Daily.", 403);
    if (method === "PATCH") return json(await publishDaily(user, await body()));
    if (method === "GET")
      return json({
        ...(await dailyConfig()),
        offerings: await dailyOfferings(db, true),
        products: (
          await db.product.findMany({
            select: {
              id: true,
              name: true,
              active: true,
              category: true,
              taxonomies: {
                select: { taxonomy: { select: { kind: true, name: true } } },
              },
              variants: { select: { id: true, name: true, price: true } },
            },
          })
        ).filter(
          (p) =>
            p.taxonomies.some(
              (t) =>
                t.taxonomy.kind === "CATEGORY" &&
                isDailyCategory(t.taxonomy.name),
            ) || isDailyCategory(p.category),
        ),
      });
  }
  if (admin && path[2] === "offerings" && ["POST", "PATCH"].includes(method))
    return json(await saveDailyOffering(user, await body(), path[3]));
  if (action === "admin/daily/run" && method === "POST") {
    if (!["OWNER", "MANAGER"].includes(user.role))
      fail("FORBIDDEN", "Chỉ quản lý được chạy lịch thủ công.", 403);
    return json({ processed: await dailyMaintenance() });
  }
  if (
    admin &&
    path[2] === "refunds" &&
    path[3] &&
    path[4] === "complete" &&
    method === "POST"
  ) {
    const input = z.object({ reference: z.string() }).parse(await body());
    return json(await completeDailyRefund(user, path[3], input.reference));
  }
  const planId = admin ? path[2] : path[1] === "plans" ? path[2] : undefined;
  if (planId) {
    if (
      admin &&
      path[3] === "invoices" &&
      path[4] &&
      path[5] === "confirm-payment" &&
      path.length === 6 &&
      method === "POST"
    )
      return json(
        await confirmDailyPayment(user, planId, path[4], await body()),
      );
    if (
      admin &&
      path[3] === "payments" &&
      path[4] &&
      path[5] === "refund" &&
      method === "POST"
    ) {
      const input = z.object({ reason: z.string() }).parse(await body());
      return json(
        await refundDailyTransfer(user, planId, path[4], input.reason),
      );
    }
    if (admin && path[3] === "reconcile" && method === "POST")
      return json(await reconcileDailyPayment(user, planId, await body()));
    if (path.length === 3 && method === "GET")
      return json(await dailyPlanView(planId, user, admin));
    if (path[3] === "deliveries" && path[4] && method === "PATCH")
      return json(
        await editDailyDelivery(user, planId, path[4], await body(), admin),
      );
    if (path[3] === "refunds" && method === "POST")
      return json(await requestDailyRefund(user, planId, await body(), admin));
    if (path[3] === "cancel" && method === "POST")
      return json(await cancelUnpaidDaily(user, planId));
  }
  fail("NOT_FOUND", "Không tìm thấy chức năng Daily.", 404);
}
