import { notFound } from "next/navigation";
import { Storefront } from "@/components/storefront";
import { db } from "@/lib/db";
import type { Metadata } from "next";
type Props = { params: Promise<{ slug?: string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug ?? [];
  if (slug[0] === "flowers" && slug[1]) {
    const product = await db.product.findUnique({ where: { slug: slug[1] } });
    return {
      title: product?.name ?? "Không tìm thấy",
      description: product?.subtitle,
      openGraph: product ? { images: [product.image] } : undefined,
    };
  }
  const names: Record<string, string> = {
    flowers: "Tìm một bó hoa",
    membership: "Hội viên Fleurious",
    streak: "Những ngày có hoa",
    cart: "Giỏ hoa",
    checkout: "Thanh toán",
    account: "Tài khoản",
    notifications: "Thông báo",
    auth: "Đăng nhập",
    orders: "Đơn hàng",
    q: "Nhận một ngày có hoa",
  };
  return {
    title: names[slug[0]],
    robots:
      [
        "notifications",
        "account",
        "auth",
        "orders",
        "q",
        "checkout",
        "cart",
        "streak",
      ].includes(slug[0]) ||
      (slug[0] === "membership" && slug[1] === "invoices")
        ? { index: false, follow: false }
        : undefined,
  };
}
export default async function Page({ params }: Props) {
  const segments = (await params).slug ?? [];
  const allowed = [
    "flowers",
    "collections",
    "membership",
    "streak",
    "cart",
    "checkout",
    "account",
    "notifications",
    "auth",
    "orders",
    "q",
    "about",
    "delivery",
    "returns",
    "privacy",
    "cham-hoa",
    "favorites",
  ];
  if (
    segments[0] &&
    !allowed.includes(segments[0]) &&
    !(await db.content.findFirst({
      where: {
        slug: segments[0],
        active: true,
        kind: { in: ["page", "article"] },
      },
    }))
  )
    notFound();
  if (
    segments[0] === "flowers" &&
    segments[1] &&
    !(await db.product.findFirst({
      where: { slug: segments[1], active: true },
    }))
  )
    notFound();
  const product =
    segments[0] === "flowers" && segments[1]
      ? await db.product.findUnique({
          where: { slug: segments[1] },
          include: { variants: true },
        })
      : null;
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
