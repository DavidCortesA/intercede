import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Cliente con la service role: salta RLS. SOLO para Route Handlers del servidor que necesitan un secreto
 * (CLAUDE.md §4): hoy, eliminar una cuenta. Nunca se importa desde un Client Component ni se usa para
 * decidir qué ve una persona.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (solo servidor).");
  return createClient<Database>(getSupabasePublicEnv().url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
