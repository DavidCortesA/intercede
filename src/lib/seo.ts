import type { Metadata } from "next";
import { BRAND } from "@/config/brand";

/** Metadatos por página: title y description propios, canonical y Open Graph/Twitter. */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  noindex = false,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
}): Metadata {
  const url = `/${locale}${path}`;
  // Imagen social por defecto (src/app/[locale]/opengraph-image.tsx). Se declara explícita porque
  // al definir `openGraph` en la página, Next no hereda la imagen del archivo de convención.
  const image = { url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: BRAND.tagline };

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: BRAND.name, title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
    robots: noindex ? { index: false, follow: false } : undefined,
  };
}
