import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await db.product.findMany({
    where: { active: true },
    select: { slug: true },
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const pages = await db.content.findMany({
    where: { active: true, kind: { in: ["page", "article"] } },
    select: { slug: true },
  });
  return [
    "",
    "/flowers",
    "/membership",
    "/about",
    "/delivery",
    "/cham-hoa",
    ...products.map((p) => `/flowers/${p.slug}`),
    ...pages
      .filter((p) => !["about", "delivery", "cham-hoa"].includes(p.slug))
      .map((p) => `/${p.slug}`),
  ].map((p) => ({ url: `${base}${p}` }));
}
