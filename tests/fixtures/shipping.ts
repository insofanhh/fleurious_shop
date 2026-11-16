import { db } from "../../src/lib/db";
import { hash } from "../../src/lib/security";
import { GOONG_ROUTING_REVISION } from "../../src/lib/goong";
const point = {
  placeId: "commerce-fixture",
  address: "Địa chỉ giả lập, Hà Nội",
  lat: 21.03,
  lng: 105.85,
};
const locations = new Map<
  string,
  Promise<{ locationId: string; shippingQuoteId: string }>
>();
export async function setupShippingFixture() {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw Error("Unsafe test database");
  await db.setting.upsert({
    where: { key: "delivery_policy" },
    create: {
      key: "delivery_policy",
      version: 1,
      value: { mode: "DISTANCE", origin: point, ratePerKm: 5000 },
    },
    update: {
      version: 1,
      value: { mode: "DISTANCE", origin: point, ratePerKm: 5000 },
    },
  });
}
export function fixtureShipping(owner: string) {
  let existing = locations.get(owner);
  if (!existing) {
    existing = (async () => {
      const location = await db.shippingLocation.create({
        data: {
          owner,
          placeId: point.placeId,
          address: point.address,
          latitude: point.lat,
          longitude: point.lng,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const quote = await db.shippingQuote.create({
        data: {
          owner,
          destinationKey: hash(JSON.stringify(point)),
          policyVersion: 1,
          fee: 30000,
          snapshot: {
            method: "DISTANCE",
            origin: point,
            destination: point,
            distanceMeters: 6000,
            durationSeconds: 900,
            vehicle: "motorcycle",
            providerVehicle: "bike",
            routingRevision: GOONG_ROUTING_REVISION,
            ratePerKm: 5000,
            minimumFee: 0,
            maximumFee: null,
            roundingStep: 1,
            fee: 30000,
            policyVersion: 1,
          },
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return { locationId: location.id, shippingQuoteId: quote.id };
    })();
    locations.set(owner, existing);
  }
  return existing;
}
