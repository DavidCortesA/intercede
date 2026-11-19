import { SITE_URL } from "@/config/site";
import { getEncryptionKey } from "@/lib/crypto/secret-box";
import { getGoogleConfig } from "@/lib/google/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SyncDeps } from "./sync";

/** URI de redirección que hay que registrar en Google Cloud (Credenciales → ID de cliente OAuth → URI de redirección autorizados). */
export const CALENDAR_CALLBACK_PATH = "/api/calendar/google/callback";
/** Cookie con el `state` del flujo de autorización (httpOnly, solo para /api/calendar). */
export const STATE_COOKIE = "gcal_state";
export const calendarRedirectUri = () => `${SITE_URL}${CALENDAR_CALLBACK_PATH}`;

/** Lo necesario para sincronizar, o null si falta configuración (cliente de Google, llave de cifrado o service role). */
export function getCalendarDeps(): SyncDeps | null {
  const config = getGoogleConfig();
  if (!config) return null;
  try {
    return { admin: createAdminClient(), config, siteUrl: SITE_URL, key: getEncryptionKey() };
  } catch {
    return null;
  }
}
