import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/** ¿Trae la petición cookies de sesión de Supabase? (sb-<ref>-auth-token[.n]) */
function hasSupabaseSession(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

/**
 * Refresca la sesión de Supabase cuando existe y copia las cookies renovadas a la respuesta.
 * Solo corre si ya hay cookies de sesión: la landing y los visitantes sin sesión no pagan
 * ningún costo ni reciben cookies (la landing es estática e independiente de la sesión).
 *
 * Usa getClaims(), que valida el JWT sin abrir una conexión a la base de datos. El proxy
 * no decide autorización: solo mantiene viva la sesión (RLS es la barrera real).
 */
export async function updateSession(request: NextRequest, response: NextResponse): Promise<NextResponse> {
  if (!hasSupabaseSession(request)) return response;

  const { url, publishableKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Evita que una CDN cachee respuestas con cookies de sesión renovadas
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
