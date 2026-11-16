import { z } from "zod";
import type { Order, Prisma, User } from "@prisma/client";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import { fail } from "./errors";
import { getSettings } from "./settings";
import { dayKey, localInstant, money, shiftDay } from "./time";

export const financialRoles = ["OWNER", "MANAGER", "ACCOUNTANT"];
export function requireCollector(actor: Pick<User, "role">) {
  if (!financialRoles.includes(actor.role))
    fail("FORBIDDEN", "Bạn không có quyền quản lý thu tiền.", 403);
}
const hour = 3600000;
export const receiptSchema = z.object({
  version: z.number().int().positive(),
  reference: z.string().trim().min(4).max(100),
  reason: z.string().trim().min(4).max(300),
  destination: z.enum(["SHOP", "SHIPPER"]).default("SHOP"),
  collectorId: z.string().max(100).optional(),
});

/** Called under the order row lock. Delivery is independent of collecting money. */
export async function openCodReceivableTx(tx: Tx, order: Order) {
  if (
    order.paymentMethod !== "COD" ||
    order.fulfillment !== "DELIVERED" ||
    !["UNPAID", "PENDING"].includes(order.paymentStatus)
  )
    return;
  const settings = await getSettings(tx);
  const delivered = order.deliveredAt!;
  const buyer = order.userId
    ? await tx.user.findUnique({ where: { id: order.userId } })
    : null;
  const dueAt = new Date(
    delivered.getTime() + settings.collectionDueHours * hour,
  );
  await tx.codReceivable.upsert({
    where: { orderId: order.id },
    update: {},
    create: {
      orderId: order.id,
      amount: order.total,
      payerName: order.buyerName,
      payerPhone: buyer?.phone ?? "",
      dueAt,
      nextReminderAt: new Date(
        dueAt.getTime() + settings.collectionFirstReminderHours * hour,
      ),
      events: {
        create: {
          actorId: "system",
          action: "OPENED",
          note: "Đã giao COD, chưa xác nhận thu tiền.",
        },
      },
    },
  });
}

export async function recordCodReceiptTx(
  tx: Tx,
  order: Order,
  input: z.infer<typeof receiptSchema>,
  actor: User,
) {
  if (order.paymentMethod !== "COD") {
    if (input.destination !== "SHOP")
      fail("INVALID_COLLECTION", "Chỉ đơn COD được ghi nhận thu hộ.");
    return;
  }
  let collector: User | null = null;
  if (input.destination === "SHIPPER") {
    if (order.fulfillment !== "DELIVERED")
      fail("NOT_DELIVERED", "Chỉ ghi nhận thu hộ khi đã giao.");
    collector = input.collectorId
      ? await tx.user.findFirst({
          where: {
            id: input.collectorId,
            disabled: false,
            role: { in: ["OWNER", "MANAGER", "DELIVERY"] },
          },
        })
      : null;
    if (!collector)
      fail("INVALID_COLLECTOR", "Chọn nhân viên giao hàng đã thu hộ.");
  }
  const now = new Date();
  await tx.orderReceipt.create({
    data: {
      orderId: order.id,
      amount: order.total,
      destination: input.destination,
      collectorId: collector?.id,
      actorId: actor.id,
      reference: input.reference,
      receivedAt: now,
      remittedAt: collector ? null : now,
    },
  });
  const existing = await tx.codReceivable.findUnique({
    where: { orderId: order.id },
  });
  if (collector) {
    const settings = await getSettings(tx);
    const dueAt = new Date(
      now.getTime() + settings.collectionShipperDueHours * hour,
    );
    const data = {
      kind: "SHIPPER",
      state: "OPEN",
      amount: order.total,
      payerName: collector.name,
      payerPhone: collector.phone,
      dueAt,
      nextReminderAt: new Date(
        dueAt.getTime() + settings.collectionFirstReminderHours * hour,
      ),
      settledAt: null,
      lastContactAt: null,
      note: "",
    };
    await tx.codReceivable.upsert({
      where: { orderId: order.id },
      create: {
        ...data,
        orderId: order.id,
        events: {
          create: {
            actorId: actor.id,
            action: "COLLECTED_BY_SHIPPER",
            note: `${input.reference} · ${input.reason}`,
          },
        },
      },
      update: {
        ...data,
        events: {
          create: {
            actorId: actor.id,
            action: "COLLECTED_BY_SHIPPER",
            note: `${input.reference} · ${input.reason}`,
          },
        },
      },
    });
  } else if (existing) {
    await tx.codReceivable.update({
      where: { id: existing.id },
      data: {
        state: "SETTLED",
        settledAt: now,
        events: {
          create: {
            actorId: actor.id,
            action: "RECEIVED",
            note: `${input.reference} · ${input.reason}`,
          },
        },
      },
    });
  }
}

const followupSchema = z.object({
  version: z.number().int().positive(),
  note: z.string().trim().min(4).max(300),
  ownerId: z.string().max(100).nullable(),
  payerName: z.string().trim().min(1).max(100),
  payerPhone: z.string().trim().max(30),
  nextReminderAt: z.iso.datetime({ offset: true }),
  contacted: z.boolean().default(false),
});
export async function updateCollection(id: string, raw: unknown, actor: User) {
  requireCollector(actor);
  const input = followupSchema.parse(raw);
  const next = new Date(input.nextReminderAt);
  if (next <= new Date())
    fail("INVALID_REMINDER", "Lịch nhắc phải ở tương lai.");
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    if (order.version !== input.version)
      fail("STALE_ORDER_VERSION", "Đơn đã thay đổi, hãy tải lại.", 409);
    const debt = await tx.codReceivable.findUniqueOrThrow({
      where: { orderId: id },
    });
    if (debt.state !== "OPEN")
      fail("COLLECTION_CLOSED", "Khoản phải thu đã được tất toán.");
    if (
      input.ownerId &&
      !(await tx.user.findFirst({
        where: {
          id: input.ownerId,
          disabled: false,
          role: { in: financialRoles },
        },
      }))
    )
      fail("INVALID_ASSIGNEE", "Người phụ trách không có quyền thu tiền.");
    if (
      debt.kind === "SHIPPER" &&
      (input.payerName !== debt.payerName ||
        input.payerPhone !== debt.payerPhone)
    )
      fail("INVALID_PAYER", "Người bàn giao được xác định từ phiếu thu hộ.");
    await tx.codReceivable.update({
      where: { id: debt.id },
      data: {
        ownerId: input.ownerId,
        payerName: input.payerName,
        payerPhone: input.payerPhone,
        nextReminderAt: next,
        note: input.note,
        ...(input.contacted ? { lastContactAt: new Date() } : {}),
        events: {
          create: {
            actorId: actor.id,
            action: "FOLLOWUP",
            note: `${input.note} · nhắc ${next.toISOString()}`,
          },
        },
      },
    });
    await collectionChanged(tx, order, actor, "followup", input);
    return { success: true };
  });
}

export async function remitCollection(id: string, raw: unknown, actor: User) {
  requireCollector(actor);
  const input = receiptSchema.parse(raw);
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    const debt = await tx.codReceivable.findUniqueOrThrow({
      where: { orderId: id },
    });
    if (debt.kind !== "SHIPPER")
      fail("INVALID_COLLECTION", "Khoản này không phải tiền thu hộ.");
    if (debt.state === "SETTLED") return { success: true };
    if (order.version !== input.version)
      fail("STALE_ORDER_VERSION", "Đơn đã thay đổi, hãy tải lại.", 409);
    const receipt = await tx.orderReceipt.findUniqueOrThrow({
      where: { orderId: id },
    });
    if (receipt.remittedAt)
      fail("ALREADY_REMITTED", "Phiếu thu đã được bàn giao.");
    const now = new Date();
    await tx.orderReceipt.update({
      where: { orderId: id },
      data: { remittedAt: now, remittanceReference: input.reference },
    });
    await tx.codReceivable.update({
      where: { id: debt.id },
      data: {
        state: "SETTLED",
        settledAt: now,
        events: {
          create: {
            actorId: actor.id,
            action: "REMITTED",
            note: `${input.reference} · ${input.reason}`,
          },
        },
      },
    });
    await collectionChanged(tx, order, actor, "remitted", input);
    return { success: true };
  });
}
async function collectionChanged(
  tx: Tx,
  order: Order,
  actor: User,
  action: string,
  detail: object,
) {
  await tx.order.update({
    where: { id: order.id },
    data: { version: { increment: 1 } },
  });
  await tx.audit.create({
    data: {
      actorId: actor.id,
      action: `collection.${action}`,
      entityId: order.id,
      detail: detail as Prisma.InputJsonValue,
    },
  });
  // Internal financial changes are never broadcast into the customer's order history.
  const recipients = await tx.user.findMany({
    where: { disabled: false, role: { in: financialRoles } },
    select: { id: true },
  });
  await tx.outbox.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      event: "collection.changed",
      payload: { admin: true, orderId: order.id },
    })),
  });
}

export async function getCollections(actor: User, params: URLSearchParams) {
  requireCollector(actor);
  const now = new Date();
  const todayEnd = localInstant(shiftDay(dayKey(now), 1));
  const base: Prisma.CodReceivableWhereInput = { state: "OPEN" };
  const group = params.get("group") ?? "ALL";
  const where: Prisma.CodReceivableWhereInput = {
    ...base,
    ...(group === "CUSTOMER" || group === "SHIPPER" ? { kind: group } : {}),
    ...(group === "OVERDUE" ? { dueAt: { lt: now } } : {}),
    ...(group === "TODAY" ? { nextReminderAt: { lt: todayEnd } } : {}),
  };
  const q = params.get("q")?.trim().slice(0, 100);
  if (q)
    where.OR = [
      { payerName: { contains: q } },
      { payerPhone: { contains: q } },
      { order: { code: { contains: q } } },
    ];
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(params.get("page")) || 1)),
  );
  const [totals, overdue, today, rows, count, staff, settings] =
    await Promise.all([
      db.codReceivable.groupBy({
        by: ["kind"],
        where: base,
        _sum: { amount: true },
        _count: true,
      }),
      db.codReceivable.aggregate({
        where: { ...base, dueAt: { lt: now } },
        _sum: { amount: true },
        _count: true,
      }),
      db.codReceivable.count({
        where: { ...base, nextReminderAt: { lt: todayEnd } },
      }),
      db.codReceivable.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 12,
        skip: (page - 1) * 12,
        include: {
          owner: { select: { id: true, name: true } },
          events: { orderBy: { createdAt: "desc" }, take: 12 },
          order: {
            select: {
              id: true,
              code: true,
              buyerName: true,
              total: true,
              version: true,
              deliveredAt: true,
              paymentStatus: true,
              status: true,
              receipt: {
                select: { reference: true, receivedAt: true, remittedAt: true },
              },
            },
          },
        },
      }),
      db.codReceivable.count({ where }),
      db.user.findMany({
        where: {
          disabled: false,
          role: { in: [...financialRoles, "DELIVERY"] },
        },
        select: { id: true, name: true, role: true },
      }),
      getSettings(),
    ]);
  return {
    totals: totals.map((t) => ({
      kind: t.kind,
      amount: t._sum.amount ?? 0,
      count: t._count,
    })),
    overdue: { amount: overdue._sum.amount ?? 0, count: overdue._count },
    today,
    rows,
    count,
    page,
    staff,
    priorityHours: settings.collectionPriorityHours,
    now: now.toISOString(),
  };
}
export async function getCollectionDetail(actor: User, orderId: string) {
  requireCollector(actor);
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      code: true,
      paymentStatus: true,
      deliveredAt: true,
      receipt: {
        select: {
          amount: true,
          destination: true,
          reference: true,
          receivedAt: true,
          remittedAt: true,
          remittanceReference: true,
          collector: { select: { name: true } },
        },
      },
      receivable: {
        include: {
          owner: { select: { name: true } },
          events: { orderBy: { createdAt: "desc" }, take: 30 },
        },
      },
    },
  });
}

export async function notifyCollectionOpened(orderId: string) {
  await atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${orderId} FOR UPDATE`;
    const debt = await tx.codReceivable.findUnique({
      where: { orderId },
      include: { order: { select: { code: true } } },
    });
    if (!debt || debt.state !== "OPEN") return;
    const settings = await getSettings(tx);
    const recipients = await tx.user.findMany({
      where: {
        disabled: false,
        role: {
          in: settings.collectionNotifyAccountant
            ? financialRoles
            : ["OWNER", "MANAGER"],
        },
      },
      select: { id: true },
    });
    for (const user of recipients) {
      const result = await tx.notification.createMany({
        skipDuplicates: true,
        data: [
          {
            userId: user.id,
            dedupKey: `staff:payments:collection-open:${debt.id}:${debt.kind}:${user.id}`,
            title: `COD còn phải thu · ${debt.order.code}`,
            body: `${money(debt.amount)} · ${debt.kind === "SHIPPER" ? "Chờ shipper bàn giao" : "Đã giao, chưa xác nhận thu tiền"}`,
            url: "/admin/overview",
          },
        ],
      });
      if (result.count)
        await tx.outbox.create({
          data: {
            userId: user.id,
            event: "notification.created",
            payload: {
              admin: true,
              collection: true,
              push: settings.collectionPushEnabled,
              collectionOrderId: orderId,
            },
          },
        });
    }
  });
}

/** Lock and recheck each debt before creating durable, deduplicated internal reminders. */
export async function remindCollections(now = new Date()) {
  const settings = await getSettings();
  const clock = new Date(now.getTime() + 7 * hour).getUTCHours();
  if (
    !settings.collectionRemindersEnabled ||
    clock < settings.collectionWorkStart ||
    clock >= settings.collectionWorkEnd
  )
    return;
  // Cursor pagination, rather than an arbitrary cap, includes old receivables too.
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.codReceivable.findMany({
      where: { state: "OPEN" },
      select: { id: true, orderId: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const candidate of batch)
      await atomic(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${candidate.orderId} FOR UPDATE`;
        const debt = await tx.codReceivable.findUniqueOrThrow({
          where: { id: candidate.id },
          include: { order: true },
        });
        if (debt.state !== "OPEN") return;
        // Send only the highest applicable severity; a promise postpones all follow-up.
        const overdueHours = (now.getTime() - debt.dueAt.getTime()) / hour;
        const stages =
          debt.nextReminderAt > now
            ? []
            : [
                overdueHours >= settings.collectionEscalationHours
                  ? "escalation"
                  : overdueHours >= settings.collectionPriorityHours
                    ? "priority"
                    : "due",
              ];
        for (const stage of stages) {
          const staff = await tx.user.findMany({
            where: {
              disabled: false,
              role: {
                in:
                  stage === "escalation" || !settings.collectionNotifyAccountant
                    ? ["OWNER", "MANAGER"]
                    : financialRoles,
              },
            },
            select: { id: true },
          });
          for (const user of staff) {
            const created = await tx.notification.createMany({
              skipDuplicates: true,
              data: [
                {
                  userId: user.id,
                  dedupKey: `staff:payments:collection:${debt.id}:${stage}:${dayKey(now)}:${debt.nextReminderAt.getTime()}:${user.id}`,
                  title:
                    stage === "escalation"
                      ? `Công nợ cần quản lý xử lý · ${debt.order.code}`
                      : stage === "priority"
                        ? `Công nợ quá hạn cần ưu tiên · ${debt.order.code}`
                        : `Nhắc thu COD · ${debt.order.code}`,
                  body: `${money(debt.amount)} · ${debt.kind === "SHIPPER" ? "Chờ shipper bàn giao" : "Khách chưa thanh toán"} · ${debt.payerName}`,
                  url: "/admin/overview",
                },
              ],
            });
            if (created.count)
              await tx.outbox.create({
                data: {
                  userId: user.id,
                  event: "notification.created",
                  payload: {
                    admin: true,
                    collection: true,
                    push: settings.collectionPushEnabled,
                    collectionOrderId: debt.orderId,
                    collectionReminderAt: debt.nextReminderAt.toISOString(),
                  },
                },
              });
          }
        }
      });
    if (batch.length < 100) break;
    cursor = batch.at(-1)!.id;
  }
  if (clock >= settings.collectionDigestHour)
    await collectionDigest(
      now,
      settings.collectionPushEnabled,
      settings.collectionNotifyAccountant,
    );
}
async function collectionDigest(now: Date, push: boolean, accountant: boolean) {
  await atomic(async (tx) => {
    const totals = await tx.codReceivable.aggregate({
      where: { state: "OPEN" },
      _sum: { amount: true },
      _count: true,
    });
    if (!totals._count) return;
    const recipients = await tx.user.findMany({
      where: {
        disabled: false,
        role: { in: accountant ? financialRoles : ["OWNER", "MANAGER"] },
      },
      select: { id: true },
    });
    for (const user of recipients) {
      const created = await tx.notification.createMany({
        skipDuplicates: true,
        data: [
          {
            userId: user.id,
            dedupKey: `staff:payments:collection-digest:${dayKey(now)}:${user.id}`,
            title: "COD cần thu hôm nay",
            body: `${totals._count} khoản còn phải thu · ${money(totals._sum.amount ?? 0)}. Mở Tổng quan để theo dõi.`,
            url: "/admin/overview",
          },
        ],
      });
      if (created.count)
        await tx.outbox.create({
          data: {
            userId: user.id,
            event: "notification.created",
            payload: {
              admin: true,
              collection: true,
              push,
              collectionDigestDay: dayKey(now),
            },
          },
        });
    }
  });
}

/** Outbox may run after settlement or a new promise; do not push stale reminders. */
export async function collectionPushCurrent(raw: unknown, now = new Date()) {
  const payload = raw as Record<string, unknown> | null | undefined;
  if (!payload?.collection) return true;
  const settings = await getSettings();
  if (!settings.collectionPushEnabled || payload.push === false) return false;
  if (typeof payload.collectionOrderId === "string") {
    const debt = await db.codReceivable.findUnique({
      where: { orderId: payload.collectionOrderId },
    });
    if (!debt || debt.state !== "OPEN") return false;
    if (typeof payload.collectionReminderAt === "string") {
      const clock = new Date(now.getTime() + 7 * hour).getUTCHours();
      return (
        settings.collectionRemindersEnabled &&
        clock >= settings.collectionWorkStart &&
        clock < settings.collectionWorkEnd &&
        debt.nextReminderAt.toISOString() === payload.collectionReminderAt &&
        debt.nextReminderAt <= now
      );
    }
    return true;
  }
  const clock = new Date(now.getTime() + 7 * hour).getUTCHours();
  return (
    clock >= settings.collectionWorkStart &&
    clock < settings.collectionWorkEnd &&
    payload.collectionDigestDay === dayKey(now) &&
    settings.collectionRemindersEnabled &&
    (await db.codReceivable.count({ where: { state: "OPEN" } })) > 0
  );
}
