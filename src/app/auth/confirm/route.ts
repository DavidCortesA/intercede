import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/features/auth/errors";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "recovery", "email_change", "signup", "invite", "magiclink"];

/**
 * Destino de los enlaces de los correos (confirmar cuenta, recuperar contraseña, confirmar el
 * correo de un invitado que crea cuenta). Dos formas, según la plantilla del correo:
 *  1. `token_hash` + `type` (plantillas de supabase/templates): se verifica EN EL SERVIDOR y
 *     funciona aunque la persona abra el correo en otro dispositivo o navegador.
 *  2. `code` (plantillas por defecto de Supabase, flujo PKCE): se canjea por la sesión. Solo
 *     funciona en el mismo navegador donde se pidió el correo. Es lo que ocurre mientras el
 *     proyecto remoto use el SMTP por defecto del plan gratuito, que no admite plantillas propias.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"), `/${routing.defaultLocale}/orar`);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Enlace inválido o vencido: a la pantalla de entrar con un aviso
  return NextResponse.redirect(new URL(`/${routing.defaultLocale}/entrar?error=link`, origin));
}
