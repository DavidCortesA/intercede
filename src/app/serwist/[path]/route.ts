import { createSerwistRoute } from "@serwist/turbopack";
import { routing } from "@/i18n/routing";

// Sirve el service worker (/serwist/sw.js) compilado con esbuild desde src/app/sw.ts.
// Se usa @serwist/turbopack porque Next 16 compila con Turbopack por defecto.
// Ver docs/decisions/0003-pwa-service-worker.md
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  // Solo se precachea la página offline de cada idioma. Ninguna otra página HTML.
  additionalPrecacheEntries: routing.locales.map((locale) => ({
    url: `/${locale}/offline`,
    revision,
  })),
});
