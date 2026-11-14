import { getSepayConfig } from "@/lib/sepay-settings";
import { googleAuthAvailable } from "@/lib/google-auth";
import type { Metadata, Viewport } from "next";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/500.css";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "./globals.css";
import "@/components/analytics.css";
import "@/components/mobile-accessibility.css";
import "@/components/ui/select.css";
import "@/components/brand.css";
import "@/components/membership.css";
import "@/components/membership-admin.css";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { ShopProvider } from "@/components/shop-provider";
import { NotificationProvider } from "@/components/notification-center";
import "@/components/navigation.css";
import "@/components/sepay-settings.css";
import "@/components/scrollbars.css";
import "@/components/order-card.css";
import "@/components/admin-order-details.css";
import "@/components/card-assets.css";
import "@/components/auth-enhancements.css";
import { Shell } from "@/components/shell";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { analyticsEnabled } from "@/lib/analytics";
import { getRewardRules } from "@/lib/reward-rules";
import type { Bootstrap } from "@/lib/types";
import { getMembershipTiers } from "@/lib/membership";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Fleurious — Những ngày có hoa",
    template: "%s · Fleurious",
  },
  description:
    "Hoa tươi được chọn và bó thủ công tại Hà Nội. Gửi hoa, gửi những điều dịu dàng.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Fleurious" },
  icons: {
    icon: [
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png?v=2", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/icons/apple-touch-icon.png?v=2",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#6e1423",
};
export const dynamic = "force-dynamic";
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [products, zones, slots, content, settings, taxonomies] =
    await Promise.all([
      db.product.findMany({
        where: { active: true },
        include: { variants: true },
        orderBy: { sortOrder: "asc" },
      }),
      db.deliveryZone.findMany({ where: { active: true } }),
      db.deliverySlot.findMany({
        where: { active: true },
        orderBy: { startHour: "asc" },
      }),
      db.content.findMany({
        where: {
          active: true,
          kind: { in: ["page", "article", "faq", "banner"] },
        },
      }),
      getSettings(),
      db.taxonomy.findMany({ where: { active: true } }),
    ]);
  const rewardRules = (await getRewardRules()).rules.filter((r) => r.active);
  const initial = JSON.parse(
    JSON.stringify({
      products,
      zones,
      slots,
      content,
      settings,
      taxonomies,
      analyticsEnabled: analyticsEnabled(),
      rewardRules,
      membershipTiers: (await getMembershipTiers()).filter((t) => t.active),
      sepayAvailable: (await getSepayConfig()).configured,
      googleAuthAvailable: googleAuthAvailable(),
      realtimeTransport: process.env.VERCEL === "1" ? "websocket" : "socketio",
      vapidKey: process.env.VAPID_PUBLIC_KEY ?? "",
    }),
  ) as Bootstrap;
  return (
    <html lang="vi">
      <body>
        <a href="#main-content" className="skip-link">
          Đến nội dung chính
        </a>
        <ShopProvider initial={initial}>
          <NotificationProvider>
            <Shell>
              <AnalyticsConsent enabled={initial.analyticsEnabled} />
              {children}
            </Shell>
          </NotificationProvider>
        </ShopProvider>
      </body>
    </html>
  );
}
