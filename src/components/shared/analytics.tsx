"use client";

import { Analytics } from "@vercel/analytics/next";
import { scrubAnalyticsEvent } from "@/lib/sentry/scrub";

/**
 * Estadísticas de visitas de Vercel (sin cookies). Es un componente de cliente porque `beforeSend` es una función
 * y no puede cruzar desde un Server Component. Antes de enviarse, cada ruta se generaliza (`/r/abc234` → `/r/[code]`).
 */
export function SiteAnalytics() {
  return <Analytics beforeSend={scrubAnalyticsEvent} />;
}
