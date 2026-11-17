import type { User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { can } from "./auth-policy";
import { fail } from "./errors";
import { calendarMonthDays } from "./daily-pricing";
import { dayKey } from "./time";
import type { DailyOfferingView } from "./daily-types";

/** The delivery calendar covers the entire month, independent of the latest 100 plans. */
export async function dailyCalendarMonth(
  actor: Pick<User, "id" | "role">,
  raw: unknown,
) {
  if (!(can(actor.role, "orders") || can(actor.role, "payments")))
    fail("FORBIDDEN", "Bạn không có quyền xem lịch giao Daily.", 403);
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(raw);
  const days = calendarMonthDays(month);
  const rows = await db.dailyDelivery.findMany({
    where: {
      day: { gte: days[0], lte: days.at(-1)! },
      state: { in: ["SCHEDULED", "ATTENTION", "MATERIALIZED", "FULFILLED"] },
      reservation: "CONFIRMED",
      plan: { state: { in: ["ACTIVE", "PAUSED", "COMPLETED", "CLOSING"] } },
      OR: [
        { orderId: null },
        {
          order: {
            status: { notIn: ["CANCELLED", "REFUND_PENDING", "REFUNDED"] },
          },
        },
      ],
    },
    orderBy: [{ day: "asc" }, { startHour: "asc" }, { id: "asc" }],
    select: {
      id: true,
      day: true,
      slotLabel: true,
      approved: true,
      issue: true,
      state: true,
      selectionSnapshot: true,
      plan: {
        select: {
          id: true,
          code: true,
          recipientName: true,
          recipientPhone: true,
          buyerName: true,
          address: true,
        },
      },
      order: { select: { id: true, code: true, fulfillment: true } },
    },
  });
  const dispatch = ["OWNER", "MANAGER", "DELIVERY"].includes(actor.role);
  return {
    month,
    today: dayKey(),
    rows: rows.map((d) => {
      const s = d.selectionSnapshot as Partial<DailyOfferingView> | null;
      const stage =
        d.state === "FULFILLED" || d.order?.fulfillment === "DELIVERED"
          ? "FULFILLED"
          : d.issue || d.state === "ATTENTION"
            ? "ATTENTION"
            : d.order
              ? d.order.fulfillment
              : !d.approved
                ? "NEEDS_APPROVAL"
                : "SCHEDULED";
      return {
        id: d.id,
        day: d.day,
        slotLabel: d.slotLabel,
        stage,
        issue: d.issue,
        planId: d.plan.id,
        planCode: d.plan.code,
        recipientName: d.plan.recipientName,
        buyerName: d.plan.buyerName,
        ...(dispatch
          ? { recipientPhone: d.plan.recipientPhone, address: d.plan.address }
          : {}),
        flower: {
          name: s?.name ?? "Cửa hàng chọn mẫu",
          size: s?.variantName ?? "",
          image: s?.image ?? "",
        },
        order: d.order ? { id: d.order.id, code: d.order.code } : null,
      };
    }),
    serverNow: new Date().toISOString(),
  };
}
export type DailyCalendarMonth = Awaited<ReturnType<typeof dailyCalendarMonth>>;
