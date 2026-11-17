import {
  shippingPublic,
  shippingAdminView,
  saveShippingPolicy,
  shippingSuggestions,
  resolveShippingLocation,
  createShippingQuote,
  savedAddressFields,
  assertShopShippingAddress,
  assertZoneEditable,
} from "@/lib/shipping";
import {
  saveCatalogProduct,
  listCatalogProducts,
  setProductVisibility,
  saveCatalogTaxonomy,
  hideCatalogTaxonomy,
} from "@/lib/catalog-admin";
import { productClassifications } from "@/lib/catalogue";
import {
  confirmOrderPayment,
  stopAndRefundOrder,
  requestOrderRefund,
  completeOrderRefund,
} from "@/lib/order-payments";
import { stoppedOrderStatuses } from "@/lib/order-workflow";
import {
  createAdminOrder,
  quoteAdminOrder,
  requireOrderCreator,
} from "@/lib/admin-orders";
import {
  orderReviewOptions,
  createOrderReview,
  publicProductReviews,
  buyerProductReviews,
} from "@/lib/order-reviews";
import { prepareReorder } from "@/lib/order-reorder";
import { googleAuthAvailable } from "@/lib/google-auth";
import { safeAuthNext } from "@/lib/auth-redirect";
import { customerOrder } from "@/lib/order-privacy";
import { getOrderCard } from "@/lib/order-card";
import {
  renderFlowerCard,
  cardTemplatePng,
  renderCardTemplate,
  flowerCardPng,
} from "@/lib/flower-card";
import {
  getSepayConfig,
  getSepayAdminView,
  saveSepaySettings,
  rotateSepayWebhookKey,
  verifySepayAuthorization,
  sepayQrUrl,
} from "@/lib/sepay-settings";
import { after, NextRequest, NextResponse } from "next/server";
import { runCloudWorker } from "@/lib/cloud-worker";
import { cookies } from "next/headers";
import { hash as passwordHash, compare } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  currentUser,
  createSession,
  publicUser,
  SESSION_COOKIE,
  can,
} from "@/lib/auth";
import { checkOrigin, fail, handle, json, rateLimit } from "@/lib/api";
import { hash, token, decrypt, equal } from "@/lib/security";
import {
  checkoutSchema,
  checkoutQuoteSchema,
  createOrder,
  quote,
  claimQr,
  transitionOrder,
  receiveSepay,
  sepaySchema,
  expireReservations,
  atomic,
} from "@/lib/commerce";
import { getSettings, settingsSchema } from "@/lib/settings";
import {
  getCollections,
  getCollectionDetail,
  updateCollection,
  remitCollection,
} from "@/lib/collections";
import { deliverOrder } from "@/lib/order-delivery";
import { trackOrder, trackingPayment } from "@/lib/order-tracking";
import {
  getOrderPaymentQr,
  downloadOrderPaymentQr,
  setOrderPaymentTerms,
} from "@/lib/order-payment-qr";
import { isPaymentOverdue } from "@/lib/order-expiry";
import { dayKey, monthKey, streakStats, localInstant } from "@/lib/time";
import { sendAuthMail } from "@/lib/mail";
import { enqueueJob } from "@/lib/queue";
import { setupMfa, validOtp, recoveryCodes, verifyMfa } from "@/lib/mfa";
import { analyticsEnabled, queueAnalytics } from "@/lib/analytics";
import {
  getRewardRules,
  rewardRuleSchema,
  rulesSchema,
} from "@/lib/reward-rules";
import type { Prisma } from "@prisma/client";
import { handleMembershipApi } from "@/lib/membership-api";
import { handleDailyApi } from "@/lib/daily-api";
import { dailyFinancialSummary } from "@/lib/daily-finance";
import {
  getMembershipTiers,
  resolveMembership,
  enrollMember,
  membershipPeriod,
  issueBirthdayReward,
  recordMembershipRefund,
} from "@/lib/membership";
import { notificationScope } from "@/lib/notifications";
import { getPushPublicKey } from "@/lib/push-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
async function route(req: NextRequest, context: Context) {
  return handle(async () => {
    const path = (await context.params).path;
    const action = path.join("/");
    const method = req.method;
    if (
      method !== "GET" &&
      !action.startsWith("payments/") &&
      !action.startsWith("internal/")
    )
      checkOrigin(req);
    const user = await currentUser();
    if (
      ["orders/track", "orders/track/payment"].includes(action) &&
      method === "POST"
    ) {
      const address = (
        req.headers.get("x-forwarded-for")?.split(",")[0] ??
        req.headers.get("x-real-ip") ??
        "local"
      )
        .trim()
        .slice(0, 100);
      await rateLimit(`tracking:${address}`, 90, 300);
      await rateLimit("tracking:global", 600, 60);
      const input = await req.json();
      return json(
        action === "orders/track/payment"
          ? await trackingPayment(input)
          : await trackOrder(input),
      );
    }
    if (process.env.VERCEL === "1" && action !== "health")
      after(async () => {
        await runCloudWorker(method !== "GET").catch(() =>
          console.error("Cloud worker retry required"),
        );
      });
    if (action === "health" && method === "GET") {
      await db.$queryRaw`SELECT 1`;
      return json({
        status: "ok",
        timezone: "Asia/Ho_Chi_Minh",
        paymentProvider: "sepay",
      });
    }
    const requireUser = () => {
      if (!user) fail("UNAUTHORIZED", "Vui lòng đăng nhập.", 401);
      return user;
    };
    const requireAdmin = (area: string) => {
      const u = requireUser();
      if (!can(u.role, area))
        fail("FORBIDDEN", "Bạn không có quyền truy cập mục này.", 403);
      return u;
    };
    const body = async () => {
      const reader = req.body?.getReader();
      if (!reader) fail("INVALID_JSON", "Thiếu dữ liệu.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 100000) {
          await reader.cancel();
          fail("BODY_TOO_LARGE", "Dữ liệu quá lớn.", 413);
        }
        chunks.push(value);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        return JSON.parse(raw);
      } catch {
        fail("INVALID_JSON", "Dữ liệu không hợp lệ.");
      }
    };
    const shippingOwner = () =>
      user
        ? `user:${user.id}`
        : req.cookies.get("fleurious_guest")?.value
          ? `guest:${hash(req.cookies.get("fleurious_guest")!.value)}`
          : undefined;
    if (action === "admin/settings/delivery") {
      const actor = requireAdmin("settings");
      if (method === "GET") return json(await shippingAdminView(actor));
      if (method === "PATCH")
        return json(await saveShippingPolicy(actor, await body()));
    }
    if (
      [
        "locations/autocomplete",
        "locations/resolve",
        "shipping/quote",
      ].includes(action) &&
      method === "POST"
    ) {
      const address = (
        req.headers.get("x-forwarded-for")?.split(",")[0] ??
        req.headers.get("x-real-ip") ??
        "local"
      )
        .trim()
        .slice(0, 100);
      const guest = req.cookies.get("fleurious_guest")?.value ?? token();
      const owner = user ? `user:${user.id}` : `guest:${hash(guest)}`;
      await rateLimit(`shipping:${address}`, 180, 300);
      await rateLimit(`shipping-owner:${owner}`, 120, 300);
      const configuredBudget = Number(
        process.env.GOONG_REQUESTS_PER_MINUTE ?? 120,
      );
      await rateLimit(
        "shipping:global",
        Number.isSafeInteger(configuredBudget) && configuredBudget > 0
          ? configuredBudget
          : 120,
        60,
      );
      const input = await body();
      const response = json(
        action === "locations/autocomplete"
          ? await shippingSuggestions(input)
          : action === "locations/resolve"
            ? await resolveShippingLocation(owner, input, user?.id)
            : await createShippingQuote(owner, input),
      );
      if (!req.cookies.get("fleurious_guest"))
        response.cookies.set("fleurious_guest", guest, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 86400,
        });
      return response;
    }
    if (
      action === "admin/settings/sepay" ||
      action === "admin/settings/sepay/rotate-key"
    ) {
      const actor = requireAdmin("settings");
      if (action.endsWith("rotate-key") && method === "POST") {
        const input = z
          .object({ version: z.number().int().min(1) })
          .parse(await body());
        return json(await rotateSepayWebhookKey(actor, input.version));
      }
      if (action === "admin/settings/sepay" && method === "GET")
        return json(await getSepayAdminView(actor));
      if (action === "admin/settings/sepay" && method === "PATCH")
        return json(await saveSepaySettings(actor, await body()));
      fail("NOT_FOUND", "Không có chức năng này.", 404);
    }
    if (action === "admin/settings/card-templates" && method === "GET") {
      const actor = requireAdmin("settings");
      const kind = z
        .enum(["blank", "brand"])
        .parse(req.nextUrl.searchParams.get("kind"));
      const format = z
        .enum(["svg", "png"])
        .parse(req.nextUrl.searchParams.get("format") ?? "png");
      const buffer =
        format === "png"
          ? await cardTemplatePng(kind)
          : Buffer.from(await renderCardTemplate(kind));
      if (format === "png")
        await db.audit.create({
          data: {
            actorId: actor.id,
            action: "settings.card_template_exported",
            entityId: kind,
            detail: { format },
          },
        });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": format === "png" ? "image/png" : "image/svg+xml",
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Disposition": `${format === "svg" && req.nextUrl.searchParams.get("download") !== "1" ? "inline" : "attachment"}; filename="fleurious-template-${kind}.${format}"`,
        },
      });
    }
    if (
      path[0] === "admin" &&
      path[1] === "orders" &&
      path[2] &&
      path[3] === "card" &&
      path.length === 4 &&
      method === "GET"
    ) {
      const actor = requireAdmin("orders");
      const result = await getOrderCard(actor, path[2]);
      const format = req.nextUrl.searchParams.get("format");
      if (!format)
        return json({
          state: result.state,
          printable: result.printable,
          remaining: result.remaining,
          expiresAt: result.expiresAt,
          localUrl: result.localUrl,
          longMessage: result.longMessage,
          writingMode: result.writingMode,
        });
      if (!result.printable)
        fail(
          "QR_UNAVAILABLE",
          "QR đã thu hồi, hết hạn hoặc hết lượt. Không thể in card này.",
          409,
        );
      if (!["svg", "png"].includes(format))
        fail("INVALID_FORMAT", "Chỉ hỗ trợ ảnh PNG hoặc SVG.");
      const side =
        req.nextUrl.searchParams.get("side") === "back" ? "back" : "front";
      const buffer =
        format === "png"
          ? await flowerCardPng(result.card, side)
          : Buffer.from(await renderFlowerCard(result.card, side));
      if (format !== "svg")
        await db.audit.create({
          data: {
            actorId: actor.id,
            action: "order.card_exported",
            entityId: path[2],
            detail: { format, side, writingMode: result.writingMode },
          },
        });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": format === "png" ? "image/png" : "image/svg+xml",
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Disposition": `${format === "svg" && req.nextUrl.searchParams.get("download") !== "1" ? "inline" : "attachment"}; filename="fleurious-${result.card.code}-${side}.${format}"`,
        },
      });
    }
    if (
      path[0] === "admin" &&
      path[1] === "orders" &&
      path[2] &&
      path[3] === "payment" &&
      path.length === 4 &&
      method === "PATCH"
    ) {
      const actor = requireAdmin("payments");
      const updated = await confirmOrderPayment(path[2], await body(), actor);
      return json({
        success: true,
        version: updated.version,
        paymentStatus: updated.paymentStatus,
      });
    }
    if (
      path[0] === "admin" &&
      path[1] === "orders" &&
      path[2] &&
      path[3] === "stop-refund" &&
      path.length === 4 &&
      method === "POST"
    ) {
      const actor = requireAdmin("orders");
      requireAdmin("payments");
      const input = z
        .object({
          version: z.number().int().positive(),
          reason: z.string().trim().min(4).max(300),
        })
        .parse(await body());
      const updated = await stopAndRefundOrder(
        path[2],
        input.version,
        input.reason,
        actor,
      );
      return json({
        success: true,
        version: updated.version,
        status: updated.status,
      });
    }
    if (
      path[0] === "admin" &&
      path[1] === "orders" &&
      path[2] &&
      path[3] === "payment-qr" &&
      path.length === 4 &&
      method === "GET"
    ) {
      const actor = requireAdmin("orders");
      requireOrderCreator(actor);
      if (req.nextUrl.searchParams.get("download") === "1") {
        const result = await downloadOrderPaymentQr(actor, path[2]);
        return new NextResponse(new Uint8Array(result.png), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="fleurious-payment-${result.code}.png"`,
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      return json(await getOrderPaymentQr(actor, path[2]));
    }
    if (action === "admin/orders" && method === "POST") {
      const actor = requireAdmin("orders");
      requireOrderCreator(actor);
      await rateLimit(`admin-order:${actor.id}`, 30, 300);
      await expireReservations();
      const order = await createAdminOrder(await body(), actor);
      return json(
        {
          id: order.id,
          code: order.code,
          version: order.version,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
        },
        201,
      );
    }
    if (
      path[0] === "admin" &&
      path[1] === "orders" &&
      path[2] &&
      path[3] === "payment-terms" &&
      path.length === 4 &&
      method === "PATCH"
    )
      return json(
        await setOrderPaymentTerms(
          requireAdmin("orders"),
          path[2],
          await body(),
        ),
      );
    if (action === "admin/orders/quote" && method === "POST")
      return json(await quoteAdminOrder(await body(), requireAdmin("orders")));
    if (action === "admin/orders/customers" && method === "GET") {
      const actor = requireAdmin("orders");
      requireOrderCreator(actor);
      const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
      return json(
        await db.user.findMany({
          where: {
            role: "CUSTOMER",
            disabled: false,
            ...(q
              ? {
                  OR: [
                    { name: { contains: q } },
                    { email: { contains: q } },
                    { phone: { contains: q } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            memberSince: true,
          },
          take: 20,
          orderBy: { createdAt: "desc" },
        }),
      );
    }
    const dailyResponse = await handleDailyApi(req, path, user, body);
    if (dailyResponse) return dailyResponse;
    const membershipResponse = await handleMembershipApi(req, path, user, body);
    if (membershipResponse) return membershipResponse;
    if (action === "bootstrap" && method === "GET") {
      const [products, zones, slots, settings, content, taxonomies] =
        await Promise.all([
          db.product.findMany({
            where: { active: true },
            include: {
              variants: true,
              taxonomies: { include: { taxonomy: true } },
            },
            orderBy: { sortOrder: "asc" },
          }),
          db.deliveryZone.findMany({ where: { active: true } }),
          db.deliverySlot.findMany({
            where: { active: true },
            orderBy: { startHour: "asc" },
          }),
          getSettings(),
          db.content.findMany({
            where: {
              active: true,
              kind: { in: ["page", "article", "faq", "banner"] },
            },
          }),
          db.taxonomy.findMany({ where: { active: true } }),
        ]);
      return json({
        shipping: await shippingPublic(),
        products: products.map(productClassifications),
        zones,
        slots,
        settings,
        content,
        taxonomies,
        analyticsEnabled: analyticsEnabled(),
        rewardRules: (await getRewardRules()).rules.filter((r) => r.active),
        membershipTiers: (await getMembershipTiers()).filter((t) => t.active),
        sepayAvailable: (await getSepayConfig()).configured,
        googleAuthAvailable: googleAuthAvailable(),
        realtimeTransport:
          process.env.VERCEL === "1" ? "websocket" : "socketio",
        vapidKey: getPushPublicKey(),
      });
    }
    if (action === "reviews" && method === "GET")
      return json(
        await publicProductReviews(
          req.nextUrl.searchParams.get("productId") ?? "",
        ),
      );
    if (action === "me/reviews" && method === "GET") {
      const u = requireUser();
      return json(
        await buyerProductReviews(
          u.id,
          req.nextUrl.searchParams.get("productId") ?? "",
        ),
      );
    }
    if (
      (path[0] === "orders" && path.length === 3 && path[2] === "reviews") ||
      action === "me/reviews"
    ) {
      const buyer = {
        userId: user?.id,
        name: user?.name,
        guestToken: req.cookies.get("fleurious_guest")?.value,
      };
      if (method === "GET" && path[0] === "orders")
        return json(await orderReviewOptions(path[1], buyer));
      if (method === "POST") {
        const input = await body();
        if (action === "me/reviews") requireUser();
        await rateLimit(
          `review:${user?.id ?? hash(buyer.guestToken ?? "guest")}`,
          20,
          3600,
        );
        return json(
          await createOrderReview(
            path[0] === "orders"
              ? path[1]
              : z.object({ orderId: z.string().min(1).max(100) }).parse(input)
                  .orderId,
            input,
            buyer,
          ),
          201,
        );
      }
    }
    if (action === "analytics/events" && method === "POST") {
      if (
        !analyticsEnabled() ||
        req.cookies.get("fleurious_analytics")?.value !== "yes"
      )
        return json({ accepted: false }, 202);
      const input = z
        .object({
          name: z.enum([
            "page_view",
            "view_item_list",
            "view_item",
            "add_to_cart",
            "begin_checkout",
            "membership_enrolled",
            "qr_claim_succeeded",
          ]),
          clientId: z.uuid(),
          eventId: z.uuid(),
          params: z.object({
            path: z
              .string()
              .regex(/^\/[a-z0-9/-]*$/)
              .max(200)
              .optional(),
            productId: z.string().max(100).optional(),
            device_type: z.enum(["mobile", "desktop"]).optional(),
            items: z
              .array(
                z.object({
                  variantId: z.string().max(100),
                  quantity: z.number().int().min(1).max(20),
                }),
              )
              .max(30)
              .optional(),
          }),
        })
        .parse(await body());
      if (input.clientId !== req.cookies.get("fleurious_analytics_id")?.value)
        fail("INVALID_CLIENT", "Yêu cầu không hợp lệ.");
      if (
        input.params.path &&
        /^\/(admin|account|auth|q|orders|checkout|cart|streak)(\/|$)/.test(
          input.params.path,
        )
      )
        return json({ accepted: false }, 202);
      await rateLimit(`analytics:${input.clientId}`, 60, 60);
      await rateLimit("analytics:global", 1000, 60);
      const variants = input.params.items
        ? await db.productVariant.findMany({
            where: { id: { in: input.params.items.map((i) => i.variantId) } },
            include: { product: { select: { name: true } } },
          })
        : [];
      const items = input.params.items
        ?.map((i) => {
          const v = variants.find((v) => v.id === i.variantId);
          return v
            ? {
                item_id: v.id,
                item_name: v.product.name,
                price: v.price,
                quantity: i.quantity,
              }
            : null;
        })
        .filter(Boolean);
      await db.$transaction((tx) =>
        queueAnalytics(tx, {
          clientId: input.clientId,
          eventId: input.eventId,
          name: input.name,
          userId: user?.id,
          params: {
            ...(input.params.path ? { page_path: input.params.path } : {}),
            ...(input.params.productId
              ? { product_id: input.params.productId }
              : {}),
            ...(items ? { items, currency: "VND" } : {}),
            device_type: input.params.device_type ?? "unknown",
          },
        }),
      );
      return json({ accepted: true }, 202);
    }
    if (action === "analytics/optout" && method === "POST") {
      const clientId = req.cookies.get("fleurious_analytics_id")?.value;
      const guest = req.cookies.get("fleurious_guest")?.value;
      const OR: Prisma.OrderWhereInput[] = [];
      if (user) OR.push({ userId: user.id });
      if (guest) OR.push({ guestHash: hash(guest) });
      if (OR.length)
        await db.order.updateMany({
          where: { OR },
          data: { analyticsClientId: null },
        });
      if (user || clientId)
        await db.$executeRaw`UPDATE DailyHistory dh JOIN DailyPlan p ON p.id=dh.planId SET dh.detail=JSON_REMOVE(dh.detail,'$.analyticsClientId') WHERE dh.action='created' AND (p.userId=${user?.id ?? ""} OR JSON_UNQUOTE(JSON_EXTRACT(dh.detail,'$.analyticsClientId'))=${clientId ?? ""})`;
      if (clientId)
        await db.outbox.updateMany({
          where: {
            event: "analytics.event",
            sent: false,
            payload: { path: "$.clientId", equals: clientId },
          },
          data: { sent: true },
        });
      return json({ success: true });
    }
    if (action === "auth/me" && method === "GET")
      return json({ user: user ? publicUser(user) : null });
    if (action === "auth/login" && method === "POST") {
      const input = z
        .object({
          email: z.email(),
          password: z.string().min(1).max(200),
          code: z.string().max(30).optional(),
        })
        .parse(await body());
      await rateLimit(`login:${input.email.toLowerCase()}`, 10, 300);
      const found = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      // Keep password hashing work on unknown accounts to reduce account enumeration through timing.
      const valid = await compare(
        input.password,
        found?.passwordHash ??
          "$2b$12$Y9CWX3Mqo26aFKIMMhXQy.5GxFSm4ww2JpYwLTU67YSvvGlrYl.pu",
      );
      if (!found || !valid || found.disabled)
        fail("INVALID_CREDENTIALS", "Email hoặc mật khẩu chưa đúng.", 401);
      if (found.totpEnabled) {
        if (!input.code)
          fail(
            "MFA_REQUIRED",
            "Nhập mã 2FA hoặc mã dự phòng để tiếp tục.",
            401,
          );
        if (!(await verifyMfa(found.id, input.code)))
          fail("MFA_INVALID", "Mã 2FA chưa đúng, đã dùng hoặc hết hạn.", 401);
      }
      const session = await createSession(found.id);
      const response = json({ user: publicUser(found) });
      response.cookies.set(SESSION_COOKIE, session, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    if (action === "auth/register" && method === "POST") {
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email().max(200),
          next: z.string().optional(),
          password: z
            .string()
            .min(10, "Mật khẩu cần ít nhất 10 ký tự")
            .max(100),
        })
        .parse(await body());
      await rateLimit(`register:${input.email.toLowerCase()}`, 3, 3600);
      if (process.env.NODE_ENV === "production" && !process.env.SMTP_HOST)
        fail("EMAIL_UNAVAILABLE", "Cửa hàng chưa bật đăng ký qua email.", 503);
      if (
        await db.user.findUnique({
          where: { email: input.email.toLowerCase() },
        })
      )
        fail(
          "EMAIL_EXISTS",
          "Email đã được sử dụng. Hãy đăng nhập hoặc đặt lại mật khẩu.",
        );
      const created = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: input.name,
            email: input.email.toLowerCase(),
            passwordHash: await passwordHash(input.password, 12),
          },
        });
        await tx.outbox.create({
          data: { userId: created.id, event: "user.registered", payload: {} },
        });
        return created;
      });
      const value = token();
      await db.verification.create({
        data: {
          id: hash(value),
          email: created.email,
          kind: "verify",
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const devLink = await sendAuthMail(
        created.email,
        `${process.env.APP_URL}/auth/verify?token=${value}&next=${encodeURIComponent(safeAuthNext(input.next))}`,
        "verify",
      );
      const response = json({
        user: publicUser(created),
        message: "Kiểm tra email để xác minh tài khoản.",
        devLink,
      });
      response.cookies.set(SESSION_COOKIE, await createSession(created.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    if (action === "auth/logout" && method === "POST") {
      const value = (await cookies()).get(SESSION_COOKIE)?.value;
      if (value) await db.session.deleteMany({ where: { id: hash(value) } });
      const response = json({ success: true });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    if (action === "auth/forgot" && method === "POST") {
      const input = z.object({ email: z.email() }).parse(await body());
      await rateLimit(`forgot:${input.email}`, 3, 3600);
      const found = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      let devLink;
      if (found) {
        const value = token();
        await db.verification.create({
          data: {
            id: hash(value),
            email: found.email,
            kind: "reset",
            expiresAt: new Date(Date.now() + 1800000),
          },
        });
        devLink = await sendAuthMail(
          found.email,
          `${process.env.APP_URL}/auth/reset?token=${value}`,
          "reset",
        );
      }
      return json({
        message: "Nếu tài khoản tồn tại, liên kết đã được gửi.",
        devLink,
      });
    }
    if (["auth/verify", "auth/reset"].includes(action) && method === "POST") {
      const input = z
        .object({
          token: z.string().length(64),
          password: z.string().min(10).max(100).optional(),
        })
        .parse(await body());
      const kind = action.endsWith("verify") ? "verify" : "reset";
      if (kind === "reset" && !input.password)
        fail("PASSWORD_REQUIRED", "Nhập mật khẩu mới.");
      await atomic(async (tx) => {
        const v = await tx.verification.findUnique({
          where: { id: hash(input.token) },
        });
        if (!v || v.kind !== kind || v.expiresAt < new Date())
          fail("TOKEN_EXPIRED", "Liên kết không hợp lệ hoặc đã hết hạn.");
        await tx.verification.delete({ where: { id: v.id } });
        const u = await tx.user.update({
          where: { email: v.email },
          data:
            kind === "verify"
              ? { verified: true }
              : { passwordHash: await passwordHash(input.password!, 12) },
        });
        if (kind === "reset")
          await tx.session.deleteMany({ where: { userId: u.id } });
      });
      return json({ success: true });
    }
    if (action === "checkout/quote" && method === "POST")
      return json(
        await quote(checkoutQuoteSchema.parse(await body()), user, db, {
          shippingOwner: shippingOwner(),
        }),
      );
    if (action === "orders" && method === "POST") {
      await rateLimit(
        `order:${user?.id ?? req.cookies.get("fleurious_guest")?.value ?? "guest"}`,
        10,
        300,
      );
      const input = checkoutSchema.parse(await body());
      await expireReservations();
      const guest = req.cookies.get("fleurious_guest")?.value ?? token();
      const consentId = z
        .uuid()
        .safeParse(req.cookies.get("fleurious_analytics_id")?.value);
      const order = await createOrder(input, user, hash(guest), {
        analyticsClientId:
          req.cookies.get("fleurious_analytics")?.value === "yes" &&
          consentId.success
            ? consentId.data
            : undefined,
      });
      const response = json({ id: order.id, code: order.code }, 201);
      response.cookies.set("fleurious_guest", guest, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    if (
      path[0] === "orders" &&
      path.length === 3 &&
      path[2] === "reorder" &&
      method === "POST"
    ) {
      await rateLimit(
        `reorder:${user?.id ?? req.cookies.get("fleurious_guest")?.value ?? "guest"}`,
        20,
        300,
      );
      return json(
        await prepareReorder(
          path[1],
          user?.id,
          req.cookies.get("fleurious_guest")?.value,
        ),
      );
    }
    if (path[0] === "orders" && path.length === 2 && method === "GET") {
      await expireReservations(path[1]);
      const order = await db.order.findUnique({
        where: { id: path[1] },
        include: {
          items: true,
          history: { orderBy: { createdAt: "asc" } },
          refunds: true,
        },
      });
      const guest = req.cookies.get("fleurious_guest")?.value;
      if (
        !order ||
        (!(order.userId && order.userId === user?.id) &&
          !(guest && order.guestHash === hash(guest)))
      )
        fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
      const sepay = await getSepayConfig();
      const paymentQr =
        order.paymentMethod === "SEPAY" &&
        ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
        !stoppedOrderStatuses.includes(order.status) &&
        !isPaymentOverdue(order)
          ? (sepayQrUrl(sepay, order.total, order.paymentCode ?? order.code) ??
            null)
          : null;
      return json({
        ...customerOrder(order),
        serverNow: new Date().toISOString(),
        paymentQr,
        bank: sepay.bank,
        accountNumber: sepay.accountNumber,
        accountName: sepay.accountName,
      });
    }
    if (path[0] === "qr" && path[1] === "preview" && method === "POST") {
      const input = z
        .object({ token: z.string().length(64) })
        .parse(await body());
      const grant = await db.qrGrant.findUnique({
        where: { tokenHash: hash(input.token) },
        include: { order: { include: { items: true } } },
      });
      if (!grant) fail("QR_NOT_FOUND", "Không tìm thấy QR.", 404);
      return json({
        image: grant.order.items[0].image,
        name: grant.order.items[0].name,
        eligibleAt: grant.eligibleAt,
        expiresAt: grant.expiresAt,
        revoked:
          grant.revoked || stoppedOrderStatuses.includes(grant.order.status),
        remaining: Math.max(0, grant.maxClaims - grant.claimsCount),
      });
    }
    if (action === "qr/claim" && method === "POST") {
      const u = requireUser();
      await rateLimit(`claim:${u.id}`, 12, 60);
      return json(
        await claimQr(
          z.object({ token: z.string().length(64) }).parse(await body()).token,
          u,
        ),
      );
    }
    if (action === "membership/enroll" && method === "POST") {
      const u = requireUser();
      if (!u.verified)
        fail("VERIFY_EMAIL", "Vui lòng xác minh email trước khi tham gia.");
      const settings = await getSettings();
      if (!settings.memberEnabled)
        fail("MEMBERSHIP_PAUSED", "Chương trình hội viên đang tạm dừng.");
      const consent = z
        .object({ accepted: z.literal(true) })
        .parse(await body());
      await atomic(async (tx) => {
        const membership = await enrollMember(tx, u.id);
        await membershipPeriod(tx, u.id, membership);
      });
      return json({ success: true });
    }
    if (action === "me" && method === "GET") {
      const u = requireUser();
      await expireReservations();
      if (u.memberSince && u.birthDate)
        await atomic((tx) => issueBirthdayReward(tx, u.id));
      const membership = await resolveMembership(u.id);
      const [
        orders,
        period,
        days,
        rewards,
        favorites,
        addresses,
        notifications,
      ] = await Promise.all([
        db.order.findMany({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { items: true },
        }),
        db.memberPeriod.findUnique({
          where: { userId_month: { userId: u.id, month: monthKey() } },
        }),
        db.activeDay.findMany({
          where: { userId: u.id },
          orderBy: { day: "desc" },
        }),
        db.reward.findMany({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
        }),
        db.favorite.findMany({ where: { userId: u.id } }),
        db.address.findMany({ where: { userId: u.id } }),
        db.notification.findMany({
          where: notificationScope(u.id, u.role, false),
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);
      return json({
        user: {
          ...publicUser(u),
          tier: membership.current?.name ?? "Member",
          birthDate: u.birthDate,
        },
        membership,
        orders: orders.map(customerOrder),
        period: u.memberSince
          ? {
              limit: membership.limit,
              reserved: membership.reserved,
              consumed: membership.consumed,
            }
          : period,
        days,
        stats: streakStats(days.filter((d) => d.valid).map((d) => d.day)),
        rewards,
        favorites,
        addresses,
        notifications,
      });
    }
    if (action === "me/2fa" && method === "GET") {
      const u = requireUser();
      return json({
        enabled: u.totpEnabled,
        recoveryCount: Array.isArray(u.recoveryHashes)
          ? u.recoveryHashes.length
          : 0,
      });
    }
    if (action === "me/2fa/setup" && method === "POST") {
      const u = requireUser();
      await rateLimit(`mfa:${u.id}`, 5, 300);
      const input = z
        .object({ password: z.string().max(200) })
        .parse(await body());
      if (u.totpEnabled || !(await compare(input.password, u.passwordHash)))
        fail("MFA_SETUP_DENIED", "Mật khẩu chưa đúng hoặc 2FA đã bật.");
      const setup = setupMfa(u.email);
      await db.user.update({
        where: { id: u.id },
        data: {
          totpPendingEncrypted: setup.encrypted,
          totpPendingExpires: new Date(Date.now() + 900000),
        },
      });
      return json({ secret: setup.secret, uri: setup.uri });
    }
    if (action === "me/2fa/enable" && method === "POST") {
      const u = requireUser();
      await rateLimit(`mfa:${u.id}`, 5, 300);
      const input = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .parse(await body());
      if (
        u.totpEnabled ||
        !u.totpPendingEncrypted ||
        !u.totpPendingExpires ||
        u.totpPendingExpires < new Date() ||
        validOtp(u.totpPendingEncrypted, input.code) === null
      )
        fail(
          "MFA_INVALID",
          "Mã xác thực chưa đúng hoặc phiên cài đặt đã hết hạn.",
        );
      const recovery = recoveryCodes();
      const current = (await cookies()).get(SESSION_COOKIE)?.value;
      await db.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: {
            id: u.id,
            totpEnabled: false,
            totpPendingEncrypted: u.totpPendingEncrypted,
          },
          data: {
            totpEnabled: true,
            totpSecretEncrypted: u.totpPendingEncrypted,
            totpPendingEncrypted: null,
            totpPendingExpires: null,
            recoveryHashes: recovery.hashes,
            totpLastStep: 0,
          },
        });
        if (!changed.count)
          fail(
            "MFA_SETUP_CONFLICT",
            "Phiên cài đặt đã thay đổi. Hãy thử lại.",
            409,
          );
        await tx.session.deleteMany({
          where: {
            userId: u.id,
            ...(current ? { id: { not: hash(current) } } : {}),
          },
        });
        await tx.audit.create({
          data: {
            actorId: u.id,
            action: "security.mfa.enable",
            entityId: u.id,
            detail: {},
          },
        });
      });
      return json({ recoveryCodes: recovery.codes });
    }
    if (action === "me/2fa/disable" && method === "POST") {
      const u = requireUser();
      await rateLimit(`mfa:${u.id}`, 5, 300);
      const input = z
        .object({ password: z.string().max(200), code: z.string().max(30) })
        .parse(await body());
      if (
        !(await compare(input.password, u.passwordHash)) ||
        !(await verifyMfa(u.id, input.code))
      )
        fail("MFA_INVALID", "Mật khẩu hoặc mã xác thực chưa đúng.");
      await db.user.update({
        where: { id: u.id },
        data: {
          totpEnabled: false,
          totpSecretEncrypted: null,
          recoveryHashes: [],
          totpLastStep: 0,
        },
      });
      await db.audit.create({
        data: {
          actorId: u.id,
          action: "security.mfa.disable",
          entityId: u.id,
          detail: {},
        },
      });
      return json({ success: true });
    }
    if (action === "me/profile" && method === "PATCH") {
      const u = requireUser();
      const data = z
        .object({
          name: z.string().trim().min(2).max(100),
          phone: z.string().max(20),
        })
        .parse(await body());
      return json(
        publicUser(await db.user.update({ where: { id: u.id }, data })),
      );
    }
    if (action === "me/favorites" && method === "POST") {
      const u = requireUser();
      const input = z
        .object({ productId: z.string(), active: z.boolean() })
        .parse(await body());
      if (input.active)
        await db.favorite.upsert({
          where: {
            userId_productId: { userId: u.id, productId: input.productId },
          },
          create: { userId: u.id, productId: input.productId },
          update: {},
        });
      else
        await db.favorite.deleteMany({
          where: { userId: u.id, productId: input.productId },
        });
      return json({ success: true });
    }
    if (action === "me/addresses" && method === "POST") {
      const u = requireUser();
      const input = await body();
      const contact = z
        .object({
          name: z.string().min(2).max(100),
          phone: z.string().min(10).max(20),
        })
        .parse(input);
      const fields = await savedAddressFields(`user:${u.id}`, input);
      if ((await db.address.count({ where: { userId: u.id } })) >= 10)
        fail("ADDRESS_LIMIT", "Bạn đã lưu tối đa 10 địa chỉ.");
      return json(
        await db.address.create({
          data: { ...fields, ...contact, userId: u.id },
        }),
      );
    }
    if (
      path[0] === "me" &&
      path[1] === "addresses" &&
      path[2] &&
      method === "DELETE"
    ) {
      requireUser();
      await db.address.deleteMany({ where: { id: path[2], userId: user!.id } });
      return json({ success: true });
    }
    if (["me/notifications", "admin/notifications"].includes(action)) {
      const u = action.startsWith("admin/")
        ? requireAdmin("overview")
        : requireUser();
      const scope = notificationScope(
        u.id,
        u.role,
        action.startsWith("admin/"),
      );
      if (method === "GET") {
        const page = Math.max(
          1,
          Math.min(
            1000,
            Math.floor(Number(req.nextUrl.searchParams.get("page")) || 1),
          ),
        );
        const [items, unread, total] = await Promise.all([
          db.notification.findMany({
            where: scope,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 30,
            skip: (page - 1) * 30,
          }),
          db.notification.count({ where: { AND: [scope, { read: false }] } }),
          db.notification.count({ where: scope }),
        ]);
        return json({ items, unread, total, page });
      }
      if (method === "POST") {
        const input = z
          .object({
            id: z.string().max(100).optional(),
            before: z.iso.datetime().optional(),
          })
          .parse(await body());
        await db.notification.updateMany({
          where: {
            AND: [
              scope,
              { read: false },
              ...(input.id
                ? [{ id: input.id }]
                : [
                    {
                      createdAt: {
                        lte: input.before ? new Date(input.before) : new Date(),
                      },
                    },
                  ]),
            ],
          },
          data: { read: true },
        });
        await db.outbox.create({
          data: { userId: u.id, event: "notification.read", payload: {} },
        });
        return json({ success: true });
      }
    }
    if (action === "me/push" && method === "POST") {
      const u = requireUser();
      if (!getPushPublicKey())
        fail(
          "PUSH_UNAVAILABLE",
          "Cửa hàng chưa hoàn tất thiết lập thông báo thiết bị.",
          503,
        );
      const input = z
        .object({
          endpoint: z.url().startsWith("https://"),
          keys: z.object({
            p256dh: z.string().max(200),
            auth: z.string().max(100),
          }),
        })
        .parse(await body());
      const host = new URL(input.endpoint).hostname;
      if (
        ![
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
          "wns2-par02p.wns.windows.com",
        ].includes(host) &&
        !host.endsWith(".notify.windows.com")
      )
        fail("INVALID_PUSH_ENDPOINT", "Dịch vụ push không hỗ trợ.");
      await db.pushSubscription.upsert({
        where: { endpointHash: hash(input.endpoint) },
        create: {
          userId: u.id,
          endpointHash: hash(input.endpoint),
          subscription: input,
        },
        update: { userId: u.id, subscription: input },
      });
      return json({ success: true });
    }
    if (action === "payments/sepay/webhook" && method === "POST") {
      await verifySepayAuthorization(req.headers.get("authorization"));
      return json(await receiveSepay(sepaySchema.parse(await body())), 201);
    }
    if (action.startsWith("internal/jobs/") && method === "POST") {
      const jobName = path[2];
      if (
        ![
          "cleanup",
          "reconcile",
          "delivery-reminders",
          "streak-reminders",
          "digest",
          "membership-maintenance",
          "collection-reminders",
        ].includes(jobName)
      )
        fail("NOT_FOUND", "Không có tác vụ này.", 404);
      if (
        !process.env.CRON_SECRET ||
        !equal(
          req.headers.get("authorization") ?? "",
          `Bearer ${process.env.CRON_SECRET}`,
        )
      )
        fail("UNAUTHORIZED", "Unauthorized", 401);
      const id = `${jobName}:${jobName === "digest" || jobName === "streak-reminders" ? dayKey() : Math.floor(Date.now() / 60000)}`;
      const exists = await db.jobRun.findUnique({ where: { id } });
      if (exists) return json({ accepted: true, duplicate: true }, 202);
      await db.jobRun.create({
        data: { id, name: jobName, status: "QUEUED", detail: "" },
      });
      await enqueueJob(id);
      return json({ accepted: true }, 202);
    }
    if (path[0] === "admin") {
      const section = path[1] ?? "overview";
      const actor = requireAdmin(
        section === "receivables"
          ? "payments"
          : section === "taxonomies"
            ? "products"
            : section === "reviews"
              ? "content"
              : section === "settings" ||
                  section === "team" ||
                  section === "audit" ||
                  section === "jobs"
                ? "settings"
                : section === "members" ||
                    section === "streaks" ||
                    section === "customers"
                  ? "customers"
                  : section === "refunds"
                    ? "payments"
                    : section,
      );
      if (section === "receivables") {
        if (method === "GET" && !path[2])
          return json(await getCollections(actor, req.nextUrl.searchParams));
        if (method === "GET" && path[2] && !path[3])
          return json(await getCollectionDetail(actor, path[2]));
        if (path[2] && method === "PATCH") {
          if (path[3] === "remit")
            return json(await remitCollection(path[2], await body(), actor));
          if (path[3] === "payment")
            return json(
              await confirmOrderPayment(path[2], await body(), actor),
            );
          if (!path[3])
            return json(await updateCollection(path[2], await body(), actor));
        }
        fail("NOT_FOUND", "Không tìm thấy thao tác công nợ.", 404);
      }
      if (
        section === "orders" &&
        path[2] &&
        path[3] === "deliver" &&
        method === "PATCH"
      )
        return json(await deliverOrder(path[2], await body(), actor));
      if (
        section === "streaks" &&
        path[2] === "rules" &&
        ["POST", "PATCH", "DELETE"].includes(method)
      ) {
        const raw = await body();
        const expected = z.number().int().parse(raw.version);
        const id = path[3] ?? token().slice(0, 20);
        const parsed =
          method === "DELETE"
            ? null
            : rewardRuleSchema.parse({ ...raw.rule, id });
        if (parsed?.kind === "monthly" && parsed.threshold > 31)
          fail("INVALID_THRESHOLD", "Mốc tích lũy tháng tối đa 31 ngày.");
        if (
          parsed?.productId &&
          !(await db.product.findUnique({ where: { id: parsed.productId } }))
        )
          fail("INVALID_PRODUCT", "Sản phẩm áp dụng không tồn tại.");
        await db.$transaction(async (tx) => {
          const row = await tx.setting.upsert({
            where: { key: "streak_rules" },
            create: { key: "streak_rules", value: [] },
            update: {},
          });
          const current = rulesSchema.parse(row.value);
          const old = current.find((r) => r.id === id);
          if (path[3] && !old) fail("NOT_FOUND", "Không tìm thấy mốc.", 404);
          if (old && parsed && old.kind !== parsed.kind)
            fail("INVALID_KIND", "Tạo mốc mới để đổi loại tiến độ.");
          const next = old
            ? current.map((r) =>
                r.id === id ? (parsed ?? { ...r, active: false }) : r,
              )
            : [...current, parsed!];
          rulesSchema.parse(next);
          const changed = await tx.setting.updateMany({
            where: { key: "streak_rules", version: expected },
            data: { value: next, version: { increment: 1 } },
          });
          if (!changed.count)
            fail(
              "STALE_SETTINGS",
              "Mốc đã được chỉnh ở nơi khác. Tải lại trước khi lưu.",
              409,
            );
          await tx.audit.create({
            data: {
              actorId: actor.id,
              action: "streak.rule.publish",
              entityId: id,
              detail: { version: expected + 1, rules: next },
            },
          });
        });
        return json({ success: true });
      }
      if (section === "customers" && path[2] && method === "PATCH") {
        const input = z
          .object({
            name: z.string().trim().min(2).max(100),
            phone: z.string().max(20),
            disabled: z.boolean(),
            reason: z.string().min(4).max(300),
          })
          .parse(await body());
        const target = await db.user.findUniqueOrThrow({
          where: { id: path[2] },
        });
        if (
          (target.role === "OWNER" && actor.role !== "OWNER") ||
          (target.id === actor.id && input.disabled)
        )
          fail("FORBIDDEN", "Không thể khóa tài khoản này.", 403);
        await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: target.id },
            data: {
              name: input.name,
              phone: input.phone,
              disabled: input.disabled,
            },
          });
          if (input.disabled)
            await tx.session.deleteMany({ where: { userId: target.id } });
          await tx.audit.create({
            data: {
              actorId: actor.id,
              action: "customer.update",
              entityId: target.id,
              detail: input,
            },
          });
        });
        return json({ success: true });
      }
      if (section === "reviews" && path[2] && method === "PATCH") {
        const input = z
          .object({ status: z.enum(["APPROVED", "REJECTED"]) })
          .parse(await body());
        await db.review.update({ where: { id: path[2] }, data: input });
        await db.audit.create({
          data: {
            actorId: actor.id,
            action: "review.moderate",
            entityId: path[2],
            detail: input,
          },
        });
        return json({ success: true });
      }
      if (
        section === "taxonomies" &&
        ["POST", "PATCH", "DELETE"].includes(method)
      ) {
        if (method === "DELETE") {
          await hideCatalogTaxonomy(actor, path[2]);
          return json({ success: true });
        }
        return json(await saveCatalogTaxonomy(actor, path[2], await body()));
      }

      if (
        section === "orders" &&
        path[2] &&
        path[3] === "delivery" &&
        method === "PATCH"
      ) {
        if (!["OWNER", "MANAGER"].includes(actor.role))
          fail("FORBIDDEN", "Chỉ quản lý được đổi lịch đã hẹn.", 403);
        const input = z
          .object({
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            slotId: z.string(),
            version: z.number().int(),
            customerAgreed: z.literal(true),
            reason: z.string().min(4).max(300),
          })
          .parse(await body());
        const settings = await getSettings();
        await atomic(async (tx) => {
          await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${path[2]} FOR UPDATE`;
          const order = await tx.order.findUniqueOrThrow({
            where: { id: path[2] },
          });
          if (order.version !== input.version)
            fail(
              "STALE_ORDER_VERSION",
              "Đơn đã thay đổi. Vui lòng mở lại.",
              409,
            );
          if (
            ["COMPLETED", ...stoppedOrderStatuses].includes(order.status) ||
            ["OUT_FOR_DELIVERY", "DELIVERED"].includes(order.fulfillment)
          )
            fail("CANNOT_RESCHEDULE", "Đơn đã kết thúc hoặc đang giao.");
          const slot = await tx.deliverySlot.findUnique({
            where: { id: input.slotId },
          });
          if (
            !slot?.active ||
            settings.blackoutDates.includes(input.day) ||
            dayKey(localInstant(input.day)) !== input.day ||
            localInstant(input.day, slot.startHour).getTime() <
              Date.now() + settings.minimumLeadHours * 3600000
          )
            fail("INVALID_DELIVERY", "Khung giờ không khả dụng.");
          if (
            order.deliveryDay !== input.day ||
            order.slotId !== input.slotId
          ) {
            await tx.slotBooking.upsert({
              where: { day_slotId: { day: input.day, slotId: slot.id } },
              create: { day: input.day, slotId: slot.id },
              update: {},
            });
            if (
              !(await tx.$executeRaw`UPDATE SlotBooking SET count=count+1 WHERE day=${input.day} AND slotId=${slot.id} AND count<${slot.capacity}`)
            )
              fail("DELIVERY_SLOT_FULL", "Khung giờ đã đầy.", 409);
            await tx.slotBooking.update({
              where: {
                day_slotId: { day: order.deliveryDay, slotId: order.slotId },
              },
              data: { count: { decrement: 1 } },
            });
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              deliveryDay: input.day,
              slotId: slot.id,
              slotLabel: slot.label,
              deliveryStart: localInstant(input.day, slot.startHour),
              deliveryEnd: localInstant(input.day, slot.endHour),
              version: { increment: 1 },
              history: {
                create: {
                  text: `Đổi lịch với sự đồng ý của khách: ${input.reason}`,
                },
              },
            },
          });
          await tx.audit.create({
            data: {
              actorId: actor.id,
              action: "order.reschedule",
              entityId: order.id,
              detail: input,
            },
          });
          await tx.outbox.create({
            data: {
              userId: order.userId,
              event: "order.delivery_changed",
              payload: { orderId: order.id, version: order.version + 1 },
            },
          });
        });
        return json({ success: true });
      }
      if (
        section === "orders" &&
        path[2] &&
        path[3] === "refunds" &&
        method === "POST"
      ) {
        requireAdmin("payments");
        return json(
          await requestOrderRefund(path[2], await body(), actor),
          201,
        );
      }
      if (section === "orders" && path[2] === "staff" && method === "GET")
        return json(
          await db.user.findMany({
            where: {
              disabled: false,
              role: { in: ["OWNER", "MANAGER", "FLORIST", "DELIVERY"] },
            },
            select: { id: true, name: true, role: true },
          }),
        );
      if (
        section === "orders" &&
        path[2] &&
        path[3] === "assign" &&
        method === "PATCH"
      ) {
        if (!["OWNER", "MANAGER"].includes(actor.role))
          fail("FORBIDDEN", "Chỉ quản lý được phân công.", 403);
        const input = z
          .object({ assignee: z.string(), version: z.number().int() })
          .parse(await body());
        const target = input.assignee
          ? await db.user.findFirst({
              where: {
                id: input.assignee,
                disabled: false,
                role: { in: ["OWNER", "MANAGER", "FLORIST", "DELIVERY"] },
              },
            })
          : null;
        if (input.assignee && !target)
          fail("INVALID_ASSIGNEE", "Nhân viên không hợp lệ.");
        await db.$transaction(async (tx) => {
          const changed = await tx.order.updateMany({
            where: {
              id: path[2],
              version: input.version,
              status: { notIn: ["COMPLETED", ...stoppedOrderStatuses] },
            },
            data: { assignee: input.assignee, version: { increment: 1 } },
          });
          if (!changed.count)
            fail("STALE_ORDER_VERSION", "Đơn đã thay đổi hoặc kết thúc.", 409);
          await tx.audit.create({
            data: {
              actorId: actor.id,
              action: "order.assign",
              entityId: path[2],
              detail: { assignee: input.assignee },
            },
          });
          const order = await tx.order.findUniqueOrThrow({
            where: { id: path[2] },
          });
          await tx.outbox.create({
            data: {
              userId: order.userId,
              event: "order.status_changed",
              payload: { orderId: order.id, version: order.version },
            },
          });
        });
        return json({ success: true });
      }
      if (section === "orders" && path[2] && method === "PATCH") {
        const input = z
          .object({
            action: z.enum([
              "CONFIRM",
              "PREPARE",
              "READY",
              "DISPATCH",
              "DELIVER",
              "CANCEL",
            ]),
            version: z.number().int(),
          })
          .parse(await body());
        return json(
          await transitionOrder(path[2], input.action, input.version, actor),
        );
      }
      if (method === "GET") {
        if (["orders", "calendar", "overview", "analytics"].includes(section))
          await expireReservations();
        if (section === "taxonomies")
          return json(await db.taxonomy.findMany({ orderBy: { kind: "asc" } }));
        if (section === "reviews")
          return json(
            await db.review.findMany({
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          );
        if (section === "overview" || section === "analytics") {
          const [orders, users, products, rewards, payments] =
            await Promise.all([
              db.order.findMany({
                orderBy: { createdAt: "desc" },
                take: 200,
                include: { items: true, refunds: true, receipt: true },
              }),
              db.user.count(),
              db.product.count({ where: { active: true } }),
              db.reward.count(),
              db.payment.count({ where: { state: "REVIEW" } }),
            ]);
          const daily = await dailyFinancialSummary();
          const paid = orders.filter(
            (o) =>
              !o.dailyPlanId &&
              ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
                o.paymentStatus,
              ),
          );
          return json({
            orders: orders.map((o) => ({
              id: o.id,
              code: o.code,
              buyerName: o.buyerName,
              deliveryDay: o.deliveryDay,
              total: o.total,
              netPaid:
                !o.dailyPlanId &&
                ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
                  o.paymentStatus,
                )
                  ? (o.receipt?.destination === "SHIPPER" &&
                    !o.receipt.remittedAt
                      ? 0
                      : o.total) -
                    o.refunds
                      .filter((r) => r.status === "COMPLETED")
                      .reduce((s, r) => s + r.amount, 0)
                  : 0,
              status: o.status,
              fulfillment: o.fulfillment,
              paymentStatus: o.paymentStatus,
              createdAt: o.createdAt,
              items: o.items.map((i) => ({
                name: i.name,
                quantity: i.quantity,
                image: i.image,
              })),
            })),
            users,
            products,
            rewards,
            paymentReviews: payments,
            daily,
            revenue: paid.reduce(
              (s, o) =>
                s +
                (o.receipt?.destination === "SHIPPER" && !o.receipt.remittedAt
                  ? 0
                  : o.total) -
                o.refunds
                  .filter((r) => r.status === "COMPLETED")
                  .reduce((a, r) => a + r.amount, 0),
              0,
            ),
            discount: paid.reduce((s, o) => s + o.discount, 0),
            today: dayKey(),
            reportScope: "200 đơn gần nhất, tiền gói Daily báo riêng",
            analyticsEnabled: analyticsEnabled(),
          });
        }
        if (section === "orders" || section === "calendar") {
          const page = Math.max(
            1,
            Number(req.nextUrl.searchParams.get("page")) || 1,
          );
          const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? "";
          const where: Prisma.OrderWhereInput = q
            ? {
                OR: [{ code: { contains: q } }, { buyerName: { contains: q } }],
              }
            : {};
          if (section === "calendar") {
            const from =
              req.nextUrl.searchParams.get("from") ?? `${monthKey()}-01`;
            const to =
              req.nextUrl.searchParams.get("to") ??
              dayKey(new Date(Date.now() + 60 * 86400000));
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
              !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
              from > to
            )
              fail("INVALID_RANGE", "Khoảng ngày không hợp lệ.");
            where.deliveryDay = { gte: from, lt: to };
          }
          const [rows, total] = await Promise.all([
            db.order.findMany({
              where,
              take: section === "calendar" ? 1000 : 50,
              skip: section === "calendar" ? 0 : (page - 1) * 50,
              orderBy:
                section === "calendar"
                  ? { createdAt: "desc" }
                  : [{ updatedAt: "desc" }, { id: "desc" }],
              include: {
                items: true,
                history: true,
                receivable: true,
                refunds: { select: { amount: true, status: true } },
              },
            }),
            db.order.count({ where }),
          ]);
          return json({
            rows: rows.map((o) => ({
              ...o,
              receivable: ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
                actor.role,
              )
                ? o.receivable
                : undefined,
              guestHash: undefined,
              idempotencyKey: undefined,
              refunds: undefined,
              refundPendingAmount: o.refunds
                .filter((r) => r.status === "PENDING")
                .reduce((sum, r) => sum + r.amount, 0),
              refundedAmount: o.refunds
                .filter((r) => r.status === "COMPLETED")
                .reduce((sum, r) => sum + r.amount, 0),
              buyerEmail: actor.role === "DELIVERY" ? undefined : o.buyerEmail,
              cardMessage:
                actor.role === "DELIVERY" ? undefined : o.cardMessage,
              address: actor.role === "FLORIST" ? undefined : o.address,
              recipientPhone:
                actor.role === "FLORIST" ? undefined : o.recipientPhone,
            })),
            total,
            page,
          });
        }
        if (section === "products" || section === "inventory")
          return json(await listCatalogProducts(actor));
        if (section === "customers" || section === "members")
          return json(
            await db.user.findMany({
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                verified: true,
                disabled: true,
                memberSince: true,
                tier: true,
                createdAt: true,
                _count: { select: { orders: true } },
                periods: { where: { month: monthKey() } },
              },
              take: 100,
              orderBy: { createdAt: "desc" },
            }),
          );
        if (section === "streaks") {
          const [days, rewards, grants, budget] = await Promise.all([
            db.activeDay.findMany({
              take: 100,
              orderBy: { createdAt: "desc" },
              include: { user: { select: { name: true, email: true } } },
            }),
            db.reward.findMany({
              take: 100,
              include: { user: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
            }),
            db.qrGrant.count(),
            db.setting.findUnique({ where: { key: "reward_budget" } }),
          ]);
          const rules = await getRewardRules();
          return json({
            days,
            rewards,
            grants,
            budget: budget?.value,
            customRules: rules.rules,
            rulesVersion: rules.version,
          });
        }
        if (section === "payments")
          return json({
            payments: await db.payment.findMany({
              take: 100,
              orderBy: { receivedAt: "desc" },
              include: {
                order: { select: { code: true, dailyPlanId: true } },
                dailyInvoice: { select: { code: true, planId: true } },
              },
            }),
            refunds: await db.refund.findMany({
              take: 100,
              orderBy: { createdAt: "desc" },
              include: { order: { select: { code: true, dailyPlanId: true } } },
            }),
            configured: (await getSepayConfig()).configured,
          });
        if (section === "delivery")
          return json({
            zones: await db.deliveryZone.findMany(),
            slots: await db.deliverySlot.findMany({
              orderBy: { startHour: "asc" },
            }),
            bookings: await db.slotBooking.findMany({
              where: { day: { gte: dayKey() } },
              take: 100,
            }),
          });
        if (section === "vouchers")
          return json(
            await db.voucher.findMany({ orderBy: { expiresAt: "desc" } }),
          );
        if (section === "content")
          return json(
            await db.content.findMany({
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          );
        if (section === "settings")
          return json({
            settings: await getSettings(),
            version:
              (await db.setting.findUnique({ where: { key: "shop" } }))
                ?.version ?? 1,
          });
        if (section === "team")
          return json(
            await db.user.findMany({
              where: { role: { not: "CUSTOMER" } },
              select: { id: true, name: true, email: true, role: true },
            }),
          );
        if (section === "audit")
          return json(
            await db.audit.findMany({
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          );
        if (section === "jobs")
          return json({
            jobs: await db.jobRun.findMany({
              orderBy: { createdAt: "desc" },
              take: 30,
            }),
            unsent: await db.outbox.count({ where: { sent: false } }),
          });
      }
      if (section === "jobs" && path[2] && method === "POST") {
        const changed = await db.jobRun.updateMany({
          where: { id: path[2], status: "FAILED" },
          data: { status: "QUEUED", attempts: 0, availableAt: new Date() },
        });
        if (!changed.count)
          fail("JOB_NOT_FAILED", "Chỉ thử lại tác vụ đã thất bại.");
        await db.audit.create({
          data: {
            actorId: actor.id,
            action: "job.retry",
            entityId: path[2],
            detail: {},
          },
        });
        return json({ success: true });
      }
      if (section === "settings" && method === "PATCH") {
        const input = z
          .object({ settings: settingsSchema, version: z.number().int() })
          .parse(await body());
        await db.$transaction(async (tx) => {
          await assertShopShippingAddress(tx, input.settings.address);
          const changed = await tx.setting.updateMany({
            where: { key: "shop", version: input.version },
            data: { value: input.settings, version: { increment: 1 } },
          });
          if (!changed.count)
            fail(
              "STALE_SETTINGS",
              "Cấu hình đã thay đổi. Vui lòng tải lại.",
              409,
            );
          await tx.audit.create({
            data: {
              actorId: actor.id,
              action: "settings.publish",
              entityId: "shop",
              detail: { version: input.version + 1, settings: input.settings },
            },
          });
        });
        return json({
          success: true,
          note: "Quota đã mở giữ nguyên; N mới áp dụng các kỳ chưa mở.",
        });
      }
      if (
        section === "products" &&
        path[2] &&
        path[3] === "visibility" &&
        method === "PATCH"
      )
        return json(await setProductVisibility(actor, path[2], await body()));
      if (section === "products" && ["POST", "PATCH"].includes(method))
        return json(await saveCatalogProduct(actor, path[2], await body()));
      if (section === "products" && path[2] && method === "DELETE") {
        await setProductVisibility(actor, path[2], { active: false });
        return json({ success: true });
      }
      if (
        ["vouchers", "content", "delivery"].includes(section) &&
        ["POST", "PATCH", "DELETE"].includes(method)
      ) {
        if (section === "vouchers") {
          if (method === "DELETE") {
            await db.voucher.update({
              where: { id: path[2] },
              data: { active: false },
            });
            return json({ success: true });
          }
          const input = z
            .object({
              code: z.string().regex(/^[A-Z0-9]{3,30}$/),
              title: z.string().min(1).max(150),
              percent: z.number().int().min(1).max(50),
              cap: z.number().int().min(0),
              minimum: z.number().int().min(0),
              limit: z.number().int().min(1),
              active: z.boolean(),
              expiresAt: z.coerce.date(),
            })
            .parse(await body());
          return json(
            path[2]
              ? await db.voucher.update({ where: { id: path[2] }, data: input })
              : await db.voucher.create({ data: input }),
          );
        }
        if (section === "content") {
          if (method === "DELETE") {
            await db.content.update({
              where: { id: path[2] },
              data: { active: false },
            });
            return json({ success: true });
          }
          const input = z
            .object({
              kind: z.enum(["page", "article", "faq", "banner"]),
              slug: z.string().regex(/^[a-z0-9-]+$/),
              title: z.string().min(1).max(200),
              body: z.string().max(20000),
              image: z.string().max(1000),
              active: z.boolean(),
            })
            .parse(await body());
          return json(
            path[2]
              ? await db.content.update({ where: { id: path[2] }, data: input })
              : await db.content.create({ data: input }),
          );
        }
        const data = await body();
        if (data.type === "zone") {
          const input = z
            .object({
              name: z.string().min(1).max(100),
              fee: z.number().int().min(0),
              active: z.boolean(),
            })
            .parse(data);
          return json(
            await atomic(async (tx) => {
              await assertZoneEditable(tx);
              return path[2]
                ? await tx.deliveryZone.update({
                    where: { id: path[2] },
                    data: input,
                  })
                : await tx.deliveryZone.create({ data: input });
            }),
          );
        }
        const input = z
          .object({
            label: z.string().min(1),
            startHour: z.number().int().min(0).max(23),
            endHour: z.number().int().min(1).max(24),
            capacity: z.number().int().min(1).max(1000),
            active: z.boolean(),
          })
          .parse(data);
        if (input.endHour <= input.startHour)
          fail("INVALID_SLOT", "Giờ kết thúc phải sau giờ bắt đầu.");
        return json(
          path[2]
            ? await db.deliverySlot.update({
                where: { id: path[2] },
                data: input,
              })
            : await db.deliverySlot.create({ data: input }),
        );
      }
      if (section === "refunds" && path[2] && method === "PATCH") {
        requireAdmin("payments");
        const input = z
          .object({ reference: z.string().trim().min(4).max(100) })
          .parse(await body());
        await completeOrderRefund(path[2], input.reference, actor);
        return json({ success: true });
      }
      if (section === "team" && method === "POST") {
        const input = z
          .object({
            email: z.email(),
            role: z.enum([
              "MANAGER",
              "FLORIST",
              "DELIVERY",
              "MARKETING",
              "ACCOUNTANT",
              "CUSTOMER",
            ]),
          })
          .parse(await body());
        if (actor.role !== "OWNER")
          fail("FORBIDDEN", "Chỉ chủ cửa hàng được đổi quyền.", 403);
        const target = await db.user.findUnique({
          where: { email: input.email.toLowerCase() },
        });
        if (!target || target.role === "OWNER")
          fail("INVALID_USER", "Tài khoản không hợp lệ.");
        await db.user.update({
          where: { id: target.id },
          data: { role: input.role },
        });
        await db.session.deleteMany({ where: { userId: target.id } });
        await db.audit.create({
          data: {
            actorId: actor.id,
            action: "user.role",
            entityId: target.id,
            detail: input,
          },
        });
        return json({ success: true });
      }
    }
    fail("NOT_FOUND", "Không tìm thấy chức năng.", 404);
  });
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
