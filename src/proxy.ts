import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

// Next.js 16: `middleware` se llama `proxy`. 1) enruta por locale; 2) refresca la sesión de
// Supabase si la persona ya tiene una.
export default async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);
  return updateSession(request, response);
}

export const config = {
  // Excluye API, los enlaces de correo/OAuth (/auth/*), internos de Next y cualquier archivo con
  // extensión (manifest.webmanifest, sw.js, íconos, etc.).
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
