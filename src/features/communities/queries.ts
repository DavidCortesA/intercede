import { cache } from "react";
import { notFound } from "next/navigation";
import { getCurrentSession } from "@/features/auth/queries";
import { createClient } from "@/lib/supabase/server";
import type { CommunityRole } from "./schemas";
import type { CommunityContext } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comunidad y rol de la persona en ella. Lee como la persona (RLS): si no es miembro, la comunidad
 * "no existe" para ella (404, sin revelar que existe). Se memoiza por petición (layout y página).
 */
export const getCommunityContext = cache(async (id: string): Promise<CommunityContext> => {
  if (!UUID.test(id)) notFound();
  const session = await getCurrentSession();
  if (!session || session.isAnonymous) notFound();

  const supabase = await createClient();
  const [{ data: community }, { data: membership }] = await Promise.all([
    supabase.from("communities").select("*").eq("id", id).maybeSingle(),
    supabase.from("community_members").select("role").eq("community_id", id).eq("user_id", session.userId).maybeSingle(),
  ]);
  if (!community || !membership) notFound();

  const role = membership.role as CommunityRole;
  return {
    community,
    role,
    userId: session.userId,
    timezone: session.profile?.timezone ?? "UTC",
    isLeader: role === "admin" || role === "leader",
    isAdmin: role === "admin",
  };
});

/** ¿Pertenece a alguna comunidad? Decide si aparece la pestaña Comunidades (navegación progresiva). */
export async function hasAnyCommunity(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase.from("community_members").select("community_id", { count: "exact", head: true }).eq("user_id", userId);
  return (count ?? 0) > 0;
}
