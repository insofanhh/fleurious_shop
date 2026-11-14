import type { Prisma } from "@prisma/client";
import { hash } from "./security";
type Tx = Prisma.TransactionClient;
export type AnalyticsPacket = {
  clientId: string;
  eventId: string;
  name: string;
  params: Record<string, unknown>;
  userId?: string;
  timestamp?: string;
  delivered?: string[];
};
export const analyticsEnabled = () =>
  Boolean(
    process.env.POSTHOG_KEY ||
    (process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET),
  );
export async function queuePurchase(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order.analyticsClientId || !analyticsEnabled()) return;
  await queueAnalytics(tx, {
    clientId: order.analyticsClientId,
    eventId: `purchase:${order.id}`,
    name: "purchase",
    userId: order.userId ?? undefined,
    params: {
      transaction_id: order.code,
      currency: "VND",
      value: order.subtotal - order.discount,
      shipping: order.deliveryFee,
      coupon: order.discountLabel,
      items: order.items.map((i) => ({
        item_id: i.variantId,
        item_name: i.name,
        item_variant: i.variantName,
        quantity: i.quantity,
        price: (i.price * i.quantity - i.discount) / i.quantity,
      })),
    },
  });
}
export async function queueAnalytics(tx: Tx, packet: AnalyticsPacket) {
  if (!analyticsEnabled()) return;
  const anonymous: AnalyticsPacket = {
    ...packet,
    timestamp: packet.timestamp ?? new Date().toISOString(),
    userId: packet.userId
      ? hash(`${process.env.SESSION_SECRET}:${packet.userId}`)
      : undefined,
  };
  const id = `analytics:${packet.eventId}`;
  await tx.outbox.upsert({
    where: { id },
    create: {
      id,
      event: "analytics.event",
      payload: JSON.parse(JSON.stringify(anonymous)),
    },
    update: {},
  });
}
export async function sendAnalytics(packet: AnalyticsPacket) {
  const hex = hash(packet.eventId).slice(0, 32);
  const eventUuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const delivered = packet.delivered ?? [];
  const names: string[] = [];
  const requests: Promise<Response>[] = [];
  if (
    process.env.GA4_MEASUREMENT_ID &&
    process.env.GA4_API_SECRET &&
    !delivered.includes("ga4")
  ) {
    names.push("ga4");
    const url = new URL("https://www.google-analytics.com/mp/collect");
    url.searchParams.set("measurement_id", process.env.GA4_MEASUREMENT_ID);
    url.searchParams.set("api_secret", process.env.GA4_API_SECRET);
    requests.push(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: packet.clientId,
          user_id: packet.userId,
          timestamp_micros:
            Date.parse(packet.timestamp ?? new Date().toISOString()) * 1000,
          events: [
            {
              name: packet.name,
              params: {
                ...packet.params,
                session_id:
                  Math.floor(
                    new Date(packet.timestamp ?? Date.now()).getTime() /
                      1800000,
                  ) * 1800,
                engagement_time_msec: 1,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      }),
    );
  }
  if (process.env.POSTHOG_KEY && !delivered.includes("posthog")) {
    names.push("posthog");
    const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
    requests.push(
      fetch(`${host.replace(/\/$/, "")}/i/v0/e/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.POSTHOG_KEY,
          event: packet.name,
          distinct_id: packet.clientId,
          uuid: eventUuid,
          timestamp: packet.timestamp,
          properties: {
            ...packet.params,
            user_id: packet.userId,
            $insert_id: packet.eventId,
            $process_person_profile: false,
          },
        }),
        signal: AbortSignal.timeout(3000),
      }),
    );
  }
  const result = await Promise.allSettled(requests);
  const sent = result.flatMap((r, i) =>
    r.status === "fulfilled" && r.value.ok ? [names[i]] : [],
  );
  return {
    complete: sent.length === requests.length,
    packet: { ...packet, delivered: [...new Set([...delivered, ...sent])] },
  };
}
