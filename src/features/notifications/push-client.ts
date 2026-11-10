/**
 * Utilidades del navegador para los avisos push (solo se importan desde Client Components).
 *
 * Reglas de CLAUDE.md §6: el permiso se pide en contexto (al tocar "Activar avisos"), nunca al cargar
 * la página; en iOS los avisos solo existen con la app instalada en la pantalla de inicio (16.4+),
 * así que primero se explica la instalación.
 */

export type PushSupport = "supported" | "unsupported" | "needs_install" | "unavailable";
export type SubscribeResult = "subscribed" | "denied" | "too_many_devices" | "account_required" | "failed";

const vapidPublicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se presenta como Mac con pantalla táctil
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getPushSupport(): PushSupport {
  if (!vapidPublicKey()) return "unavailable";
  if (isIos() && !isStandalone()) return "needs_install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

/** Clave pública VAPID (base64url) → bytes, el formato que pide `pushManager.subscribe`. */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** El service worker no se registra en desarrollo: no se espera para siempre. */
async function getRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function subscribeThisDevice(): Promise<SubscribeResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const registration = await getRegistration();
    if (!registration) return "failed";

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidPublicKey()) }));

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (response.ok) return "subscribed";

    const body: { error?: string } | null = await response.json().catch(() => null);
    // Si el servidor no pudo guardarla, no se deja un dispositivo suscrito que nunca recibirá nada
    if (body?.error !== "too_many_devices" && body?.error !== "account_required") await subscription.unsubscribe().catch(() => false);
    if (body?.error === "too_many_devices") return "too_many_devices";
    if (body?.error === "account_required") return "account_required";
    return "failed";
  } catch {
    return "failed";
  }
}

export async function unsubscribeThisDevice(): Promise<boolean> {
  try {
    const subscription = await getCurrentSubscription();
    if (!subscription) return true;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    const response = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
