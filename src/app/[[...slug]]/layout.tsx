import { notFound } from "next/navigation";
import { resolveStorefrontRoute } from "@/lib/storefront-route";

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug?: string[] }>;
}) {
  // This layout sits outside this segment's loading/Suspense boundary.
  // Resolve missing resources before streaming can commit an HTTP 200.
  if (!(await resolveStorefrontRoute((await params).slug ?? []))) notFound();
  return children;
}
