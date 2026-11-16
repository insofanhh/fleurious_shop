import type { Metadata } from "next";
import { brandSocialMetadata, BRAND_DESCRIPTION } from "./social-metadata";

export const HOME_SEARCH_TITLE =
  "Fleurious | Hoa tươi Hà Nội, giao hoa tận nơi";
export const pageTitles: Record<string, string> = {
  flowers: "Hoa tươi và những bó hoa dành tặng",
  collections: "Bộ sưu tập hoa theo dịp tặng",
  membership: "Hội viên Fleurious",
  about: "Chuyện của hoa và Fleurious",
  delivery: "Giao hoa tại Hà Nội",
  returns: "Đổi trả và hỗ trợ",
  privacy: "Chính sách quyền riêng tư",
  "cham-hoa": "Cách chăm hoa tươi",
  favorites: "Hoa yêu thích",
  streak: "Những ngày có hoa",
  cart: "Giỏ hoa",
  checkout: "Thanh toán",
  account: "Tài khoản",
  notifications: "Thông báo",
  auth: "Đăng nhập",
  orders: "Đơn hàng",
  "track-order": "Theo dõi đơn hàng",
  q: "Nhận một ngày có hoa",
};
const occasionTitles: Record<string, string> = {
  "sinh-nhat": "Hoa sinh nhật",
  "ky-niem": "Hoa kỷ niệm",
  "tang-ban-than": "Hoa tặng bản thân",
  "chuc-mung": "Hoa chúc mừng",
};

export function publicPageMetadata(
  segments: string[],
  content?: { title?: string | null; description?: string | null },
): Metadata {
  const [first, second] = segments;
  const label =
    content?.title?.trim() ||
    (first === "collections" && second ? occasionTitles[second] : undefined) ||
    pageTitles[first] ||
    "Những ngày có hoa";
  // Always return a concrete title: an explicit undefined child title clears
  // the inherited layout title in Next.js metadata resolution.
  const title = !first
    ? HOME_SEARCH_TITLE
    : /\bfleurious\b/i.test(label)
      ? label
      : `${label} · Fleurious`;
  const description =
    content?.description?.replace(/\s+/g, " ").trim().slice(0, 170) ||
    BRAND_DESCRIPTION;
  const privatePage =
    [
      "notifications",
      "account",
      "auth",
      "orders",
      "track-order",
      "q",
      "checkout",
      "cart",
      "streak",
      "favorites",
    ].includes(first) ||
    (first === "membership" && second === "invoices");
  return {
    title: { absolute: title },
    description,
    ...brandSocialMetadata(title, description),
    ...(privatePage ? { robots: { index: false, follow: false } } : {}),
  };
}
