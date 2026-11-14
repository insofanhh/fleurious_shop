import type { Metadata } from "next";

export const BRAND_SHARE_IMAGE = "/images/fleurious-brand-share-v1.png";
export const BRAND_TITLE = "Fleurious — Những ngày có hoa";
export const BRAND_DESCRIPTION =
  "Hoa tươi được chọn và bó thủ công tại Hà Nội. Gửi hoa, gửi những điều dịu dàng.";

export function brandSocialMetadata(
  title = BRAND_TITLE,
  description = BRAND_DESCRIPTION,
): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: "Fleurious",
      locale: "vi_VN",
      title,
      description,
      images: [
        {
          url: BRAND_SHARE_IMAGE,
          width: 1200,
          height: 630,
          type: "image/png",
          alt: "Logo Fleurious màu kem trên nền Cellar Burgundy",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        {
          url: BRAND_SHARE_IMAGE,
          alt: "Logo Fleurious màu kem trên nền Cellar Burgundy",
        },
      ],
    },
  };
}
