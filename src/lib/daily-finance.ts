import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { atomic } from "./transaction";
import { fail } from "./errors";
import {
  dailyConfig,
  lockDaily,
  activateDailyInvoice,
  dailyCommittedSubsidy,
} from "./daily";
import { getSettings } from "./settings";
import { validateDailyDates } from "./daily-pricing";
import { lockSepayConfig } from "./sepay-settings";
import { hash } from "./security";

export async function confirmDailyPayment(
  actor: Pick<User, "id" | "role">,
  planId: string,
  invoiceId: string,
  raw: unknown,
) {
  if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền xác nhận thanh toán.", 403);
  const input = z
    .object({
      version: z.number().int().positive(),
      reference: z.string().trim().min(4).max(100),
      reason: z.string().trim().min(4).max(300),
    })
    .strict()
    .parse(raw);
  return atomic(async (tx) => {
    const bank = await lockSepayConfig(tx);
    await lockDaily(tx);
    const invoice = await tx.dailyInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice || invoice.planId !== planId)
      fail("NOT_FOUND", "Không tìm thấy hóa đơn của gói.", 404);
    if (invoice.state === "PAID") return { success: true, alreadyPaid: true };
    const plan = await tx.dailyPlan.findUniqueOrThrow({
      where: { id: planId },
    });
    if (plan.version !== input.version)
      fail(
        "STALE_VERSION",
        "Lịch hoa vừa thay đổi. Tải lại trước khi xác nhận tiền.",
        409,
      );
    const now = new Date();
    if (
      invoice.expiresAt <= now ||
      (invoice.kind === "PURCHASE" && plan.expiresAt <= now)
    )
      fail(
        "DAILY_PAYMENT_EXPIRED",
        "Hóa đơn đã hết hạn. Đối soát giao dịch đã nhận hoặc tạo lịch mới.",
        409,
      );
    if (invoice.state !== "PENDING")
      fail(
        "DAILY_PAYMENT_STATE",
        "Hóa đơn không còn chờ thanh toán. Kiểm tra mục đối soát nếu đã có giao dịch.",
        409,
      );
    if (!bank.accountNumber)
      fail(
        "PAYMENT_NOT_CONFIGURED",
        "Chưa có tài khoản ngân hàng để đối chiếu thanh toán.",
      );
    const identityHash = hash(
      `${bank.accountNumber}:${input.reference.toUpperCase()}`,
    );
    const existing =
      (await tx.payment.findUnique({ where: { identityHash } })) ??
      (await tx.payment.findFirst({
        where: { dailyInvoiceId: invoice.id, reference: input.reference },
      }));
    if (
      existing &&
      (existing.dailyInvoiceId !== invoice.id ||
        existing.amount !== invoice.amount ||
        existing.state !== "REVIEW")
    )
      fail(
        "DAILY_PAYMENT_REFERENCE",
        "Mã giao dịch đã được sử dụng hoặc không khớp số tiền hóa đơn. Kiểm tra đối soát trước khi xác nhận.",
        409,
      );
    if (
      !(await activateDailyInvoice(tx, invoice.id, now, {
        actorId: actor.id,
        reference: input.reference,
      }))
    )
      fail(
        "DAILY_PAYMENT_STATE",
        "Lịch hoặc yêu cầu đổi mẫu không còn đủ điều kiện xác nhận. Tải lại để kiểm tra.",
        409,
      );
    const payment = existing
      ? await tx.payment.update({
          where: { id: existing.id },
          data: {
            state: "MATCHED",
            identityHash,
            reason: `Xác nhận thủ công: ${input.reason}`,
          },
        })
      : await tx.payment.create({
          data: {
            providerId: `manual-daily:${invoice.id}`,
            identityHash,
            reference: input.reference,
            dailyInvoiceId: invoice.id,
            amount: invoice.amount,
            state: "MATCHED",
            reason: `Xác nhận thủ công: ${input.reason}`,
          },
        });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "daily.payment_confirmed",
        entityId: invoice.id,
        detail: {
          ...input,
          planId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          amount: invoice.amount,
          method: "MANUAL",
        },
      },
    });
    return { success: true, alreadyPaid: false };
  });
}
export async function dailyFinancialSummary() {
  const [
    paid,
    refunded,
    pendingRefund,
    delivered,
    remaining,
    attention,
    unallocated,
  ] = await Promise.all([
    db.payment.aggregate({
      where: { dailyInvoiceId: { not: null } },
      _sum: { amount: true },
    }),
    db.dailyRefund.aggregate({
      where: { state: "COMPLETED" },
      _sum: { amount: true },
    }),
    db.dailyRefund.aggregate({
      where: { state: "PENDING" },
      _sum: { amount: true },
    }),
    db.dailyDelivery.aggregate({
      where: { state: "FULFILLED" },
      _sum: { total: true, refunded: true },
    }),
    db.dailyDelivery.aggregate({
      where: {
        state: {
          in: ["SCHEDULED", "ATTENTION", "MATERIALIZED", "UNSCHEDULED"],
        },
        plan: { state: { in: ["ACTIVE", "PAUSED"] } },
      },
      _sum: { total: true },
    }),
    db.dailyDelivery.count({
      where: {
        state: { in: ["ATTENTION", "UNSCHEDULED"] },
        plan: { state: { in: ["ACTIVE", "PAUSED"] } },
      },
    }),
    db.payment.aggregate({
      where: {
        dailyInvoiceId: { not: null },
        state: { in: ["REVIEW", "REFUND_PENDING"] },
      },
      _sum: { amount: true },
    }),
  ]);
  return {
    cashReceived: paid._sum.amount ?? 0,
    cashRefunded: refunded._sum.amount ?? 0,
    pendingRefund: pendingRefund._sum.amount ?? 0,
    deliveredValue:
      (delivered._sum.total ?? 0) - (delivered._sum.refunded ?? 0),
    remainingValue: remaining._sum.total ?? 0,
    attention,
    unallocated: unallocated._sum.amount ?? 0,
  };
}
export async function reconcileDailyPayment(
  actor: Pick<User, "id" | "role">,
  planId: string,
  raw: unknown,
) {
  if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền đối soát thanh toán.", 403);
  const input = z
    .object({
      paymentId: z.string(),
      reference: z.string().trim().min(4).max(100),
      reason: z.string().trim().min(4).max(300),
    })
    .parse(raw);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: input.paymentId },
    });
    if (!payment.dailyInvoiceId)
      fail("DAILY_PAYMENT", "Giao dịch không thuộc hóa đơn Daily.");
    const invoice = await tx.dailyInvoice.findUniqueOrThrow({
      where: { id: payment.dailyInvoiceId },
    });
    if (invoice.planId !== planId)
      fail("NOT_FOUND", "Không tìm thấy giao dịch của gói.", 404);
    if (payment.state === "MATCHED") return { success: true };
    if (
      invoice.state === "PAID" ||
      payment.amount !== invoice.amount ||
      payment.reference !== input.reference
    )
      fail(
        "DAILY_PAYMENT",
        "Cần đúng số tiền và mã tham chiếu giao dịch ngân hàng đã nhận; không cộng dồn giao dịch thiếu tiền.",
      );
    if (invoice.kind === "PURCHASE") {
      const p = await tx.dailyPlan.findUniqueOrThrow({
        where: { id: planId },
        include: { deliveries: { orderBy: { day: "asc" } } },
      });
      if (!["PENDING_PAYMENT", "EXPIRED"].includes(p.state))
        fail(
          "DAILY_STATE",
          "Lịch đã đóng hoặc đã kích hoạt; xử lý khoản tiền thừa riêng.",
        );
      const [{ policy }, settings] = await Promise.all([
        dailyConfig(tx),
        getSettings(tx),
      ]);
      validateDailyDates(
        p.deliveries.map((d) => ({ day: d.day, startHour: d.startHour })),
        policy,
        settings.blackoutDates,
      );
      const freed = p.deliveries
        .filter((d) => d.reservation === "RELEASED")
        .reduce((n, d) => n + d.subsidy, 0);
      if ((await dailyCommittedSubsidy(tx)) + freed > policy.campaignBudget)
        fail(
          "DAILY_SHIP_BUDGET",
          "Cần bổ sung ngân sách ship trước khi nhận lại lịch hết hạn.",
          409,
        );
      for (const d of p.deliveries) {
        if (d.orderId) fail("DAILY_STATE", "Lượt giao đã sinh đơn.");
        if (d.reservation === "RELEASED") {
          const slot = await tx.deliverySlot.findUniqueOrThrow({
            where: { id: d.slotId },
          });
          const used = await tx.dailyDelivery.count({
            where: { day: d.day, reservation: { in: ["HELD", "CONFIRMED"] } },
          });
          if (!slot.active || used >= policy.capacityPerDay)
            fail(
              "DAILY_CAPACITY",
              "Ngày giao đã đủ lịch hoặc ngừng phục vụ.",
              409,
            );
          const offering = d.offeringId
            ? await tx.dailyOffering.findUnique({ where: { id: d.offeringId } })
            : null;
          if (
            !offering?.active ||
            (await tx.dailyDelivery.count({
              where: {
                day: d.day,
                offeringId: d.offeringId,
                reservation: { in: ["HELD", "CONFIRMED"] },
              },
            })) >= offering.capacity
          )
            fail(
              "DAILY_SUPPLY",
              "Mẫu hoa không còn đủ công suất ngày giao.",
              409,
            );
          await tx.slotBooking.upsert({
            where: { day_slotId: { day: d.day, slotId: d.slotId } },
            create: { day: d.day, slotId: d.slotId },
            update: {},
          });
          if (
            !(await tx.$executeRaw`UPDATE SlotBooking SET count=count+1 WHERE day=${d.day} AND slotId=${d.slotId} AND count<${slot.capacity}`)
          )
            fail(
              "DELIVERY_SLOT_FULL",
              "Khung giao đã đầy. Không kích hoạt giao dịch muộn.",
              409,
            );
          await tx.dailyDelivery.update({
            where: { id: d.id },
            data: { reservation: "HELD" },
          });
        }
      }
      await tx.dailyPlan.update({
        where: { id: planId },
        data: {
          state: "PENDING_PAYMENT",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    }
    await tx.dailyInvoice.update({
      where: { id: invoice.id },
      data: { state: "PENDING", expiresAt: new Date(Date.now() + 60000) },
    });
    if (!(await activateDailyInvoice(tx, invoice.id)))
      fail(
        "DAILY_REVIEW",
        "Lịch hoặc yêu cầu thay đổi không còn phù hợp. Hoàn khoản tiền hoặc thống nhất lịch khác.",
      );
    await tx.payment.update({
      where: { id: payment.id },
      data: { state: "MATCHED", reason: `Đối soát: ${input.reason}` },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "daily.payment_reconciled",
        entityId: payment.id,
        detail: input,
      },
    });
    return { success: true };
  });
}
