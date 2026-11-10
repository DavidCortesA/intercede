import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Opciones comunes de Sentry (servidor, navegador y edge). Sin DSN queda apagado: no envía nada y el
 * resto de la app no lo nota. Privacidad: sin datos personales por defecto, sin repetición de sesión y
 * con `scrubEvent` / `scrubBreadcrumb` sobre todo lo que sale (ver docs/decisions/0012).
 */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    // Pocas trazas: el objetivo son los errores
    tracesSampleRate: 0.05,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
