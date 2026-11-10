import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/features/auth/errors";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

/** Regreso de proveedores OAuth (Google): canjea el código por la sesión (PKCE). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), `/${routing.defaultLocale}/perfil`);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL(`/${routing.defaultLocale}/entrar?error=link`, origin));
}
