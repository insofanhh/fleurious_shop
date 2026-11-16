import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import { fail } from "./errors";
import { hash } from "./security";
import { can } from "./auth-policy";
import { defaultSettings } from "./settings";
import {
  goongConfigured,
  goongAutocomplete,
  goongDetail,
  goongDistance,
  goongRouteProfile,
  GOONG_ROUTING_REVISION,
} from "./goong";
import type {
  ShippingPoint,
  ShippingPublic,
  ShippingSnapshot,
  ShippingQuoteView,
} from "./shipping-types";

const pointSchema = z.object({
  placeId: z.string().min(1).max(2048),
  address: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const policySchema = z.object({
  mode: z.literal("DISTANCE").default("DISTANCE"),
  origin: pointSchema.nullable().default(null),
  ratePerKm: z.number().int().min(0).max(1000000).nullable().default(null),
  vehicle: z.enum(["motorcycle", "car"]).default("motorcycle"),
  maxDistanceMeters: z
    .number()
    .int()
    .positive()
    .max(3000000)
    .nullable()
    .default(null),
  roundingStep: z.union([z.literal(1), z.literal(1000)]).default(1),
  minimumFee: z.number().int().min(0).max(100000000).default(0),
  maximumFee: z.number().int().min(0).max(100000000).nullable().default(null),
  allowManual: z.boolean().default(true),
});
type Client = Tx | typeof db;
export async function getShippingPolicy(client: Client = db) {
  const row = await client.setting.findUnique({
    where: { key: "delivery_policy" },
  });
  return {
    // Stored zone policies belong to the former checkout. All new quotes use
    // distance pricing; historical orders retain their own zone and fee.
    ...policySchema.parse({
      ...((row?.value as object) ?? {}),
      mode: "DISTANCE",
    }),
    version: row?.version ?? 0,
  };
}
async function guard(tx: Tx) {
  // A no-op upsert takes an exclusive lock immediately. INSERT IGNORE followed
  // by FOR UPDATE upgrades shared duplicate-key locks and deadlocks under load.
  await tx.$executeRaw`INSERT INTO Setting (\`key\`, value, version, updatedAt) VALUES ('delivery_guard', '{}', 1, NOW(3)) ON DUPLICATE KEY UPDATE \`key\` = \`key\``;
  await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='delivery_guard' FOR UPDATE`;
}
export async function assertZoneEditable(_tx: Tx) {
  fail(
    "ZONE_ARCHIVED",
    "Khu vực giao cũ đã ngừng sử dụng. Đơn mới tính phí theo quãng đường Goong.",
    409,
  );
}
export async function shippingPublic(
  client: Client = db,
): Promise<ShippingPublic> {
  const p = await getShippingPolicy(client);
  return {
    mode: p.mode,
    configured: goongConfigured(),
    version: p.version,
    allowManual: p.allowManual,
  };
}
function requireSettings(actor: { role: string }) {
  if (!can(actor.role, "settings"))
    fail("FORBIDDEN", "Bạn không có quyền cài đặt giao hàng.", 403);
}
export async function shippingAdminView(actor: { role: string }) {
  requireSettings(actor);
  const [policy, shop] = await Promise.all([
    getShippingPolicy(),
    db.setting.findUnique({ where: { key: "shop" } }),
  ]);
  return {
    ...policy,
    configured: goongConfigured(),
    displayAddress: String(
      (shop?.value as Record<string, unknown>)?.address ??
        defaultSettings.address,
    ),
  };
}
export async function shippingSuggestions(raw: unknown) {
  const { query } = z
    .object({ query: z.string().trim().min(4).max(200) })
    .parse(raw);
  return goongAutocomplete(query, (await getShippingPolicy()).origin);
}
export async function resolveShippingLocation(
  owner: string,
  raw: unknown,
  userId?: string,
) {
  const input = z
    .object({
      placeId: z.string().min(1).max(2048).optional(),
      savedAddressId: z.string().max(100).optional(),
    })
    .parse(raw);
  let placeId = input.placeId;
  if (input.savedAddressId) {
    const saved = userId
      ? await db.address.findFirst({
          where: { id: input.savedAddressId, userId },
        })
      : null;
    if (!saved)
      fail("ADDRESS_NOT_FOUND", "Không tìm thấy địa chỉ đã lưu.", 404);
    if (!saved.placeId)
      fail(
        "ADDRESS_NEEDS_CONFIRMATION",
        "Địa chỉ cũ cần được chọn lại từ gợi ý để tính quãng đường.",
        422,
      );
    placeId = saved.placeId;
  }
  if (!placeId) fail("ADDRESS_REQUIRED", "Vui lòng chọn một địa điểm.");
  const point = await goongDetail(placeId);
  const row = await db.shippingLocation.create({
    data: {
      owner,
      placeId: point.placeId,
      address: point.address,
      latitude: point.lat,
      longitude: point.lng,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { id: row.id, ...point };
}
export async function selectedLocation(
  id: string,
  owner: string,
  client: Client = db,
): Promise<ShippingPoint> {
  const row = await client.shippingLocation.findFirst({
    where: { id, owner, expiresAt: { gt: new Date() } },
  });
  if (!row)
    fail(
      "ADDRESS_NEEDS_CONFIRMATION",
      "Địa điểm chưa được xác nhận hoặc đã hết hiệu lực. Hãy chọn lại địa chỉ.",
      422,
    );
  return {
    placeId: row.placeId,
    address: row.address,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
  };
}
export async function saveShippingPolicy(
  actor: { id: string; role: string },
  raw: unknown,
) {
  requireSettings(actor);
  const input = policySchema
    .omit({ origin: true })
    .extend({
      version: z.number().int().min(0),
      originLocationId: z.string().optional(),
      displayAddress: z.string().trim().min(1).max(500),
    })
    .parse(raw);
  validateFeeBounds(input.minimumFee, input.maximumFee);
  const prior = await getShippingPolicy();
  let origin = input.originLocationId
    ? await selectedLocation(input.originLocationId, `user:${actor.id}`)
    : prior.origin?.address === input.displayAddress
      ? prior.origin
      : null;
  if (input.mode === "DISTANCE") {
    if (!goongConfigured())
      fail(
        "GOONG_NOT_CONFIGURED",
        "Cần cấu hình GOONG_API_KEY trước khi bật tính phí theo quãng đường.",
        503,
      );
    if (!origin || input.ratePerKm === null)
      fail(
        "SHIPPING_NOT_READY",
        "Chọn địa điểm cửa hàng và nhập đơn giá trước khi bật tính phí theo quãng đường.",
      );
    origin = await goongDetail(origin.placeId);
  }
  const policy = policySchema.parse({ ...input, origin });
  return atomic(async (tx) => {
    await guard(tx);
    const current = await getShippingPolicy(tx);
    if (current.version !== input.version)
      fail(
        "STALE_SETTINGS",
        "Cấu hình giao hàng đã thay đổi. Hãy tải lại.",
        409,
      );
    const row = await tx.setting.upsert({
      where: { key: "delivery_policy" },
      create: { key: "delivery_policy", value: policy },
      update: { value: policy, version: { increment: 1 } },
    });
    const shop = await tx.setting.findUnique({ where: { key: "shop" } });
    const address = origin?.address ?? input.displayAddress;
    await tx.setting.upsert({
      where: { key: "shop" },
      create: { key: "shop", value: { ...defaultSettings, address } },
      update: {
        value: {
          ...defaultSettings,
          ...((shop?.value as object) ?? {}),
          address,
        },
        version: { increment: 1 },
      },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "shipping.settings",
        entityId: "delivery_policy",
        detail: { ...policy, version: row.version },
      },
    });
    await tx.outbox.create({
      data: {
        event: "catalog.changed",
        payload: { shippingVersion: row.version },
      },
    });
    return { success: true, version: row.version };
  });
}
export async function assertShopShippingAddress(client: Tx, address: string) {
  await guard(client);
  const p = await getShippingPolicy(client);
  if (p.origin && address !== p.origin.address)
    fail(
      "SHIPPING_ORIGIN_LOCKED",
      "Đổi địa chỉ cửa hàng tại mục Giao hoa theo quãng đường để cập nhật đúng vị trí xuất phát.",
      409,
    );
}
function validateFeeBounds(minimumFee: number, maximumFee: number | null) {
  if (maximumFee === null) return;
  if (!Number.isSafeInteger(maximumFee) || maximumFee < 0)
    fail("INVALID_SHIPPING", "Phí tối đa phải là số nguyên không âm.");
  if (maximumFee < minimumFee)
    fail(
      "INVALID_SHIPPING",
      "Phí tối đa phải lớn hơn hoặc bằng phí tối thiểu.",
    );
}
export function calculateShippingFee(
  distanceMeters: number,
  ratePerKm: number,
  minimumFee = 0,
  roundingStep = 1,
  maximumFee: number | null = null,
) {
  for (const n of [distanceMeters, ratePerKm, minimumFee])
    if (!Number.isSafeInteger(n) || n < 0)
      fail("INVALID_SHIPPING", "Dữ liệu tính phí giao không hợp lệ.");
  if (![1, 1000].includes(roundingStep))
    fail("INVALID_SHIPPING", "Quy tắc làm tròn không hợp lệ.");
  validateFeeBounds(minimumFee, maximumFee);
  const numerator = BigInt(distanceMeters) * BigInt(ratePerKm);
  const minimum = BigInt(minimumFee) * 1000n;
  const amount = numerator > minimum ? numerator : minimum;
  const rounded =
    roundingStep === 1
      ? (amount + 500n) / 1000n
      : ((amount + 999999n) / 1000000n) * 1000n;
  const fee =
    maximumFee !== null && rounded > BigInt(maximumFee)
      ? BigInt(maximumFee)
      : rounded;
  if (fee > 2000000000n)
    fail(
      "INVALID_SHIPPING",
      "Phí giao vượt giới hạn. Vui lòng liên hệ cửa hàng.",
    );
  return Number(fee);
}
function quoteView(row: {
  id: string;
  fee: number;
  snapshot: Prisma.JsonValue;
  expiresAt: Date;
}): ShippingQuoteView {
  const snapshot = row.snapshot as unknown as ShippingSnapshot;
  return {
    id: row.id,
    fee: row.fee,
    distanceMeters: snapshot.distanceMeters,
    ratePerKm: snapshot.ratePerKm,
    expiresAt: row.expiresAt.toISOString(),
    serverNow: new Date().toISOString(),
  };
}
export async function createShippingQuote(owner: string, raw: unknown) {
  const { locationId } = z
    .object({ locationId: z.string().min(1).max(100) })
    .parse(raw);
  const [destination, p] = await Promise.all([
    selectedLocation(locationId, owner),
    getShippingPolicy(),
  ]);
  if (p.mode !== "DISTANCE" || !p.origin || p.ratePerKm === null)
    fail(
      "SHIPPING_NOT_READY",
      "Cửa hàng chưa bật tính phí theo quãng đường.",
      409,
    );
  const destinationKey = hash(JSON.stringify(destination));
  const reused = await db.shippingQuote.findFirst({
    where: {
      owner,
      destinationKey,
      policyVersion: p.version,
      snapshot: { path: "$.routingRevision", equals: GOONG_ROUTING_REVISION },
      expiresAt: { gt: new Date(Date.now() + 5000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (reused) return quoteView(reused);
  const routeKey = hash(
    JSON.stringify([
      p.origin,
      destination,
      goongRouteProfile(p.vehicle),
      GOONG_ROUTING_REVISION,
    ]),
  );
  const cached =
    process.env.GOONG_ROUTE_CACHE_ENABLED === "true"
      ? await db.shippingRouteCache.findFirst({
          where: { key: routeKey, expiresAt: { gt: new Date() } },
        })
      : null;
  const route = cached
    ? {
        distanceMeters: cached.distanceMeters,
        durationSeconds: cached.durationSeconds,
      }
    : await goongDistance(p.origin, destination, p.vehicle);
  if (
    p.maxDistanceMeters !== null &&
    route.distanceMeters > p.maxDistanceMeters
  )
    fail(
      "DELIVERY_OUT_OF_RANGE",
      `Địa chỉ cách cửa hàng khoảng ${(route.distanceMeters / 1000).toFixed(2)} km, vượt giới hạn ${p.maxDistanceMeters / 1000} km. Vui lòng liên hệ cửa hàng.`,
      422,
    );
  if (!cached && process.env.GOONG_ROUTE_CACHE_ENABLED === "true")
    await db.shippingRouteCache.upsert({
      where: { key: routeKey },
      create: {
        key: routeKey,
        ...route,
        expiresAt: new Date(Date.now() + 300000),
      },
      update: { ...route, expiresAt: new Date(Date.now() + 300000) },
    });
  if ((await getShippingPolicy()).version !== p.version)
    fail(
      "SHIPPING_POLICY_CHANGED",
      "Biểu phí vừa thay đổi. Vui lòng tính lại.",
      409,
    );
  const fee = calculateShippingFee(
    route.distanceMeters,
    p.ratePerKm,
    p.minimumFee,
    p.roundingStep,
    p.maximumFee,
  );
  const snapshot: ShippingSnapshot = {
    method: "DISTANCE",
    origin: p.origin,
    destination,
    ...route,
    vehicle: p.vehicle,
    providerVehicle: goongRouteProfile(p.vehicle),
    routingRevision: GOONG_ROUTING_REVISION,
    ratePerKm: p.ratePerKm,
    minimumFee: p.minimumFee,
    maximumFee: p.maximumFee,
    roundingStep: p.roundingStep,
    fee,
    policyVersion: p.version,
  };
  return quoteView(
    await db.shippingQuote.create({
      data: {
        owner,
        destinationKey,
        policyVersion: p.version,
        fee,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 600000),
      },
    }),
  );
}
export const manualShippingSchema = z.object({
  fee: z.number().int().min(0).max(100000000),
  reason: z.string().trim().min(4).max(300),
});
export type ShippingInput = {
  zoneId?: string | null;
  shippingQuoteId?: string;
  locationId?: string;
  address?: string;
  addressDetails?: string;
  manualShipping?: z.infer<typeof manualShippingSchema>;
};
export async function orderShipping(
  input: ShippingInput,
  owner: string | undefined,
  client: Client,
  options: { lock?: boolean; allowManual?: boolean } = {},
) {
  if (options.lock) await guard(client as Tx);
  const p = await getShippingPolicy(client);
  if (input.manualShipping) {
    if (!options.allowManual || !p.allowManual || !owner)
      fail(
        "FORBIDDEN",
        "Bạn không có quyền nhập phí giao theo thỏa thuận.",
        403,
      );
    const manual = manualShippingSchema.parse(input.manualShipping);
    if (!input.address?.trim())
      fail("ADDRESS_REQUIRED", "Nhập địa chỉ nhận hoa cho đơn thỏa thuận.");
    const destination = input.locationId
      ? await selectedLocation(input.locationId, owner, client)
      : null;
    const reference =
      input.shippingQuoteId && destination
        ? await client.shippingQuote.findFirst({
            where: {
              id: input.shippingQuoteId,
              owner,
              policyVersion: p.version,
              snapshot: {
                path: "$.routingRevision",
                equals: GOONG_ROUTING_REVISION,
              },
              destinationKey: hash(JSON.stringify(destination)),
              expiresAt: { gt: new Date() },
            },
          })
        : null;
    const snapshot: ShippingSnapshot = {
      method: "MANUAL",
      ...(!destination ? { freeformAddress: input.address.trim() } : {}),
      origin: p.origin,
      destination,
      distanceMeters: null,
      durationSeconds: null,
      vehicle: p.vehicle,
      ratePerKm: null,
      roundingStep: 1,
      minimumFee: 0,
      maximumFee: null,
      fee: manual.fee,
      reason: manual.reason,
      actor: owner,
      policyVersion: p.version,
      ...(reference
        ? {
            automaticReference: {
              quoteId: reference.id,
              fee: reference.fee,
              distanceMeters: (
                reference.snapshot as unknown as ShippingSnapshot
              ).distanceMeters,
            },
          }
        : {}),
    };
    return {
      method: "MANUAL" as const,
      fee: manual.fee,
      zoneId: null,
      address: destination
        ? joinAddress(destination.address, input.addressDetails)
        : joinAddress(input.address, input.addressDetails),
      snapshot,
    };
  }
  const row =
    owner && input.shippingQuoteId
      ? await client.shippingQuote.findFirst({
          where: { id: input.shippingQuoteId, owner },
        })
      : null;
  if (!row || row.expiresAt <= new Date())
    fail(
      "SHIPPING_QUOTE_EXPIRED",
      "Phí giao chưa được xác nhận hoặc đã hết hiệu lực. Vui lòng tính lại.",
      409,
    );
  if (row.policyVersion !== p.version)
    fail(
      "SHIPPING_POLICY_CHANGED",
      "Biểu phí vừa thay đổi. Vui lòng xem lại phí giao.",
      409,
    );
  const snapshot = row.snapshot as unknown as ShippingSnapshot;
  if (
    snapshot.routingRevision !== GOONG_ROUTING_REVISION ||
    snapshot.providerVehicle !== goongRouteProfile(p.vehicle)
  )
    fail(
      "SHIPPING_ROUTE_CHANGED",
      "Cách tính tuyến giao vừa được cập nhật. Vui lòng tính lại phí giao.",
      409,
    );
  if (!snapshot.destination || !input.locationId || !owner)
    fail("ADDRESS_NEEDS_CONFIRMATION", "Vui lòng xác nhận lại địa chỉ.", 422);
  const destination = await selectedLocation(input.locationId, owner, client);
  if (hash(JSON.stringify(destination)) !== row.destinationKey)
    fail(
      "SHIPPING_ADDRESS_CHANGED",
      "Địa chỉ đã đổi. Vui lòng tính lại phí giao.",
      409,
    );
  return {
    method: "DISTANCE" as const,
    fee: row.fee,
    zoneId: null,
    address: joinAddress(snapshot.destination.address, input.addressDetails),
    snapshot,
  };
}
export function joinAddress(address: string, details?: string) {
  return `${address}${details?.trim() ? ` · ${details.trim()}` : ""}`;
}
export async function savedAddressFields(owner: string, raw: unknown) {
  const input = z
    .object({
      address: z.string().min(8).max(800),
      zoneId: z.string().nullable().optional(),
      locationId: z.string().optional(),
      addressDetails: z.string().max(200).default(""),
    })
    .parse(raw);
  if (input.locationId) {
    const point = await selectedLocation(input.locationId, owner);
    return {
      address: joinAddress(point.address, input.addressDetails),
      zoneId: null,
      placeId: point.placeId,
      formattedAddress: point.address,
      addressDetails: input.addressDetails,
      latitude: point.lat,
      longitude: point.lng,
      verifiedAt: new Date(),
    };
  }
  fail(
    "ADDRESS_NEEDS_CONFIRMATION",
    "Hãy chọn địa chỉ từ gợi ý trước khi lưu.",
    422,
  );
}
