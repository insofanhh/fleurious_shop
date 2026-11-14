import { NextRequest } from "next/server";
import { type User, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { can } from "./auth-policy";
import { json, fail, rateLimit } from "./api";
import { atomic } from "./transaction";
import { dayKey } from "./time";
import {
  getMembershipTiers,
  resolveMembership,
  enrollMember,
  quoteMembership,
  getMembershipInvoice,
  confirmMembershipInvoice,
  cancelMembershipInvoice,
  publishMembershipTier,
  grantMembership,
  revokeAdminMembership,
  lockMember,
  activateMembershipInvoice,
  issueBirthdayReward,
} from "./membership";

export async function handleMembershipApi(
  req: NextRequest,
  path: string[],
  user: User | null,
  body: () => Promise<any>,
) {
  const action = path.join("/"),
    method = req.method;
  if (
    path[0] !== "membership" &&
    !(path[0] === "admin" && ["members", "membership"].includes(path[1]))
  )
    return null;
  if (action === "membership/tiers" && method === "GET")
    return json((await getMembershipTiers()).filter((t) => t.active));
  if (!user) fail("UNAUTHORIZED", "Vui lòng đăng nhập.", 401);

  if (action === "membership/me" && method === "GET")
    return json(await memberDetails(user.id));
  if (action === "membership/enroll") return null; // Existing route accepts the same explicit consent.
  if (action === "membership/quote" && method === "POST") {
    await rateLimit(`membership-quote:${user.id}`, 20, 300);
    return json(
      await getMembershipInvoice(await quoteMembership(user.id, await body())),
      201,
    );
  }
  if (action === "membership/birthday" && method === "PATCH") {
    const input = z
      .object({ birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(await body());
    const date = new Date(`${input.birthDate}T12:00:00+07:00`);
    if (
      !Number.isFinite(date.getTime()) ||
      dayKey(date) !== input.birthDate ||
      input.birthDate > dayKey() ||
      input.birthDate < "1900-01-01"
    )
      fail("BIRTH_DATE", "Ngày sinh không hợp lệ.");
    await atomic(async (tx) => {
      const u = await lockMember(tx, user.id);
      if (u.birthDate && u.birthDate !== input.birthDate)
        fail(
          "BIRTH_DATE_LOCKED",
          "Ngày sinh đã lưu. Liên hệ cửa hàng nếu cần sửa để bảo toàn quyền lợi sinh nhật.",
        );
      await tx.user.update({
        where: { id: user.id },
        data: { birthDate: input.birthDate },
      });
      await issueBirthdayReward(tx, user.id);
    });
    return json({ success: true });
  }
  if (path[0] === "membership" && path[1] === "invoices" && path[2]) {
    const invoice = await getMembershipInvoice(path[2]);
    if (invoice.userId !== user.id)
      fail("NOT_FOUND", "Không tìm thấy hóa đơn.", 404);
    if (method === "GET" && path.length === 3) return json(invoice);
    if (method === "POST" && path[3] === "confirm") {
      const input = z.object({ accepted: z.literal(true) }).parse(await body());
      await confirmMembershipInvoice(user.id, invoice.id, input.accepted);
      return json(await getMembershipInvoice(invoice.id));
    }
    if (method === "POST" && path[3] === "cancel") {
      await cancelMembershipInvoice(user.id, invoice.id);
      return json({ success: true });
    }
  }
  if (path[0] !== "admin") fail("NOT_FOUND", "Không có chức năng này.", 404);
  const finance =
    path[2] === "invoices" || path[2] === "refunds" || path[2] === "payments";
  if (!can(user.role, finance ? "payments" : "customers"))
    fail("FORBIDDEN", "Bạn không có quyền quản lý hội viên.", 403);
  if (path.length === 2 && method === "GET")
    return json(await adminMembership(req));
  if (path[2] === "tiers" && ["POST", "PATCH"].includes(method)) {
    const raw = await body();
    return json(
      await publishMembershipTier(
        user,
        raw.tier,
        path[3],
        z.number().int().optional().parse(raw.revision),
      ),
      method === "POST" ? 201 : 200,
    );
  }
  if (path[2] === "tiers" && path[3] && method === "DELETE") {
    const raw = await body(),
      tier = (await getMembershipTiers()).find((t) => t.id === path[3]);
    if (!tier) fail("NOT_FOUND", "Không tìm thấy hạng.", 404);
    return json(
      await publishMembershipTier(
        user,
        { ...tier, active: false, monthlyEnabled: false, yearlyEnabled: false },
        tier.id,
        z.number().int().parse(raw.revision),
      ),
    );
  }
  if (path[2] === "customers" && path[3] && method === "GET")
    return json(await memberDetails(path[3]));
  if (
    path[2] === "customers" &&
    path[3] &&
    path[4] === "grants" &&
    method === "POST"
  )
    return json(await grantMembership(user, path[3], await body()), 201);
  if (path[2] === "grants" && path[3] && method === "DELETE") {
    const input = z
      .object({ reason: z.string().trim().min(4).max(400) })
      .parse(await body());
    await revokeAdminMembership(user, path[3], input.reason);
    return json({ success: true });
  }
  if (path[2] === "invoices" && path[3] && method === "GET")
    return json(await getMembershipInvoice(path[3]));
  if (
    path[2] === "payments" &&
    path[3] &&
    path[4] === "match" &&
    method === "POST"
  ) {
    const input = z
      .object({
        invoiceId: z.string(),
        reason: z.string().min(4).max(400),
        accepted: z.literal(true),
      })
      .parse(await body());
    await atomic(async (tx) => {
      const initial = await tx.membershipInvoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
      });
      await lockMember(tx, initial.userId);
      await tx.$queryRaw`SELECT id FROM Payment WHERE id=${path[3]} FOR UPDATE`;
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: path[3] },
      });
      await tx.$queryRaw`SELECT id FROM MembershipInvoice WHERE id=${input.invoiceId} FOR UPDATE`;
      const invoice = await tx.membershipInvoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
      });
      if (
        payment.state !== "REVIEW" ||
        payment.orderId ||
        payment.amount !== invoice.amount ||
        !invoice.acceptedAt ||
        invoice.status === "PAID" ||
        ["REFUNDED", "PARTIALLY_REFUNDED"].includes(invoice.status)
      )
        fail(
          "PAYMENT_MATCH",
          "Giao dịch hoặc hóa đơn không còn phù hợp để kích hoạt.",
        );
      // Administrative review may reopen a late invoice, but never bypass a changed paid schedule.
      const reopened = {
        ...invoice,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60000),
      };
      if (!(await activateMembershipInvoice(tx, reopened)))
        fail(
          "PLAN_CHANGED",
          "Lịch gói đã thay đổi; không thể cấp tự động. Cần đối soát hoàn tiền hoặc tạo hóa đơn phù hợp.",
        );
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          membershipInvoiceId: invoice.id,
          state: "MATCHED",
          reason: input.reason,
        },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: "membership.payment.reconciled",
          entityId: payment.id,
          detail: input,
        },
      });
    });
    return json({ success: true });
  }
  if (
    path[2] === "invoices" &&
    path[3] &&
    path[4] === "refunds" &&
    method === "POST"
  ) {
    const input = z
      .object({
        amount: z.number().int().positive(),
        reason: z.string().min(4).max(400),
        revokeAccess: z.boolean().default(false),
      })
      .parse(await body());
    const result = await atomic(async (tx) => {
      const lookup = await tx.membershipInvoice.findUniqueOrThrow({
        where: { id: path[3] },
      });
      await lockMember(tx, lookup.userId);
      await tx.$queryRaw`SELECT id FROM MembershipInvoice WHERE id=${lookup.id} FOR UPDATE`;
      const invoice = await tx.membershipInvoice.findUniqueOrThrow({
        where: { id: lookup.id },
        include: { refunds: true },
      });
      if (!["PAID", "PARTIALLY_REFUNDED"].includes(invoice.status))
        fail("NOT_PAID", "Chỉ hoàn phí gói đã nhận tiền.");
      if (
        input.amount + invoice.refunds.reduce((s, r) => s + r.amount, 0) >
        invoice.amount
      )
        fail(
          "REFUND_EXCEEDS_PAYMENT",
          "Tổng hoàn vượt tiền đã thu của hóa đơn.",
        );
      if (input.revokeAccess && !["OWNER", "MANAGER"].includes(user.role))
        fail(
          "FORBIDDEN",
          "Thu hồi quyền lợi khi hoàn phí cần chủ cửa hàng hoặc quản lý.",
          403,
        );
      const entitlement = await tx.membershipEntitlement.findUnique({
        where: { invoiceId: invoice.id },
      });
      if (entitlement && entitlement.prepaidValue === 0 && !input.revokeAccess)
        fail(
          "UPGRADED_INVOICE",
          "Giá trị gói đã được dùng khi nâng hạng. Cần chọn thu hồi quyền liên quan trước khi đề nghị hoàn phí.",
        );
      const refund = await tx.membershipRefund.create({
        data: {
          invoiceId: invoice.id,
          amount: input.amount,
          reason: input.reason,
          revokeAccess: input.revokeAccess,
          actorId: user.id,
        },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: "membership.refund.requested",
          entityId: refund.id,
          detail: input,
        },
      });
      return refund;
    });
    return json(result, 201);
  }
  if (path[2] === "refunds" && path[3] && method === "PATCH") {
    const input = z
      .object({ reference: z.string().trim().min(4).max(100) })
      .parse(await body());
    await atomic(async (tx) => {
      const refund = await tx.membershipRefund.findUniqueOrThrow({
        where: { id: path[3] },
        include: { invoice: true },
      });
      await lockMember(tx, refund.invoice.userId);
      await tx.$queryRaw`SELECT id FROM MembershipInvoice WHERE id=${refund.invoiceId} FOR UPDATE`;
      const fresh = await tx.membershipRefund.findUniqueOrThrow({
        where: { id: refund.id },
      });
      if (fresh.status === "COMPLETED") return;
      if (fresh.revokeAccess && !["OWNER", "MANAGER"].includes(user.role))
        fail("FORBIDDEN", "Bạn không được thu hồi quyền lợi hội viên.", 403);
      await tx.membershipRefund.update({
        where: { id: refund.id },
        data: {
          status: "COMPLETED",
          reference: input.reference,
          completedAt: new Date(),
        },
      });
      const completed = await tx.membershipRefund.aggregate({
        where: { invoiceId: refund.invoiceId, status: "COMPLETED" },
        _sum: { amount: true },
      });
      const full = (completed._sum.amount ?? 0) >= refund.invoice.amount;
      await tx.membershipInvoice.update({
        where: { id: refund.invoiceId },
        data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      const root = await tx.membershipEntitlement.findUnique({
        where: { invoiceId: refund.invoiceId },
      });
      if (root && (full || fresh.revokeAccess)) {
        // Credit converted into an upgrade cannot survive a refund of its funding invoice.
        const queue = [root.id];
        for (let index = 0; index < queue.length; index++) {
          const id = queue[index];
          await tx.membershipEntitlement.update({
            where: { id },
            data: { revokedAt: new Date(), prepaidValue: 0 },
          });
          const descendants = await tx.membershipInvoice.findMany({
            where: { baseEntitlementId: id, activatedAt: { not: null } },
            select: { id: true },
          });
          for (const child of descendants) {
            const e = await tx.membershipEntitlement.findUnique({
              where: { invoiceId: child.id },
            });
            if (e && !queue.includes(e.id)) queue.push(e.id);
          }
        }
      } else if (root) {
        await tx.membershipEntitlement.update({
          where: { id: root.id },
          data: { prepaidValue: Math.max(0, root.prepaidValue - fresh.amount) },
        });
      }
      const summary = await resolveMembership(refund.invoice.userId, tx);
      await tx.user.update({
        where: { id: refund.invoice.userId },
        data: { tier: summary.current?.name ?? "Member" },
      });
      await tx.membershipHistory.create({
        data: {
          userId: refund.invoice.userId,
          action: "fee_refunded",
          actorId: user.id,
          detail: {
            invoiceId: refund.invoiceId,
            amount: fresh.amount,
            full,
            reference: input.reference,
          },
        },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: "membership.refund.completed",
          entityId: refund.id,
          detail: input,
        },
      });
      await tx.outbox.create({
        data: {
          userId: refund.invoice.userId,
          event: "membership.changed",
          payload: { invoiceId: refund.invoiceId },
        },
      });
    });
    return json({ success: true });
  }
  fail("NOT_FOUND", "Không có chức năng này.", 404);
}

async function memberDetails(userId: string) {
  const [summary, history, ids, grants] = await Promise.all([
    resolveMembership(userId),
    db.membershipHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.membershipInvoice.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.membershipEntitlement.findMany({
      where: { userId },
      include: { tierVersion: { include: { tier: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    summary,
    history,
    invoices: await Promise.all(ids.map((i) => getMembershipInvoice(i.id))),
    grants: grants.map((e) => ({
      id: e.id,
      source: e.source,
      tier: e.tierVersion.tier.name,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      revokedAt: e.revokedAt,
      reason: e.reason,
      actorId: e.actorId,
    })),
  };
}

async function adminMembership(req: NextRequest) {
  const search = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100),
    page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const tierFilter = req.nextUrl.searchParams.get("tier") ?? "",
    source = req.nextUrl.searchParams.get("source") ?? "",
    expiry = req.nextUrl.searchParams.get("expiry") ?? "";
  const where: Prisma.UserWhereInput = {
    memberSince: { not: null },
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };
  // Resolve before filtering: cached User.tier cannot correctly filter expired or future grants.
  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      memberSince: true,
      disabled: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = [];
  for (const user of users) {
    const membership = await resolveMembership(user.id);
    const now = new Date();
    if (tierFilter && membership.current?.id !== tierFilter) continue;
    if (
      source &&
      !membership.sources.some(
        (e) =>
          e.source === source &&
          new Date(e.startsAt) <= now &&
          (!e.endsAt || new Date(e.endsAt) > now),
      )
    )
      continue;
    if (
      expiry === "soon" &&
      (!membership.expiresAt ||
        new Date(membership.expiresAt).getTime() - Date.now() > 7 * 86400000)
    )
      continue;
    if (
      expiry === "expired" &&
      !membership.sources.some(
        (e) => e.source === "PAID" && e.endsAt && new Date(e.endsAt) <= now,
      )
    )
      continue;
    rows.push({ ...user, membership });
  }
  const invoiceIds = await db.membershipInvoice.findMany({
    where: {
      status: { not: "DRAFT" },
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { userId: { in: users.map((u) => u.id) } },
            ],
          }
        : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const [tiers, invoices, payments, refunds, paid, completedRefunds] =
    await Promise.all([
      getMembershipTiers(),
      Promise.all(invoiceIds.map((i) => getMembershipInvoice(i.id))),
      db.payment.findMany({
        where: { state: "REVIEW", orderId: null },
        orderBy: { receivedAt: "desc" },
        take: 100,
      }),
      db.membershipRefund.findMany({
        where: { status: "PENDING" },
        include: { invoice: { select: { code: true, userId: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.membershipInvoice.aggregate({
        where: { activatedAt: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
      db.membershipRefund.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);
  return {
    tiers,
    members: rows.slice((page - 1) * 25, page * 25),
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / 25)),
    invoices,
    payments,
    refunds,
    stats: {
      members: users.length,
      paidInvoices: paid._count,
      revenue: (paid._sum.amount ?? 0) - (completedRefunds._sum.amount ?? 0),
      activePaid: await db.membershipEntitlement.count({
        where: {
          source: "PAID",
          revokedAt: null,
          startsAt: { lte: new Date() },
          endsAt: { gt: new Date() },
        },
      }),
    },
  };
}
