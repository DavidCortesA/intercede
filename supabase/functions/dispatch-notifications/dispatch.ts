/**
 * Lógica del envío de avisos, sin dependencias de Deno ni de librerías: recibe todo lo externo
 * (la base de datos, el servicio push y el correo) por parámetro. Así se prueba en Vitest con
 * dobles, y `index.ts` solo conecta las piezas reales.
 *
 * Flujo (cada minuto, llamado por pg_cron):
 *   1. `claim`  → la base reclama los avisos pendientes y decide los canales según las preferencias.
 *   2. Se envía por push (a cada dispositivo) y por correo (si la persona lo activó).
 *   3. `finish` → se guarda el resultado y se borran los dispositivos dados de baja (404/410).
 */

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ClaimedNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Ruta interna sin idioma (p. ej. /r/abc234). */
  url: string;
  push_pending: boolean;
  email_pending: boolean;
  email: string | null;
  subscriptions: PushSubscriptionRow[];
}

export type DeliveryState = "sent" | "skipped" | "failed" | "pending";

export interface FinishArgs {
  id: string;
  pushState: DeliveryState;
  emailState: DeliveryState;
  error: string | null;
  deadEndpoints: string[];
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Error de un envío; `status` es el código HTTP del servicio cuando lo hubo. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export interface DispatchDeps {
  claim(limit: number): Promise<ClaimedNotification[]>;
  finish(args: FinishArgs): Promise<void>;
  /** Debe lanzar `DeliveryError` (con `status` si lo hay) cuando el envío falla. */
  sendPush(subscription: PushSubscriptionRow, payload: string): Promise<void>;
  /** `null` cuando el correo no está configurado: ese canal se marca como omitido. */
  sendEmail: ((message: EmailMessage) => Promise<void>) | null;
  /** URL pública del sitio, sin barra final (para los enlaces del correo). */
  siteUrl: string;
  locale?: string;
}

export interface DispatchSummary {
  claimed: number;
  pushSent: number;
  pushFailed: number;
  emailSent: number;
  emailFailed: number;
  removedEndpoints: number;
}

/** 404/410: el servicio push dice que el dispositivo ya no existe (se desinstaló o revocó el permiso). */
export const isGone = (status: number | undefined) => status === 404 || status === 410;

/** Fallos que vale la pena reintentar: red, límite de uso o error del servicio. */
export const isTransient = (status: number | undefined) => status === undefined || status === 429 || status >= 500;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildEmail(notification: ClaimedNotification, to: string, link: string, settingsLink: string): EmailMessage {
  const title = escapeHtml(notification.title);
  const body = escapeHtml(notification.body);
  return {
    to,
    subject: notification.title,
    text: `${notification.body}\n\n${link}\n\nINTERCEDE — Ora. Conecta. Permanece.\nPuedes cambiar tus avisos en ${settingsLink}`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#0A1240">` +
      `<h1 style="font-size:20px">${title}</h1><p style="font-size:16px">${body}</p>` +
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#5B2EE6;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700">Abrir en INTERCEDE</a></p>` +
      `<p style="font-size:12px;color:#555">INTERCEDE — Ora. Conecta. Permanece.</p></div>`,
  };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export async function dispatchNotifications(deps: DispatchDeps, limit = 50): Promise<DispatchSummary> {
  const locale = deps.locale ?? "es";
  const summary: DispatchSummary = { claimed: 0, pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0, removedEndpoints: 0 };

  const notifications = await deps.claim(limit);
  summary.claimed = notifications.length;

  for (const notification of notifications) {
    const link = `${deps.siteUrl}/${locale}${notification.url}`;
    const errors: string[] = [];
    const deadEndpoints: string[] = [];
    let pushState: DeliveryState = "skipped";
    let emailState: DeliveryState = "skipped";

    if (notification.push_pending) {
      const payload = JSON.stringify({ title: notification.title, body: notification.body, url: `/${locale}${notification.url}`, tag: notification.id });
      let delivered = 0;
      let retryable = false;
      for (const subscription of notification.subscriptions) {
        try {
          await deps.sendPush(subscription, payload);
          delivered++;
        } catch (error) {
          const status = error instanceof DeliveryError ? error.status : undefined;
          if (isGone(status)) deadEndpoints.push(subscription.endpoint);
          else {
            if (isTransient(status)) retryable = true;
            errors.push(`push ${status ?? "red"}: ${describe(error)}`);
          }
        }
      }
      // Con al menos un dispositivo alcanzado, el aviso cuenta como enviado (no se repite en los demás).
      pushState = delivered > 0 ? "sent" : retryable ? "pending" : "failed";
      if (delivered > 0) summary.pushSent++;
      else summary.pushFailed++;
    }

    if (notification.email_pending) {
      if (!deps.sendEmail || !notification.email) {
        emailState = "skipped";
      } else {
        try {
          await deps.sendEmail(buildEmail(notification, notification.email, link, `${deps.siteUrl}/${locale}/avisos`));
          emailState = "sent";
          summary.emailSent++;
        } catch (error) {
          const status = error instanceof DeliveryError ? error.status : undefined;
          emailState = isTransient(status) ? "pending" : "failed";
          errors.push(`correo ${status ?? "red"}: ${describe(error)}`);
          summary.emailFailed++;
        }
      }
    }

    summary.removedEndpoints += deadEndpoints.length;
    await deps.finish({ id: notification.id, pushState, emailState, error: errors.length ? errors.join("; ").slice(0, 500) : null, deadEndpoints });
  }

  return summary;
}

/** Comparación en tiempo constante del secreto compartido (evita filtrarlo por el tiempo de respuesta). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
