import { z } from "zod";

/**
 * Cliente mínimo de Google (OAuth y Calendar) con `fetch`, sin SDK. Solo servidor. El único permiso que se pide es
 * `calendar.app.created`: INTERCEDE crea un calendario secundario propio y solo toca eventos ahí; no puede leer ni escribir en el
 * calendario principal ni en otros (CLAUDE.md §16.3, decisión del propietario).
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** Credenciales del cliente OAuth (las mismas del inicio de sesión con Google); null si faltan. */
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Cómo falló una llamada: decide si se reintenta, se desconecta o se da por perdida. */
export type GoogleFailure = "auth" | "not_found" | "rate" | "transient" | "permanent";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleFailure,
    readonly status: number,
  ) {
    super(message);
  }
}

const errorBodySchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string().optional(), errors: z.array(z.object({ reason: z.string().optional() })).optional() })]).optional(),
  error_description: z.string().optional(),
});

function classify(status: number, body: unknown): GoogleFailure {
  const parsed = errorBodySchema.safeParse(body);
  const code = parsed.success && typeof parsed.data.error === "string" ? parsed.data.error : "";
  const reasons = parsed.success && typeof parsed.data.error === "object" ? (parsed.data.error.errors ?? []).map((e) => e.reason ?? "") : [];
  if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client") return "auth";
  if (status === 401) return "auth";
  if (status === 403) {
    if (reasons.some((r) => /rateLimit|quotaExceeded/i.test(r))) return "rate";
    // Sin permiso (por ejemplo, la persona quitó el acceso): no se arregla reintentando
    return reasons.some((r) => /insufficientPermissions|authError|forbidden/i.test(r)) ? "auth" : "permanent";
  }
  if (status === 404 || status === 410) return "not_found";
  if (status === 429) return "rate";
  if (status >= 500) return "transient";
  return "permanent";
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new GoogleApiError("Sin conexión con Google", "transient", 0);
  }
  if (response.status === 204) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GoogleApiError(`Google respondió ${response.status}`, classify(response.status, body), response.status);
  return body;
}

// ───────────────────────── OAuth ─────────────────────────

export function buildAuthUrl(config: GoogleConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    // Sin conexión (token de actualización) y siempre con la pantalla de permiso: Google solo entrega el token de actualización así
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
});

function form(data: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() };
}

export async function exchangeCode(config: GoogleConfig, code: string, redirectUri: string) {
  const body = await call(TOKEN_URL, form({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }));
  return tokenSchema.parse(body);
}

export async function refreshAccessToken(config: GoogleConfig, refreshToken: string): Promise<string> {
  const body = await call(TOKEN_URL, form({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }));
  return tokenSchema.parse(body).access_token;
}

/** Revoca el permiso en Google (al desconectar). No lanza si ya estaba revocado. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await call(REVOKE_URL, form({ token }));
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.kind === "transient") throw error;
  }
}

// ───────────────────────── Calendar ─────────────────────────

const authed = (accessToken: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(extra.headers ?? {}) },
});

export interface GoogleEventBody {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: string[];
  reminders: { useDefault: false; overrides: { method: "popup"; minutes: number }[] };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
}

const idSchema = z.object({ id: z.string() });

export async function createCalendar(accessToken: string, summary: string, timeZone: string): Promise<string> {
  const body = await call(`${API}/calendars`, authed(accessToken, { method: "POST", body: JSON.stringify({ summary, timeZone }) }));
  return idSchema.parse(body).id;
}

/** ¿Existe todavía el calendario? Distingue "la persona borró el evento" de "la persona borró el calendario" cuando Google responde 404. */
export async function calendarExists(accessToken: string, calendarId: string): Promise<boolean> {
  try {
    await call(`${API}/calendars/${encodeURIComponent(calendarId)}`, authed(accessToken));
    return true;
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "not_found") return false;
    throw error;
  }
}

export async function insertEvent(accessToken: string, calendarId: string, event: GoogleEventBody): Promise<string> {
  const body = await call(`${API}/calendars/${encodeURIComponent(calendarId)}/events`, authed(accessToken, { method: "POST", body: JSON.stringify(event) }));
  return idSchema.parse(body).id;
}

export async function patchEvent(accessToken: string, calendarId: string, eventId: string, event: GoogleEventBody): Promise<void> {
  await call(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, authed(accessToken, { method: "PATCH", body: JSON.stringify(event) }));
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await call(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, authed(accessToken, { method: "DELETE" }));
}

const listSchema = z.object({ items: z.array(z.object({ id: z.string(), status: z.string().optional() })).optional() });

/** Busca un evento ya creado por INTERCEDE (propiedad privada): hace idempotente un reintento tras un éxito sin confirmar. */
export async function findEventByKey(accessToken: string, calendarId: string, key: string): Promise<string | null> {
  const params = new URLSearchParams({ privateExtendedProperty: `intercede=${key}`, showDeleted: "false", maxResults: "1" });
  const body = await call(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, authed(accessToken));
  const found = listSchema.parse(body).items?.find((item) => item.status !== "cancelled");
  return found?.id ?? null;
}
