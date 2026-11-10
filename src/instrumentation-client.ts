import { sentryOptions } from "@/lib/sentry/options";

/**
 * Errores del navegador → Sentry. El DSN llega de SENTRY_DSN (next.config.ts lo expone: un DSN es público por
 * diseño). Sin DSN no se descarga nada. Con DSN, el SDK se carga DESPUÉS de que la página esté lista y en un
 * momento libre: el rendimiento de la landing (Lighthouse ≥ 90 en móvil) no puede pagar por la observabilidad.
 * Sin repetición de sesión: grabaría lo que se escribe.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const start = () => void import("@sentry/nextjs").then((Sentry) => Sentry.init(sentryOptions(dsn)));
  const whenIdle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 5000 }) : setTimeout(start, 2000));
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}
