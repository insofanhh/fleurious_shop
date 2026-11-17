import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { productClassifications } from "./catalogue";

type RouteData = {
  product?: Prisma.ProductGetPayload<{ include: { variants: true } }>;
  metadata?: { title?: string; description?: string };
};

const singlePages = new Set([
  "flowers",
  "collections",
  "membership",
  "daily",
  "streak",
  "cart",
  "checkout",
  "account",
  "notifications",
  "auth",
  "track-order",
  "favorites",
]);
const contentPages = new Set([
  "about",
  "delivery",
  "returns",
  "privacy",
  "cham-hoa",
]);
const accountPages = new Set([
  "daily",
  "orders",
  "rewards",
  "membership",
  "profile",
  "addresses",
  "notifications",
]);
const authPages = new Set([
  "login",
  "register",
  "forgot",
  "verify",
  "reset",
  "google-mfa",
]);
// These occasions also have explicit filters and links in Catalogue/Home,
// even in stores that have not created corresponding taxonomy records.
const builtInOccasions = new Set([
  "sinh-nhat",
  "ky-niem",
  "tang-ban-than",
  "chuc-mung",
]);

// Share existence checks between layout, metadata and page within one render.
// Primitive serialized keys avoid cache misses caused by separate params arrays.
const resolve = cache(async (key: string): Promise<RouteData | null> => {
  const segments = JSON.parse(key) as string[];
  const [first, second] = segments;
  if (!first) return {};

  if (segments.length === 2) {
    if (first === "daily" && second === "create") return {};
    if (first === "flowers") {
      const product = await db.product.findFirst({
        where: { slug: second, active: true },
        include: { variants: true, taxonomies: { include: { taxonomy: true } } },
      });
      return product
        ? {
            product: productClassifications(product),
            metadata: { title: product.name, description: product.subtitle },
          }
        : null;
    }
    if (first === "collections") {
      const taxonomy = await db.taxonomy.findUnique({
        where: { slug: second },
      });
      if (taxonomy)
        return taxonomy.active &&
          ["COLLECTION", "CATEGORY", "OCCASION"].includes(taxonomy.kind)
          ? { metadata: { title: `Hoa ${taxonomy.name}` } }
          : null;
      return builtInOccasions.has(second) ? {} : null;
    }
    if (first === "account" && accountPages.has(second)) return {};
    if (first === "auth" && authPages.has(second)) return {};
    // Private resource existence and authorization remain in their protected APIs.
    if (first === "orders" || first === "q") return {};
    return null;
  }
  if (segments.length === 3 && first === "account" && second === "daily")
    return {};
  if (segments.length === 3 && first === "membership" && second === "invoices")
    return {};
  if (segments.length !== 1) return null;
  if (singlePages.has(first)) return {};

  const content = await db.content.findFirst({
    where: { slug: first, active: true, kind: { in: ["page", "article"] } },
    select: { title: true, body: true },
  });
  if (content)
    return { metadata: { title: content.title, description: content.body } };
  // Keep the existing placeholder for the store's built-in policy/story pages.
  return contentPages.has(first) ? {} : null;
});

export function resolveStorefrontRoute(segments: readonly string[]) {
  return resolve(JSON.stringify(segments));
}
