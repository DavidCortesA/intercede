import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { entitlementsSchema, type Entitlements } from "./schemas";

/**
 * Límites efectivos (plan + extras) de una comunidad, o los gratuitos si no se pasa comunidad. Es una
 * envoltura delgada de `get_entitlements` en la base: el cálculo vive en un solo lugar (CLAUDE.md §14.8).
 * Se llama COMO la persona (RLS): solo los miembros de una comunidad ven sus límites.
 */
export async function getEntitlements(supabase: SupabaseClient<Database>, communityId?: string): Promise<Entitlements | null> {
  const { data, error } = await supabase.rpc("get_entitlements", communityId ? { p_community_id: communityId } : {});
  if (error) return null;
  const parsed = entitlementsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
