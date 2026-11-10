import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Next.js 16: `middleware` se llama `proxy`. Aquí solo enruta por locale;
// la sesión de Supabase se añade en la Fase 2.
export default createMiddleware(routing);

export const config = {
  // Excluye API, internos de Next y cualquier archivo con extensión
  // (manifest.webmanifest, sw.js, íconos, etc.).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
