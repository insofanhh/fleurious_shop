import { notFound } from "next/navigation";
import { Storefront } from "@/components/storefront";
import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/page-metadata";
import { resolveStorefrontRoute } from "@/lib/storefront-route";
type Props = { params: Promise<{ slug?: string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug ?? [];
  const route = await resolveStorefrontRoute(slug);
  if (!route)
    return { title: "Không tìm thấy", robots: { index: false, follow: false } };
  return publicPageMetadata(slug, route.metadata);
}
export default async function Page({ params }: Props) {
  const segments = (await params).slug ?? [];
  const route = await resolveStorefrontRoute(segments);
  if (!route) notFound();
  const product = route.product;
  return (
    <>
      {product && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: product.name,
              image: new URL(
                product.image,
                process.env.APP_URL ?? "http://localhost:3000",
              ).href,
              description: product.subtitle,
              offers: {
                "@type": "AggregateOffer",
                priceCurrency: "VND",
                lowPrice: Math.min(...product.variants.map((v) => v.price)),
                highPrice: Math.max(...product.variants.map((v) => v.price)),
                offerCount: product.variants.length,
                availability: product.variants.some((v) => v.stock > v.reserved)
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
              },
            }).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <Storefront key={segments.join("/")} segments={segments} />
    </>
  );
}
