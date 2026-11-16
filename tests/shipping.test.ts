import "dotenv/config";
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "../src/lib/db";
import { AppError } from "../src/lib/errors";
import { defaultSettings } from "../src/lib/settings";
import { dayKey, shiftDay } from "../src/lib/time";
import { atomic } from "../src/lib/transaction";
import {
  goongAutocomplete,
  goongDetail,
  goongDistance,
  GOONG_ROUTING_REVISION,
} from "../src/lib/goong";
import {
  calculateShippingFee,
  resolveShippingLocation,
  selectedLocation,
  saveShippingPolicy,
  shippingAdminView,
  shippingPublic,
  getShippingPolicy,
  createShippingQuote,
  orderShipping,
  savedAddressFields,
  assertZoneEditable,
} from "../src/lib/shipping";
import {
  createOrder,
  checkoutSchema,
  quote,
  receiveSepay,
} from "../src/lib/commerce";
import { createAdminOrder, quoteAdminOrder } from "../src/lib/admin-orders";
import { getOrderPaymentQr } from "../src/lib/order-payment-qr";
import { trackOrder } from "../src/lib/order-tracking";
import { prepareReorder } from "../src/lib/order-reorder";
import { customerOrder } from "../src/lib/order-privacy";
import type { ShippingSnapshot } from "../src/lib/shipping-types";

const run = `ship-${randomUUID().slice(0, 8)}`;
let admin: User, buyer: User, variantId: string;
const origin = {
  placeId: "shop",
  address: "Cửa hàng, Hà Nội",
  lat: 21.0285,
  lng: 105.8542,
};
const destination = {
  placeId: "home",
  address: "Nhà khách, Hà Nội",
  lat: 21.0351,
  lng: 105.8301,
};
const points = [
  origin,
  destination,
  {
    ...destination,
    placeId: "other",
    address: "Địa chỉ khác, Hà Nội",
    lat: 21.0451,
  },
];
const policy = {
  mode: "DISTANCE",
  origin,
  ratePerKm: 5000,
  vehicle: "motorcycle",
  maxDistanceMeters: null,
  roundingStep: 1,
  minimumFee: 0,
  allowManual: true,
};
const realFetch = global.fetch;
const previousKey = process.env.GOONG_API_KEY;
const previousCache = process.env.GOONG_ROUTE_CACHE_ENABLED;
let distance = 4750,
  duration = 900,
  routeStatus = "OK",
  httpStatus = 200,
  detailInvalid = false;
let calls: URL[] = [];
const rejectCode = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;
const owner = () => `user:${buyer.id}`;
async function resetPolicy(extra: Record<string, unknown> = {}) {
  await db.setting.upsert({
    where: { key: "delivery_policy" },
    create: {
      key: "delivery_policy",
      version: 42,
      value: { ...policy, ...extra },
    },
    update: { version: 42, value: { ...policy, ...extra } },
  });
}
async function location(who = owner(), placeId = "home") {
  return resolveShippingLocation(who, { placeId, lat: 0, lng: 0 });
}
async function priced(who = owner()) {
  const point = await location(who);
  const shipping = await createShippingQuote(who, {
    locationId: point.id,
    fee: 1,
  });
  return { point, shipping };
}
function input(
  pointId: string,
  quoteId: string,
  extra: Record<string, unknown> = {},
) {
  return checkoutSchema.parse({
    items: [{ variantId, quantity: 1 }],
    buyerName: "Người đặt hoa",
    buyerEmail: "shipping@example.test",
    recipientName: "Người nhận hoa",
    recipientPhone: "0900000000",
    address: "Địa chỉ browser đã sửa",
    addressDetails: "Căn 501",
    locationId: pointId,
    shippingQuoteId: quoteId,
    zoneId: `${run}-zone`,
    deliveryDay: shiftDay(dayKey(), 1),
    slotId: `${run}-slot`,
    cardMessage: "",
    note: "Shipping test",
    paymentMethod: "COD",
    useMember: false,
    idempotencyKey: randomUUID(),
    expectedTotal: 523750,
    ...extra,
  });
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  process.env.GOONG_API_KEY = "test-only-never-real";
  process.env.GOONG_ROUTE_CACHE_ENABLED = "false";
  process.env.SEPAY_ACCOUNT_NUMBER = "TESTACCOUNT";
  process.env.SEPAY_BANK = "TESTBANK";
  process.env.SEPAY_WEBHOOK_KEY = "test-only-webhook-key";
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://rsapi.goong.io");
    assert.equal(u.searchParams.get("api_key"), "test-only-never-real");
    assert.equal(init?.cache, "no-store");
    calls.push(u);
    if (
      u.pathname.endsWith("distancematrix") &&
      u.searchParams.get("vehicle") === "motorcycle"
    )
      return new Response(
        "Query deserialize error: unknown variant `motorcycle`, expected one of `car`, `bike`, `truck`, `taxi`, `hd`",
        { status: 400 },
      );
    if (httpStatus === 400)
      return new Response("Invalid request with api_key=test-only-never-real", {
        status: 400,
      });
    let body: unknown;
    if (u.pathname.endsWith("place/autocomplete"))
      body = {
        status: "OK",
        predictions: [{ place_id: "home", description: destination.address }],
      };
    else if (u.pathname.endsWith("place/detail")) {
      const point = points.find(
        (p) => p.placeId === u.searchParams.get("place_id"),
      )!;
      body = {
        status: "OK",
        result: {
          place_id: point.placeId,
          formatted_address: point.address,
          geometry: {
            location: { lat: detailInvalid ? 999 : point.lat, lng: point.lng },
          },
        },
      };
    } else {
      assert.equal(u.pathname, "/v2/distancematrix");
      body = {
        rows: [
          {
            elements: [
              {
                status: routeStatus,
                distance: { value: distance },
                duration: { value: duration },
              },
            ],
          },
        ],
      };
    }
    return Response.json(body, { status: httpStatus });
  };
  admin = await db.user.create({
    data: {
      email: `${run}-admin@example.test`,
      name: "Owner shipping",
      passwordHash: "test-only",
      role: "OWNER",
      verified: true,
    },
  });
  buyer = await db.user.create({
    data: {
      email: `${run}@example.test`,
      name: "Khách shipping",
      passwordHash: "test-only",
      verified: true,
    },
  });
  await db.setting.upsert({
    where: { key: "shop" },
    create: { key: "shop", value: defaultSettings },
    update: { value: defaultSettings },
  });
  await db.deliveryZone.create({
    data: { id: `${run}-zone`, name: run, fee: 30000 },
  });
  await db.deliverySlot.create({
    data: {
      id: `${run}-slot`,
      label: "09:00 – 12:00",
      startHour: 9,
      endHour: 12,
      capacity: 1000,
    },
  });
  const product = await db.product.create({
    data: {
      slug: run,
      name: "Hoa shipping",
      subtitle: "QA",
      description: "QA",
      category: "QA",
      occasion: "QA",
      color: "QA",
      image: "/images/roses.webp",
      images: [],
      variants: { create: { name: "M", sku: run, price: 500000, stock: 1000 } },
    },
    include: { variants: true },
  });
  variantId = product.variants[0].id;
});
beforeEach(async () => {
  process.env.GOONG_ROUTE_CACHE_ENABLED = "false";
  await db.shippingRouteCache.deleteMany();
  distance = 4750;
  duration = 900;
  routeStatus = "OK";
  httpStatus = 200;
  detailInvalid = false;
  calls = [];
  await db.shippingQuote.deleteMany({
    where: { owner: { in: [owner(), `user:${admin.id}`, `guest:${run}`] } },
  });
  await resetPolicy();
});
after(async () => {
  global.fetch = realFetch;
  if (previousKey === undefined) delete process.env.GOONG_API_KEY;
  else process.env.GOONG_API_KEY = previousKey;
  if (previousCache === undefined) delete process.env.GOONG_ROUTE_CACHE_ENABLED;
  else process.env.GOONG_ROUTE_CACHE_ENABLED = previousCache;
  await db.shippingQuote.deleteMany({
    where: { owner: { in: [owner(), `user:${admin.id}`, `guest:${run}`] } },
  });
  await db.shippingLocation.deleteMany({
    where: { owner: { in: [owner(), `user:${admin.id}`, `guest:${run}`] } },
  });
  await db.setting.deleteMany({ where: { key: "delivery_policy" } });
  await db.setting.update({
    where: { key: "shop" },
    data: { value: defaultSettings },
  });
  await db.$disconnect();
});

test("shipping uses exact meters, explicit zero, minimum before rounding, bounded integers", () => {
  assert.equal(calculateShippingFee(4750, 5000), 23750);
  assert.equal(calculateShippingFee(4750, 5000, 0, 1000), 24000);
  assert.equal(calculateShippingFee(0, 5000), 0);
  assert.equal(calculateShippingFee(5000, 0), 0);
  assert.equal(calculateShippingFee(1, 500, 0), 1);
  assert.equal(calculateShippingFee(0, 5000, 12001, 1000), 13000);
  for (const args of [
    [-1, 5000],
    [1.2, 5000],
    [Number.MAX_SAFE_INTEGER, 1000000],
    [1000, 5000, 0, 100],
  ] as number[][])
    assert.throws(
      () => calculateShippingFee(args[0], args[1], args[2], args[3]),
      rejectCode("INVALID_SHIPPING"),
    );
});
test("maximum shipping caps the rounded amount, accepts zero and rejects conflicting bounds", () => {
  assert.equal(calculateShippingFee(4750, 5000, 0, 1, 20000), 20000);
  assert.equal(calculateShippingFee(4750, 5000, 0, 1000, 23800), 23800);
  assert.equal(calculateShippingFee(1000, 5000, 0, 1, 20000), 5000);
  assert.equal(calculateShippingFee(4750, 5000, 12001, 1000, 12001), 12001);
  assert.equal(calculateShippingFee(4750, 5000, 0, 1, 0), 0);
  for (const maximum of [-1, 1.5, NaN, Infinity, 9999])
    assert.throws(
      () => calculateShippingFee(4750, 5000, 10000, 1, maximum),
      rejectCode("INVALID_SHIPPING"),
    );
});
test("maximum fee saves with policy version, invalidates prior quotes and freezes capped order totals", async () => {
  assert.equal((await getShippingPolicy()).maximumFee, null);
  const { point, shipping } = await priced();
  await assert.rejects(
    saveShippingPolicy(admin, {
      ...policy,
      maximumFee: 9999,
      minimumFee: 10000,
      version: 42,
      displayAddress: origin.address,
    }),
    rejectCode("INVALID_SHIPPING"),
  );
  assert.equal((await getShippingPolicy()).version, 42);
  await saveShippingPolicy(admin, {
    ...policy,
    maximumFee: 20000,
    version: 42,
    displayAddress: origin.address,
  });
  assert.equal((await shippingAdminView(admin)).maximumFee, 20000);
  await assert.rejects(
    orderShipping(
      { locationId: point.id, shippingQuoteId: shipping.id },
      owner(),
      db,
    ),
    rejectCode("SHIPPING_POLICY_CHANGED"),
  );
  const capped = await createShippingQuote(owner(), { locationId: point.id });
  assert.equal(capped.fee, 20000);
  const order = await createOrder(
    input(point.id, capped.id, { expectedTotal: 520000 }),
    buyer,
    run,
  );
  assert.equal(order.deliveryFee, 20000);
  assert.equal(
    (order.shippingSnapshot as unknown as ShippingSnapshot).maximumFee,
    20000,
  );
  await saveShippingPolicy(admin, {
    ...policy,
    maximumFee: null,
    version: 43,
    displayAddress: origin.address,
  });
  assert.equal(
    (await createShippingQuote(owner(), { locationId: point.id })).fee,
    23750,
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).total,
    520000,
  );
});
test("Goong adapter uses V2, bias, motorcycle and ordered endpoints; zero route valid", async () => {
  assert.equal((await goongAutocomplete("Hà Nội", origin))[0].placeId, "home");
  assert.equal(
    calls[0].searchParams.get("has_deprecated_administrative_unit"),
    "true",
  );
  assert.equal(
    calls[0].searchParams.get("location"),
    `${origin.lat},${origin.lng}`,
  );
  distance = 0;
  duration = 0;
  assert.deepEqual(await goongDistance(origin, destination, "motorcycle"), {
    distanceMeters: 0,
    durationSeconds: 0,
  });
  assert.equal(
    calls[1].searchParams.get("origins"),
    `${origin.lat},${origin.lng}`,
  );
  assert.equal(
    calls[1].searchParams.get("destinations"),
    `${destination.lat},${destination.lng}`,
  );
  assert.equal(calls[1].searchParams.get("vehicle"), "bike");
  await goongDistance(origin, destination, "car");
  assert.equal(calls[2].searchParams.get("vehicle"), "car");
});
test("provider errors, invalid coordinates and unavailable routes never become free shipping", async () => {
  routeStatus = "ZERO_RESULTS";
  await assert.rejects(
    goongDistance(origin, destination, "motorcycle"),
    rejectCode("NO_DELIVERY_ROUTE"),
  );
  detailInvalid = true;
  await assert.rejects(goongDetail("home"), rejectCode("ADDRESS_NOT_FOUND"));
  httpStatus = 429;
  await assert.rejects(
    goongDetail("home"),
    (e) =>
      e instanceof AppError &&
      e.code === "GOONG_RATE_LIMITED" &&
      !e.message.includes("test-only"),
  );
  delete process.env.GOONG_API_KEY;
  await assert.rejects(goongDetail("home"), rejectCode("GOONG_NOT_CONFIGURED"));
  process.env.GOONG_API_KEY = "test-only-never-real";
});
test("upstream HTTP 400, denied key, quota and service failure remain distinct without leaking upstream bodies", async () => {
  for (const [status, code, appStatus] of [
    [400, "GOONG_INVALID_REQUEST", 502],
    [422, "GOONG_INVALID_REQUEST", 502],
    [401, "GOONG_ACCESS_DENIED", 503],
    [403, "GOONG_ACCESS_DENIED", 503],
    [429, "GOONG_RATE_LIMITED", 503],
    [500, "GOONG_UNAVAILABLE", 503],
  ] as const) {
    httpStatus = status;
    await assert.rejects(
      goongDistance(origin, destination, "motorcycle"),
      (e) =>
        e instanceof AppError &&
        e.code === code &&
        e.status === appStatus &&
        !e.message.includes("test-only") &&
        !e.message.includes("api_key") &&
        !e.message.includes("Query deserialize"),
    );
  }
});
test("JSON error envelopes and network failures are classified without exposing key or coordinates", async () => {
  const providerFetch = global.fetch;
  try {
    for (const [status, code] of [
      ["INVALID_REQUEST", "GOONG_INVALID_REQUEST"],
      ["REQUEST_DENIED", "GOONG_ACCESS_DENIED"],
      ["OVER_QUERY_LIMIT", "GOONG_RATE_LIMITED"],
    ]) {
      global.fetch = async () =>
        Response.json({ status, error_message: "secret-api_key-test-only" });
      await assert.rejects(
        goongDistance(origin, destination, "motorcycle"),
        (e) =>
          e instanceof AppError &&
          e.code === code &&
          !e.message.includes("secret"),
      );
    }
    global.fetch = async () => {
      throw Error("https://rsapi.goong.io?api_key=test-only-never-real");
    };
    await assert.rejects(
      goongDistance(origin, destination, "motorcycle"),
      (e) =>
        e instanceof AppError &&
        e.code === "GOONG_UNAVAILABLE" &&
        !e.message.includes("api_key"),
    );
  } finally {
    global.fetch = providerFetch;
  }
});
test("quotes and route cache identify the actual profile; obsolete quotes refresh before order creation", async () => {
  const { point, shipping } = await priced();
  const current = await db.shippingQuote.findUniqueOrThrow({
    where: { id: shipping.id },
  });
  const snapshot = current.snapshot as unknown as ShippingSnapshot;
  assert.equal(snapshot.vehicle, "motorcycle");
  assert.equal(snapshot.providerVehicle, "bike");
  assert.equal(snapshot.routingRevision, GOONG_ROUTING_REVISION);
  await db.shippingQuote.update({
    where: { id: shipping.id },
    data: {
      snapshot: {
        ...(current.snapshot as object),
        routingRevision: "old-profile",
      },
    },
  });
  await assert.rejects(
    orderShipping(
      { locationId: point.id, shippingQuoteId: shipping.id },
      owner(),
      db,
    ),
    rejectCode("SHIPPING_ROUTE_CHANGED"),
  );
  const refreshed = await createShippingQuote(owner(), {
    locationId: point.id,
  });
  assert.notEqual(refreshed.id, shipping.id);
  assert.equal(refreshed.fee, shipping.fee);
});
test("manual shipping keeps only a current automatic quote as its reference", async () => {
  const { point, shipping } = await priced(`user:${admin.id}`);
  const raw = {
    locationId: point.id,
    shippingQuoteId: shipping.id,
    address: destination.address,
    manualShipping: { fee: 15000, reason: "Phí đã thỏa thuận" },
  };
  const current = await orderShipping(raw, `user:${admin.id}`, db, {
    allowManual: true,
  });
  assert.equal(current.snapshot?.automaticReference?.fee, 23750);
  const row = await db.shippingQuote.findUniqueOrThrow({
    where: { id: shipping.id },
  });
  await db.shippingQuote.update({
    where: { id: row.id },
    data: {
      snapshot: { ...(row.snapshot as object), routingRevision: "obsolete" },
    },
  });
  const next = await orderShipping(raw, `user:${admin.id}`, db, {
    allowManual: true,
  });
  assert.equal(next.fee, 15000);
  assert.equal(next.snapshot?.automaticReference, undefined);
});
test("only settings roles configure distance mode, key and selected shop required", async () => {
  await assert.rejects(shippingAdminView(buyer), rejectCode("FORBIDDEN"));
  delete process.env.GOONG_API_KEY;
  await assert.rejects(
    saveShippingPolicy(admin, {
      ...policy,
      version: 42,
      displayAddress: origin.address,
    }),
    rejectCode("GOONG_NOT_CONFIGURED"),
  );
  process.env.GOONG_API_KEY = "test-only-never-real";
  await assert.rejects(
    saveShippingPolicy(admin, {
      ...policy,
      version: 42,
      displayAddress: "Điểm chưa xác nhận",
    }),
    rejectCode("SHIPPING_NOT_READY"),
  );
});
test("missing distance configuration never falls back to a submitted zone fee", async () => {
  await resetPolicy({ mode: "ZONE", origin: null, ratePerKm: null });
  const point = await location();
  await assert.rejects(
    createShippingQuote(owner(), { locationId: point.id }),
    rejectCode("SHIPPING_NOT_READY"),
  );
  await assert.rejects(
    orderShipping(
      { zoneId: `${run}-zone`, address: "Địa chỉ chưa chọn" },
      owner(),
      db,
    ),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
  assert.equal((await shippingPublic()).mode, "DISTANCE");
});
test("policy save increments version, syncs shop and publishes catalog.changed; stale editor rejected", async () => {
  const point = await location(`user:${admin.id}`, "shop");
  await saveShippingPolicy(admin, {
    ...policy,
    ratePerKm: 6000,
    originLocationId: point.id,
    version: 42,
    displayAddress: origin.address,
  });
  assert.equal((await getShippingPolicy()).version, 43);
  assert.equal(
    (await db.setting.findUniqueOrThrow({ where: { key: "shop" } })).value &&
      (await shippingAdminView(admin)).displayAddress,
    origin.address,
  );
  assert.ok(
    await db.outbox.findFirst({
      where: {
        event: "catalog.changed",
        payload: { path: "$.shippingVersion", equals: 43 },
      },
    }),
  );
  await assert.rejects(
    saveShippingPolicy(admin, {
      ...policy,
      version: 42,
      displayAddress: origin.address,
    }),
    rejectCode("STALE_SETTINGS"),
  );
  assert.deepEqual(Object.keys(await shippingPublic()).sort(), [
    "allowManual",
    "configured",
    "mode",
    "version",
  ]);
});
test("selected points ignore client coordinates and cannot cross owners or expiry", async () => {
  const point = await location();
  assert.deepEqual(await selectedLocation(point.id, owner()), destination);
  await assert.rejects(
    selectedLocation(point.id, "guest:foreign"),
    rejectCode("ADDRESS_NEEDS_CONFIRMATION"),
  );
  await db.shippingLocation.update({
    where: { id: point.id },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    selectedLocation(point.id, owner()),
    rejectCode("ADDRESS_NEEDS_CONFIRMATION"),
  );
});
test("shipping quote is reused without route HTTP for cart changes; address mismatch rejected", async () => {
  const { point, shipping } = await priced();
  const again = await createShippingQuote(owner(), { locationId: point.id });
  assert.equal(again.id, shipping.id);
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("distancematrix")).length,
    1,
  );
  assert.equal(shipping.fee, 23750);
  const other = await location(owner(), "other");
  await assert.rejects(
    orderShipping(
      { locationId: other.id, shippingQuoteId: shipping.id },
      owner(),
      db,
    ),
    rejectCode("SHIPPING_ADDRESS_CHANGED"),
  );
});
test("foreign, expired or outdated quote rejected and zoneId cannot bypass distance pricing", async () => {
  const { point, shipping } = await priced();
  const raw = {
    locationId: point.id,
    shippingQuoteId: shipping.id,
    zoneId: `${run}-zone`,
  };
  await assert.rejects(
    orderShipping(raw, "guest:foreign", db),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
  await db.shippingQuote.update({
    where: { id: shipping.id },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    orderShipping(raw, owner(), db),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
  await db.shippingQuote.update({
    where: { id: shipping.id },
    data: { expiresAt: new Date(Date.now() + 60000), policyVersion: 41 },
  });
  await assert.rejects(
    orderShipping(raw, owner(), db),
    rejectCode("SHIPPING_POLICY_CHANGED"),
  );
  await assert.rejects(
    orderShipping({ zoneId: `${run}-zone` }, owner(), db),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
});
test("max distance and provider failure cannot issue quote or reserve stock", async () => {
  await resetPolicy({ maxDistanceMeters: 4000 });
  const p = await location();
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  await assert.rejects(
    createShippingQuote(owner(), { locationId: p.id }),
    rejectCode("DELIVERY_OUT_OF_RANGE"),
  );
  assert.equal(await db.shippingQuote.count({ where: { owner: owner() } }), 0);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .reserved,
    stock.reserved,
  );
});
test("route caching is opt-in, shared across owners and repriced with current policy", async () => {
  process.env.GOONG_ROUTE_CACHE_ENABLED = "true";
  const first = await priced();
  const second = await priced(`user:${admin.id}`);
  assert.equal(second.shipping.fee, first.shipping.fee);
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("distancematrix")).length,
    1,
  );
  await saveShippingPolicy(admin, {
    ...policy,
    ratePerKm: 6000,
    version: 42,
    displayAddress: origin.address,
  });
  assert.equal(
    (await createShippingQuote(owner(), { locationId: first.point.id })).fee,
    28500,
  );
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("distancematrix")).length,
    1,
  );
  await saveShippingPolicy(admin, {
    ...policy,
    vehicle: "car",
    version: 43,
    displayAddress: origin.address,
  });
  await createShippingQuote(owner(), { locationId: first.point.id });
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("distancematrix")).length,
    2,
  );
});
test("web and admin use identical price, canonical address and trusted admin quote ownership", async () => {
  const a = await priced();
  const b = await priced(`user:${admin.id}`);
  const webInput = input(a.point.id, a.shipping.id);
  const manualInput = {
    ...input(b.point.id, b.shipping.id),
    source: "ZALO",
    customerId: buyer.id,
  };
  const webQuote = await quote(webInput, buyer, db, { shippingOwner: owner() });
  const adminQuote = await quoteAdminOrder(manualInput, admin);
  assert.equal(webQuote.total, adminQuote.total);
  const web = await createOrder(webInput, buyer, run);
  const manual = await createAdminOrder(manualInput, admin);
  assert.equal(web.total, 523750);
  assert.equal(manual.total, web.total);
  assert.equal(manual.userId, buyer.id);
  assert.equal(manual.createdBy, admin.id);
  assert.equal(web.zoneId, null);
  assert.equal(web.address, `${destination.address} · Căn 501`);
  assert.equal(web.shippingMethod, "DISTANCE");
  assert.equal(
    (web.shippingSnapshot as unknown as ShippingSnapshot).origin?.placeId,
    "shop",
  );
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("distancematrix")).length,
    2,
  );
  await assert.rejects(
    createAdminOrder(
      {
        ...manualInput,
        idempotencyKey: randomUUID(),
        shippingQuoteId: a.shipping.id,
        locationId: a.point.id,
      },
      admin,
    ),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
});
test("idempotent replay after quote expiry preserves one order, stock and slot reservation", async () => {
  const { point, shipping } = await priced();
  const raw = input(point.id, shipping.id);
  const first = await createOrder(raw, buyer, run);
  const stock = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
  });
  await db.shippingQuote.update({
    where: { id: shipping.id },
    data: { expiresAt: new Date(0) },
  });
  const replay = await createOrder(raw, buyer, run);
  assert.equal(first.id, replay.id);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
      .reserved,
    stock.reserved,
  );
});
test("guest quotes are bound to the same guest hash used by createOrder", async () => {
  const { point, shipping } = await priced(`guest:${run}`);
  const raw = input(point.id, shipping.id);
  await assert.rejects(
    createOrder(raw, null, "foreign"),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
  assert.equal((await createOrder(raw, null, run)).deliveryFee, 23750);
});
test("manual fee requires trusted role, enabled policy and reason; audited with full address", async () => {
  const raw = {
    ...input("", "", { expectedTotal: 512345 }),
    source: "FACEBOOK",
    manualShipping: { fee: 12345, reason: "Thỏa thuận với khách" },
  };
  await assert.rejects(createOrder(raw, buyer, run), rejectCode("FORBIDDEN"));
  await assert.rejects(createAdminOrder(raw, buyer), rejectCode("FORBIDDEN"));
  await resetPolicy({ allowManual: false });
  await assert.rejects(createAdminOrder(raw, admin), rejectCode("FORBIDDEN"));
  await resetPolicy();
  await assert.rejects(
    createAdminOrder(
      { ...raw, manualShipping: { fee: 12345, reason: "" } },
      admin,
    ),
  );
  const order = await createAdminOrder(
    { ...raw, locationId: undefined },
    admin,
  );
  assert.equal(order.deliveryFee, 12345);
  assert.match(order.address, /Căn 501/);
  assert.equal(
    (order.shippingSnapshot as unknown as ShippingSnapshot).distanceMeters,
    null,
  );
  assert.ok(
    await db.audit.findFirst({
      where: {
        entityId: order.id,
        action: "order.shipping_override",
        actorId: admin.id,
      },
    }),
  );
});
test("private shipping details omit staff and quote identifiers while preserving visible fees", () => {
  const safe = customerOrder({
    createdBy: "staff-id",
    shippingQuoteId: "quote-id",
    shippingSnapshot: {
      method: "MANUAL",
      actor: "staff-id",
      fee: 15000,
      automaticReference: {
        quoteId: "quote-id",
        fee: 23750,
        distanceMeters: 4750,
      },
    },
  });
  assert.equal(JSON.stringify(safe).includes("staff-id"), false);
  assert.equal(JSON.stringify(safe).includes("quote-id"), false);
  assert.equal(safe.shippingSnapshot?.fee, 15000);
});
test("SePay QR and webhook use frozen total including shipping after price policy changes", async () => {
  const { point, shipping } = await priced(`user:${admin.id}`);
  const order = await createAdminOrder(
    {
      ...input(point.id, shipping.id, { paymentMethod: "SEPAY" }),
      source: "INSTAGRAM",
    },
    admin,
  );
  const qr = await getOrderPaymentQr(admin, order.id);
  assert.equal(qr.amount, 523750);
  assert.equal(new URL(qr.url!).searchParams.get("amount"), "523750");
  await resetPolicy({ ratePerKm: 9000 });
  assert.equal((await getOrderPaymentQr(admin, order.id)).amount, qr.amount);
  await receiveSepay({
    id: Date.now(),
    gateway: "TESTBANK",
    accountNumber: "TESTACCOUNT",
    transferType: "in",
    transferAmount: order.total,
    content: order.code,
    referenceCode: randomUUID(),
  });
  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.status, "CONFIRMED");
  assert.equal(paid.fulfillment, "UNASSIGNED");
});
test("delivered COD receivable includes shipping; public tracking omits location and snapshot", async () => {
  const { point, shipping } = await priced(`user:${admin.id}`);
  const order = await createAdminOrder(
    {
      ...input(point.id, shipping.id, { deliveryDay: dayKey() }),
      customerId: buyer.id,
      source: "IN_STORE",
      initialStage: "DELIVERED",
    },
    admin,
  );
  const debt = await db.codReceivable.findUniqueOrThrow({
    where: { orderId: order.id },
  });
  assert.equal(debt.amount, 523750);
  const tracking = JSON.stringify(await trackOrder({ code: order.code }));
  for (const secret of [
    destination.address,
    "shippingSnapshot",
    "latitude",
    "longitude",
    "placeId",
    "Căn 501",
  ])
    assert.ok(!tracking.includes(secret));
  await saveShippingPolicy(admin, {
    ...policy,
    ratePerKm: 10000,
    version: 42,
    displayAddress: origin.address,
  });
  const draft = await prepareReorder(order.id, buyer.id);
  assert.equal(draft.draft.address, destination.address);
  assert.equal(draft.draft.addressDetails, "Căn 501");
  const next = await priced();
  assert.equal(next.shipping.fee, 47500);
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).deliveryFee,
    23750,
  );
});
test("saved addresses require canonical points and legacy zone settings cannot restore zone pricing", async () => {
  const p = await location();
  const fields = await savedAddressFields(owner(), {
    locationId: p.id,
    address: "Địa chỉ giả",
    addressDetails: "Tầng 2",
  });
  const saved = await db.address.create({
    data: { ...fields, userId: buyer.id, name: "Nhà", phone: "0900000000" },
  });
  assert.equal(
    (
      await resolveShippingLocation(
        owner(),
        { savedAddressId: saved.id },
        buyer.id,
      )
    ).placeId,
    "home",
  );
  await assert.rejects(
    resolveShippingLocation(
      `user:${admin.id}`,
      { savedAddressId: saved.id },
      admin.id,
    ),
    rejectCode("ADDRESS_NOT_FOUND"),
  );
  await assert.rejects(
    savedAddressFields(owner(), { address: "Địa chỉ chưa chọn" }),
    rejectCode("ADDRESS_NEEDS_CONFIRMATION"),
  );
  await resetPolicy({ mode: "ZONE" });
  assert.equal(
    (
      await savedAddressFields(owner(), {
        locationId: p.id,
        zoneId: `${run}-zone`,
        address: "Địa chỉ giả",
      })
    ).zoneId,
    null,
  );
  assert.equal((await shippingPublic()).mode, "DISTANCE");
  await assert.rejects(
    orderShipping(
      {
        zoneId: `${run}-zone`,
        address: "Địa chỉ cũ",
        addressDetails: "Cổng sau",
      },
      owner(),
      db,
    ),
    rejectCode("SHIPPING_QUOTE_EXPIRED"),
  );
  const current = await createShippingQuote(owner(), { locationId: p.id });
  assert.equal(current.fee, 23750);
  await assert.rejects(
    saveShippingPolicy(admin, {
      ...policy,
      mode: "ZONE",
      version: 42,
      displayAddress: origin.address,
    }),
  );
  await resetPolicy();
  await assert.rejects(
    atomic((tx) => assertZoneEditable(tx)),
    rejectCode("ZONE_ARCHIVED"),
  );
});
