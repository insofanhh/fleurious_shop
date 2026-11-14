import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fleurious — Những ngày có hoa",
    short_name: "Fleurious",
    description: "Hoa tươi, cảm xúc thật. Được nâng niu từ Hà Nội.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "vi",
    background_color: "#f4eade",
    theme_color: "#6e1423",
    icons: [
      {
        src: "/icons/icon-192.png?v=2",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
