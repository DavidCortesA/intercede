import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/config/site";
import { calendarRedirectUri, getCalendarDeps, STATE_COOKIE } from "@/features/calendar/config";
import { buildAuthUrl } from "@/lib/google/client";
import { createClient } from "@/lib/supabase/server";

/**
 * Inicia la conexión con Google Calendar: un flujo de autorización APARTE del inicio de sesión (que sigue con permisos mínimos),
 * con el permiso acotado `calendar.app.created`. Exige una cuenta con sesión; el `state` aleatorio viaja también en una cookie
 * httpOnly para que el regreso solo valga para quien lo inició (defensa contra CSRF).
 */
export async function GET() {
  const back = (result: string) => NextResponse.redirect(`${SITE_URL}/es/perfil?calendario=${result}`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return NextResponse.redirect(`${SITE_URL}/es/entrar?next=%2Fperfil`);

  const deps = getCalendarDeps();
  if (!deps) return back("no_disponible");

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(buildAuthUrl(deps.config, calendarRedirectUri(), state));
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: SITE_URL.startsWith("https://"), maxAge: 600, path: "/api/calendar" });
  return response;
}
