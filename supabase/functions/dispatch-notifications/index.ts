// Edge Function (Deno): envía los avisos pendientes por push y correo. La llama pg_cron cada minuto.
//
// Seguridad:
//   * No usa el JWT de una persona (verify_jwt = false en config.toml): se autentica con un secreto
//     compartido en el encabezado `x-dispatch-secret` (mismo valor en Vault, que lo envía, y en los
//     secretos de la función, que lo comprueba).
//   * Usa la service role solo para llamar a las funciones claim_notifications / finish_notification,
//     que existen únicamente para ese rol.
//   * Los endpoints push ya vienen filtrados por la base (solo servicios push de navegadores).
//
// Secretos de la función (supabase secrets set …): DISPATCH_SECRET, NEXT_PUBLIC_VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT, y opcionalmente NEXT_PUBLIC_SITE_URL + RESEND_API_KEY + RESEND_FROM
// (sin alguna de las tres el correo se omite). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta la plataforma.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  DeliveryError,
  dispatchNotifications,
  safeEqual,
  type ClaimedNotification,
  type DispatchDeps,
  type EmailMessage,
} from "./dispatch.ts";

const env = (name: string) => Deno.env.get(name) ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = env("DISPATCH_SECRET");
  const received = request.headers.get("x-dispatch-secret") ?? "";
  // Sin secreto configurado la función no responde a nadie (falla cerrado)
  if (!expected || !safeEqual(received, expected)) return json({ error: "unauthorized" }, 401);

  const vapidPublic = env("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const vapidPrivate = env("VAPID_PRIVATE_KEY");
  const vapidSubject = env("VAPID_SUBJECT");
  const siteUrl = env("NEXT_PUBLIC_SITE_URL").replace(/\/$/, "");
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return json({ error: "server_misconfigured" }, 500);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const resendKey = env("RESEND_API_KEY");
  const resendFrom = env("RESEND_FROM");
  // La URL del sitio solo hace falta para los enlaces del correo: sin ella el correo se omite
  const emailEnabled = Boolean(resendKey && resendFrom && siteUrl);

  const deps: DispatchDeps = {
    siteUrl,
    async claim(limit) {
      const { data, error } = await supabase.rpc("claim_notifications", { p_limit: limit });
      if (error) throw new Error(`claim_notifications: ${error.message}`);
      return (data ?? []) as ClaimedNotification[];
    },
    async finish(args) {
      const { error } = await supabase.rpc("finish_notification", {
        p_id: args.id,
        p_push_state: args.pushState,
        p_email_state: args.emailState,
        p_error: args.error ?? undefined,
        p_dead_endpoints: args.deadEndpoints,
      });
      if (error) throw new Error(`finish_notification: ${error.message}`);
    },
    async sendPush(subscription, payload) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
          TTL: 60 * 60,
          urgency: "normal",
          timeout: 10_000,
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        throw new DeliveryError((error as Error).message, status);
      }
    },
    sendEmail:
      emailEnabled
        ? async (message: EmailMessage) => {
            const response = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: resendFrom, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
              signal: AbortSignal.timeout(10_000),
            }).catch((error: Error) => {
              throw new DeliveryError(error.message);
            });
            if (!response.ok) throw new DeliveryError(`Resend respondió ${response.status}`, response.status);
          }
        : null,
  };

  try {
    // Hasta 4 lotes por llamada: se vacía la cola sin alargar la ejecución
    const total = { claimed: 0, pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0, removedEndpoints: 0 };
    for (let batch = 0; batch < 4; batch++) {
      const summary = await dispatchNotifications(deps, 50);
      for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += summary[key];
      if (summary.claimed < 50) break;
    }
    return json(total);
  } catch (error) {
    console.error("dispatch-notifications:", (error as Error).message);
    return json({ error: "dispatch_failed" }, 500);
  }
});
