import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";
import es from "@/messages/es.json";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.name,
    short_name: BRAND.name,
    description: es.Metadata.description,
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    categories: ["lifestyle", "social"],
    theme_color: BRAND.colors.navy900,
    background_color: BRAND.colors.navy900,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
