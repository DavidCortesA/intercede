import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";

/** Errores del servidor (Server Components, rutas, acciones) → Sentry. Sin SENTRY_DSN no hace nada. */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions(process.env.SENTRY_DSN));
  }
}

export const onRequestError = Sentry.captureRequestError;
