import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/config/site";
import { calendarRedirectUri, getCalendarDeps, STATE_COOKIE } from "@/features/calendar/config";
import { CALENDAR_NAME } from "@/features/calendar/sync";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { CALENDAR_SCOPE, createCalendar, exchangeCode, refreshAccessToken, revokeToken } from "@/lib/google/client";
import { createClient } from "@/lib/supabase/server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Regreso de Google. Comprueba el `state` contra la cookie y la sesión, cambia el código por el token de actualización, comprueba que el
 * permiso concedido sea SOLO el acotado, crea el calendario secundario "INTERCEDE", guarda el token CIFRADO (atado a esta persona) y
 * pone en cola lo que ya le corresponde (asistencias confirmadas y salas que sigue).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => {
    const response = NextResponse.redirect(`${SITE_URL}/es/perfil?calendario=${result}`);
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/calendar" });
    return response;
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || user.is_anonymous) return NextResponse.redirect(`${SITE_URL}/es/entrar?next=%2Fperfil`);

  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((part) => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
  const state = url.searchParams.get("state");
  if (!cookie || !state || !same(cookie, state)) return back("error");
  if (url.searchParams.get("error")) return back("cancelado");
  const code = url.searchParams.get("code");
  if (!code) return back("error");

  const deps = getCalendarDeps();
  if (!deps) return back("no_disponible");

  try {
    const tokens = await exchangeCode(deps.config, code, calendarRedirectUri());
    // Sin token de actualización no se puede sincronizar sin conexión (Google solo lo entrega con el permiso nuevo)
    if (!tokens.refresh_token) return back("sin_token");
    // El permiso debe ser exactamente el acotado: si Google devuelve más (o menos), se revoca y se rechaza
    const granted = (tokens.scope ?? "").split(" ").filter(Boolean);
    if (!granted.includes(CALENDAR_SCOPE) || granted.some((scope) => scope.includes("calendar") && scope !== CALENDAR_SCOPE)) {
      await revokeToken(tokens.refresh_token).catch(() => undefined);
      return back("permiso");
    }

    const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
    const accessToken = await refreshAccessToken(deps.config, tokens.refresh_token);
    const calendarId = await createCalendar(accessToken, CALENDAR_NAME, profile?.timezone ?? "UTC");

    // Reconectar parte de cero: sin vínculos ni cola de antes (eran de otro calendario)
    await deps.admin.from("calendar_sync_jobs").delete().eq("user_id", user.id);
    await deps.admin.from("calendar_event_links").delete().eq("user_id", user.id);
    const { error } = await deps.admin.from("calendar_connections").upsert({
      user_id: user.id,
      provider: "google",
      scope: CALENDAR_SCOPE,
      refresh_token_encrypted: encryptSecret(tokens.refresh_token, user.id, deps.key),
      calendar_id: calendarId,
      status: "connected",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) return back("error");

    await deps.admin.rpc("calendar_backfill", { p_user_id: user.id });
    return back("ok");
  } catch {
    return back("error");
  }
}
