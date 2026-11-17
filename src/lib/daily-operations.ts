import { randomBytes } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import { fail } from "./errors";
import { dayKey, localInstant, shiftDay } from "./time";
import { encrypt, hash, token } from "./security";
import { getSettings } from "./settings";
import {
  dailyConfig,
  lockDaily,
  expireDailyTx,
  activateDailyInvoice,
} from "./daily";
import { stopOrderForRefund } from "./commerce";
import { recordMembershipRefund } from "./membership";
import { notifyStaff } from "./notifications";
import type { DailyOfferingView, DailyPolicy } from "./daily-types";
import type { ShippingSnapshot } from "./shipping-types";
type Actor = Pick<User, "id" | "role">;
const asJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
async function event(
  tx: Tx,
  plan: { id: string; userId: string },
  name: string,
  body: string,
) {
  await tx.outbox.create({
    data: { userId: plan.userId, event: name, payload: { planId: plan.id } },
  });
  await tx.notification.create({
    data: {
      userId: plan.userId,
      title: "Fleurious Daily",
      body,
      url: `/account/daily/${plan.id}`,
    },
  });
}
export async function refreshDailyPlanTx(tx: Tx, id: string) {
  const p = await tx.dailyPlan.findUniqueOrThrow({ where: { id } });
  if (["PENDING_PAYMENT", "EXPIRED", "CANCELLED"].includes(p.state)) return;
  const ds = await tx.dailyDelivery.findMany({ where: { planId: id } });
  const pending = ds.some((d) => d.state === "REFUND_PENDING"),
    live = ds.some((d) =>
      ["SCHEDULED", "ATTENTION", "MATERIALIZED"].includes(d.state),
    ),
    paused = ds.some((d) => d.state === "UNSCHEDULED");
  const state = live
    ? "ACTIVE"
    : paused
      ? "PAUSED"
      : pending
        ? "CLOSING"
        : ds.some((d) => d.state === "FULFILLED")
          ? "COMPLETED"
          : "CANCELLED";
  if (state !== p.state)
    await tx.dailyPlan.update({
      where: { id },
      data: { state, version: { increment: 1 } },
    });
}
export async function dailyOrderDeliveredTx(tx: Tx, orderId: string) {
  const d = await tx.dailyDelivery.findUnique({ where: { orderId } });
  if (!d) return;
  await tx.dailyDelivery.update({
    where: { id: d.id },
    data: { state: "FULFILLED", issue: "", version: { increment: 1 } },
  });
  await refreshDailyPlanTx(tx, d.planId);
}
export async function cancelUnpaidDaily(actor: Actor, id: string) {
  return atomic(async (tx) => {
    await lockDaily(tx);
    const p = await tx.dailyPlan.findUniqueOrThrow({
      where: { id },
      include: { deliveries: true },
    });
    if (p.userId !== actor.id && !["OWNER", "MANAGER"].includes(actor.role))
      fail("NOT_FOUND", "Không tìm thấy lịch hoa.", 404);
    if (!["PENDING_PAYMENT", "EXPIRED"].includes(p.state))
      fail(
        "DAILY_PAID",
        "Gói đã trả tiền cần yêu cầu hoàn các lượt chưa thực hiện.",
      );
    for (const d of p.deliveries)
      if (d.reservation === "HELD") {
        await tx.slotBooking.updateMany({
          where: { day: d.day, slotId: d.slotId, count: { gt: 0 } },
          data: { count: { decrement: 1 } },
        });
        await tx.dailyDelivery.update({
          where: { id: d.id },
          data: { reservation: "RELEASED", state: "CANCELLED" },
        });
      }
    await tx.dailyDelivery.updateMany({
      where: { planId: id, orderId: null, reservation: "RELEASED" },
      data: { state: "CANCELLED" },
    });
    await tx.dailyInvoice.updateMany({
      where: { planId: id, state: { in: ["PENDING", "EXPIRED"] } },
      data: { state: "CANCELLED" },
    });
    return tx.dailyPlan.update({
      where: { id },
      data: { state: "CANCELLED", version: { increment: 1 } },
    });
  });
}
export async function requestDailyRefund(
  actor: Actor,
  id: string,
  raw: unknown,
  admin = false,
) {
  const input = z
    .object({
      version: z.number().int().positive(),
      deliveryIds: z.array(z.string()).min(1).max(31),
      reason: z.string().trim().min(4).max(500),
    })
    .parse(raw);
  if (new Set(input.deliveryIds).size !== input.deliveryIds.length)
    fail("DAILY_REFUND", "Lượt giao không được trùng.");
  if (admin && !["OWNER", "MANAGER"].includes(actor.role))
    fail(
      "FORBIDDEN",
      "Chỉ quản lý được duyệt hoàn sau hạn hoặc đơn đã chuẩn bị.",
      403,
    );
  return atomic(async (tx) => {
    await lockDaily(tx);
    const p = await tx.dailyPlan.findUniqueOrThrow({ where: { id } });
    if (!admin && p.userId !== actor.id)
      fail("NOT_FOUND", "Không tìm thấy lịch hoa.", 404);
    if (p.version !== input.version)
      fail(
        "STALE_VERSION",
        "Gói vừa thay đổi. Tải lại trước khi yêu cầu hoàn.",
        409,
      );
    if (
      !(await tx.dailyInvoice.count({
        where: { planId: id, kind: "PURCHASE", state: "PAID" },
      }))
    )
      fail("NOT_PAID", "Gói chưa có thanh toán được ghi nhận.");
    const ds = await tx.dailyDelivery.findMany({
      where: { id: { in: input.deliveryIds }, planId: id },
      orderBy: { id: "asc" },
    });
    if (ds.length !== input.deliveryIds.length)
      fail("NOT_FOUND", "Lượt giao không thuộc gói.", 404);
    const allocation = [];
    for (const d of ds) {
      if (
        ["REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(d.state) ||
        d.refundPending ||
        d.refunded
      )
        fail(
          "DAILY_REFUND",
          "Một lượt đã hoặc đang được hoàn. Tải lại lịch.",
          409,
        );
      if (
        !admin &&
        (d.lockAt <= new Date() || d.orderId || d.state === "FULFILLED")
      )
        fail(
          "DAILY_LOCKED",
          "Lượt đã khóa/đang chuẩn bị cần cửa hàng xác nhận trước khi hoàn.",
        );
      let orderRefundId: string | undefined;
      if (d.orderId) {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${d.orderId} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({
          where: { id: d.orderId },
        });
        if (
          order.dailyPlanId !== id ||
          !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus)
        )
          fail("DAILY_FUNDING", "Nguồn tiền đơn giao không còn hợp lệ.");
        await stopOrderForRefund(
          tx,
          d.orderId,
          `Hoàn lượt Daily: ${input.reason}`,
        );
        const r = await tx.refund.findFirstOrThrow({
          where: { orderId: d.orderId, status: "PENDING" },
        });
        orderRefundId = r.id;
        if (r.amount !== d.total)
          fail("DAILY_FUNDING", "Phân bổ hoàn của đơn con cần được đối soát.");
        if (order.fulfillment !== "DELIVERED")
          await tx.dailyDelivery.update({
            where: { id: d.id },
            data: { reservation: "RELEASED" },
          });
      } else if (d.reservation === "CONFIRMED") {
        await tx.slotBooking.updateMany({
          where: { day: d.day, slotId: d.slotId, count: { gt: 0 } },
          data: { count: { decrement: 1 } },
        });
        await tx.dailyDelivery.update({
          where: { id: d.id },
          data: { reservation: "RELEASED" },
        });
      }
      await tx.dailyDelivery.update({
        where: { id: d.id },
        data: {
          refundPending: d.total,
          state: "REFUND_PENDING",
          version: { increment: 1 },
          issue: "",
        },
      });
      allocation.push({ deliveryId: d.id, amount: d.total, orderRefundId });
    }
    const amount = ds.reduce((n, d) => n + d.total, 0);
    const paid = await tx.dailyInvoice.aggregate({
      where: { planId: id, state: "PAID" },
      _sum: { amount: true },
    });
    const refunds = await tx.dailyRefund.findMany({
      where: { planId: id },
      select: { amount: true, allocation: true },
    });
    const refundedAllocations = refunds
      .filter(
        (r) => (r.allocation as { kind?: string }[])[0]?.kind !== "TRANSFER",
      )
      .reduce((n, r) => n + r.amount, 0);
    if (amount + refundedAllocations > (paid._sum.amount ?? 0))
      fail(
        "REFUND_EXCEEDS_PAYMENT",
        "Yêu cầu hoàn vượt tổng tiền gói đã nhận.",
      );
    const refund = await tx.dailyRefund.create({
      data: {
        planId: id,
        amount,
        allocation: asJson(allocation),
        reason: input.reason,
        actorId: actor.id,
      },
    });
    await tx.dailyPlan.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await tx.dailyHistory.create({
      data: {
        planId: id,
        actorId: actor.id,
        action: "refund_requested",
        detail: { refundId: refund.id, amount },
      },
    });
    await refreshDailyPlanTx(tx, id);
    await event(
      tx,
      p,
      "daily.refund_changed",
      "Đã tiếp nhận yêu cầu hoàn tiền các lượt được chọn. Cửa hàng sẽ xác nhận khi tiền đã được hoàn.",
    );
    return refund;
  });
}
export async function completeDailyRefund(
  actor: Actor,
  id: string,
  reference: string,
) {
  if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền xác nhận hoàn tiền.", 403);
  const ref = z.string().trim().min(4).max(100).parse(reference);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const r = await tx.dailyRefund.findUniqueOrThrow({ where: { id } });
    if (r.state === "COMPLETED") return r;
    const p = await tx.dailyPlan.findUniqueOrThrow({ where: { id: r.planId } });
    const alloc = r.allocation as {
      deliveryId?: string;
      amount: number;
      orderRefundId?: string;
      paymentId?: string;
      kind?: string;
    }[];
    for (const a of alloc) {
      if (a.kind === "TRANSFER" && a.paymentId) {
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: a.paymentId },
        });
        if (payment.state !== "REFUND_PENDING" || payment.amount !== a.amount)
          fail(
            "DAILY_FUNDING",
            "Giao dịch chuyển khoản không còn khớp khoản hoàn.",
          );
        await tx.payment.update({
          where: { id: a.paymentId },
          data: {
            state: "REFUNDED",
            reason: `Đã hoàn giao dịch cần đối soát · ${ref}`,
          },
        });
        continue;
      }
      const d = await tx.dailyDelivery.findUniqueOrThrow({
        where: { id: a.deliveryId },
      });
      if (d.refundPending !== a.amount || d.refunded + a.amount > d.total)
        fail("DAILY_FUNDING", "Khoản hoàn không khớp phân bổ.");
      if (a.orderRefundId) {
        const rr = await tx.refund.findUniqueOrThrow({
          where: { id: a.orderRefundId },
        });
        if (rr.status !== "PENDING")
          fail(
            "DAILY_FUNDING",
            "Đơn con đã được hoàn ở luồng khác, cần đối soát.",
          );
        await tx.refund.update({
          where: { id: rr.id },
          data: { status: "COMPLETED", reference: ref },
        });
        await tx.order.update({
          where: { id: rr.orderId },
          data: {
            status: "REFUNDED",
            paymentStatus: "REFUNDED",
            version: { increment: 1 },
            history: { create: { text: `Đã hoàn từ gói Daily · ${ref}` } },
          },
        });
        await recordMembershipRefund(tx, rr.id);
      }
      await tx.dailyDelivery.update({
        where: { id: d.id },
        data: {
          refundPending: 0,
          refunded: { increment: a.amount },
          state: "REFUNDED",
          version: { increment: 1 },
        },
      });
    }
    const completed = await tx.dailyRefund.update({
      where: { id },
      data: { state: "COMPLETED", reference: ref, completedAt: new Date() },
    });
    await tx.dailyPlan.update({
      where: { id: p.id },
      data: { version: { increment: 1 } },
    });
    await refreshDailyPlanTx(tx, p.id);
    await tx.dailyHistory.create({
      data: {
        planId: p.id,
        actorId: actor.id,
        action: "refund_completed",
        detail: { refundId: id, reference: ref, amount: r.amount },
      },
    });
    await event(
      tx,
      p,
      "daily.refund_changed",
      "Cửa hàng đã xác nhận hoàn tiền. Bạn có thể xem tham chiếu trong lịch hoa.",
    );
    return completed;
  });
}
export async function refundDailyTransfer(
  actor: Actor,
  planId: string,
  paymentId: string,
  reason: string,
) {
  if (!["OWNER", "MANAGER"].includes(actor.role))
    fail(
      "FORBIDDEN",
      "Chỉ quản lý được đề nghị hoàn giao dịch chưa phân bổ.",
      403,
    );
  const note = z.string().trim().min(4).max(500).parse(reason);
  return atomic(async (tx) => {
    await lockDaily(tx);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const invoice = payment.dailyInvoiceId
      ? await tx.dailyInvoice.findUnique({
          where: { id: payment.dailyInvoiceId },
        })
      : null;
    if (!invoice || invoice.planId !== planId)
      fail("NOT_FOUND", "Giao dịch không thuộc gói.", 404);
    if (payment.state !== "REVIEW")
      fail(
        "DAILY_FUNDING",
        "Giao dịch đã khớp, đang hoàn hoặc đã hoàn; không thể hoàn lại.",
      );
    const p = await tx.dailyPlan.findUniqueOrThrow({
      where: { id: planId },
      include: { deliveries: true },
    });
    if (
      invoice.kind === "PURCHASE" &&
      ["PENDING_PAYMENT", "EXPIRED"].includes(p.state)
    ) {
      for (const d of p.deliveries)
        if (d.reservation === "HELD") {
          await tx.slotBooking.updateMany({
            where: { day: d.day, slotId: d.slotId, count: { gt: 0 } },
            data: { count: { decrement: 1 } },
          });
          await tx.dailyDelivery.update({
            where: { id: d.id },
            data: { reservation: "RELEASED", state: "CANCELLED" },
          });
        }
      await tx.dailyPlan.update({
        where: { id: planId },
        data: { state: "CANCELLED", version: { increment: 1 } },
      });
      await tx.dailyDelivery.updateMany({
        where: { planId, orderId: null, reservation: "RELEASED" },
        data: { state: "CANCELLED" },
      });
    }
    if (invoice.state !== "PAID")
      await tx.dailyInvoice.update({
        where: { id: invoice.id },
        data: { state: "CANCELLED" },
      });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        state: "REFUND_PENDING",
        reason: `Chờ hoàn giao dịch chưa phân bổ: ${note}`,
      },
    });
    const refund = await tx.dailyRefund.create({
      data: {
        planId,
        amount: payment.amount,
        reason: note,
        actorId: actor.id,
        allocation: [
          { kind: "TRANSFER", paymentId: payment.id, amount: payment.amount },
        ],
      },
    });
    await tx.dailyHistory.create({
      data: {
        planId,
        actorId: actor.id,
        action: "refund_requested",
        detail: {
          refundId: refund.id,
          unallocated: true,
          amount: payment.amount,
        },
      },
    });
    await event(
      tx,
      p,
      "daily.refund_changed",
      "Cửa hàng đã tiếp nhận hoàn khoản chuyển cần đối soát. Sẽ có xác nhận khi chuyển tiền hoàn tất.",
    );
    return refund;
  });
}
export async function materializeDailyDelivery(id: string, now = new Date()) {
  return atomic(async (tx) => {
    await lockDaily(tx);
    const d = await tx.dailyDelivery.findUniqueOrThrow({
        where: { id },
        include: { plan: true },
      }),
      p = d.plan;
    if (d.orderId)
      return tx.order.findUniqueOrThrow({ where: { id: d.orderId } });
    if (
      p.state !== "ACTIVE" ||
      d.reservation !== "CONFIRMED" ||
      !["SCHEDULED", "ATTENTION"].includes(d.state) ||
      d.lockAt > now
    )
      return null;
    let issue = "";
    const settings = await getSettings(tx);
    const currentPolicy = (await dailyConfig(tx)).policy;
    const currentSlot = await tx.deliverySlot.findUnique({
      where: { id: d.slotId },
    });
    const o = d.offeringId
      ? await tx.dailyOffering.findUnique({ where: { id: d.offeringId } })
      : null;
    const selected = d.selectionSnapshot as DailyOfferingView | null;
    const v = selected
      ? await tx.productVariant.findUnique({
          where: { id: selected.variantId },
          include: { product: true },
        })
      : null;
    if (
      settings.blackoutDates.includes(d.day) ||
      currentPolicy.blackoutDates.includes(d.day) ||
      !currentSlot?.active
    )
      issue =
        "Ngày hoặc khung giao tạm ngừng phục vụ; cần thống nhất lịch bù hoặc hoàn lượt.";
    else if (localInstant(d.day, d.startHour) <= now)
      issue = "Đã quá giờ giao; cần liên hệ khách để xếp lại hoặc hoàn lượt.";
    else if (!d.approved)
      issue = "Cần nhân viên duyệt mẫu hoa trước khi chuẩn bị.";
    else if (!v?.product.active || !o?.active)
      issue = "Mẫu/size đã ngừng cung cấp; cần chọn thay thế với khách.";
    else if (v.stock - v.reserved < 1)
      issue =
        "Thiếu tồn kho để chuẩn bị; cần bổ sung hoặc thống nhất mẫu thay thế.";
    const funded = await tx.dailyInvoice.count({
      where: { planId: p.id, kind: "PURCHASE", state: "PAID" },
    });
    if (!funded || d.refunded || d.refundPending)
      issue = "Nguồn tiền lượt giao cần được đối soát.";
    if (issue) {
      if (d.issue !== issue) {
        await tx.dailyDelivery.update({
          where: { id },
          data: { state: "ATTENTION", issue, version: { increment: 1 } },
        });
        await event(
          tx,
          p,
          "daily.action_required",
          "Một lượt hoa cần cửa hàng hỗ trợ. Lịch đã được giữ để xử lý.",
        );
      }
      return null;
    }
    if (
      !(await tx.$executeRaw`UPDATE ProductVariant SET reserved=reserved+1 WHERE id=${v!.id} AND stock-reserved>=1`)
    )
      fail("OUT_OF_STOCK", "Hoa vừa hết trong lúc chuẩn bị.", 409);
    const rawToken = token(),
      orderId = `ord_${randomBytes(12).toString("hex")}`;
    const snapshot = p.shippingSnapshot as unknown as ShippingSnapshot;
    const order = await tx.order.create({
      data: {
        id: orderId,
        code: `FLR${randomBytes(6).toString("hex").toUpperCase()}`,
        idempotencyKey: `daily:${d.id}`,
        userId: p.userId,
        source: "DAILY_PLAN",
        dailyPlanId: p.id,
        buyerName: p.buyerName,
        buyerEmail: p.buyerEmail,
        recipientName: p.recipientName,
        recipientPhone: p.recipientPhone,
        address: p.address,
        shippingMethod: "DISTANCE",
        shippingSnapshot: asJson({
          ...snapshot,
          fee: d.shippingGross - d.subsidy,
          daily: {
            planCode: p.code,
            shippingGross: d.shippingGross,
            subsidy: d.subsidy,
          },
        }),
        deliveryDay: d.day,
        slotId: d.slotId,
        slotLabel: d.slotLabel,
        deliveryStart: localInstant(d.day, d.startHour),
        deliveryEnd: localInstant(d.day, d.endHour),
        cardMessage: d.message,
        cardWritingMode: d.writingMode,
        note: `Fleurious Daily · ${p.code} · Thương gửi từ ${p.senderName}`,
        status: "CONFIRMED",
        fulfillment: "UNASSIGNED",
        paymentStatus: "PAID",
        paymentMethod: "PREPAID_PLAN",
        paidAt: new Date(),
        subtotal: d.base + d.premium,
        discount: d.discount,
        deliveryFee: d.shippingGross - d.subsidy,
        total: d.total,
        discountLabel: "Giá gói Fleurious Daily",
        expiresAt: localInstant(d.day, d.endHour),
        items: {
          create: {
            variantId: v!.id,
            name: v!.product.name,
            variantName: v!.name,
            image: v!.product.image,
            quantity: 1,
            price: d.base + d.premium,
            discount: d.discount,
          },
        },
        qr: {
          create: {
            tokenHash: hash(rawToken),
            tokenEncrypted: encrypt(rawToken),
            maxClaims: settings.qrMaxClaims,
          },
        },
        history: {
          create: {
            text: `Đã tài trợ từ ${p.code} · Chờ chuẩn bị · Không thu thêm tiền giao`,
          },
        },
      },
    });
    await tx.dailyDelivery.update({
      where: { id },
      data: {
        orderId,
        state: "MATERIALIZED",
        issue: "",
        version: { increment: 1 },
      },
    });
    await tx.dailyPlan.update({
      where: { id: p.id },
      data: { version: { increment: 1 } },
    });
    await tx.outbox.create({
      data: {
        userId: p.userId,
        event: "order.created",
        payload: { orderId, version: 1 },
      },
    });
    await event(
      tx,
      p,
      "daily.delivery_changed",
      `Hoa ngày ${d.day} đã vào hàng chờ chuẩn bị.`,
    );
    return order;
  });
}
export async function dailyMaintenance(now = new Date()) {
  for (let batch = 0; batch < 5; batch++) {
    const count = await atomic(async (tx) => {
      await lockDaily(tx);
      return expireDailyTx(tx, now);
    });
    if (!count) break;
  }
  const due = await db.dailyDelivery.findMany({
    where: {
      state: { in: ["SCHEDULED", "ATTENTION"] },
      lockAt: { lte: now },
      plan: { state: "ACTIVE" },
    },
    orderBy: { lockAt: "asc" },
    take: 30,
    select: { id: true },
  });
  for (const d of due) await materializeDailyDelivery(d.id, now);
  const pending = await db.dailyDelivery.findMany({
    where: {
      plan: { state: { in: ["ACTIVE", "PAUSED"] } },
      OR: [
        {
          approved: false,
          day: { lte: shiftDay(dayKey(now), 2) },
          state: { in: ["SCHEDULED", "ATTENTION"] },
        },
        { state: "ATTENTION" },
        { state: "UNSCHEDULED" },
      ],
    },
    take: 100,
  });
  for (const d of pending)
    await notifyStaff(
      `daily:${d.id}:${d.version}`,
      "orders",
      "Daily cần xử lý",
      d.issue || `Lượt ${d.day} cần duyệt mẫu hoặc xếp lại lịch.`,
      `/admin/daily?plan=${d.planId}`,
    );
  const reminders = await db.dailyDelivery.findMany({
    where: {
      state: "SCHEDULED",
      lockAt: { gt: now, lte: new Date(now.getTime() + 12 * 3600000) },
      plan: { state: "ACTIVE" },
    },
    include: { plan: true },
    take: 100,
  });
  for (const d of reminders) {
    const dedupKey = `daily:message:${d.id}:${d.day}`;
    const created = await db.notification.createMany({
      data: [
        {
          dedupKey,
          userId: d.plan.userId,
          title: "Một lời thương cho ngày mai",
          body: `Bạn có thể xem lại lời nhắn và lịch hoa ngày ${d.day} trước hạn chốt.`,
          url: `/account/daily/${d.planId}`,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count)
      await db.outbox.create({
        data: {
          userId: d.plan.userId,
          event: "daily.message_reminder",
          payload: { planId: d.planId },
        },
      });
  }
  return due.length;
}
