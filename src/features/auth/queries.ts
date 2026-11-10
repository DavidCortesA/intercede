import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Profile = Tables<"profiles">;

export interface CurrentSession {
  userId: string;
  isAnonymous: boolean;
  profile: Profile | null;
}

/**
 * Sesión actual (invitado o cuenta) con su perfil, o `null` si no hay sesión.
 * Corre como la persona: RLS garantiza que solo puede leer su propio perfil.
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", claims.sub).maybeSingle();

  return { userId: claims.sub, isAnonymous: claims.is_anonymous === true, profile };
}
