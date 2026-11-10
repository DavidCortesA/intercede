import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";
import { routing } from "@/i18n/routing";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Las salas son privadas (el código es la llave): no se rastrean ni se indexan.
      disallow: ["/api/", "/serwist/", ...routing.locales.map((locale) => `/${locale}/r/`)],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
