import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";
import { routing } from "@/i18n/routing";

// Páginas indexables. Al crear una página pública nueva, añadirla aquí.
// `/orar` queda fuera a propósito (provisional, noindex).
const PATHS = ["", "/privacidad", "/terminos"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap((locale) =>
    PATHS.map((path) => ({
      url: `${SITE_URL}/${locale}${path}`,
      changeFrequency: path === "" ? ("weekly" as const) : ("yearly" as const),
      priority: path === "" ? 1 : 0.3,
    })),
  );
}
