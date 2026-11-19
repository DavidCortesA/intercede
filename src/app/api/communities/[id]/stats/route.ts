import { statsSchema, statsToCsv } from "@/features/stats/stats";
import { createClient } from "@/lib/supabase/server";

/**
 * Descarga las estadísticas agregadas de la comunidad en CSV. Se lee COMO la persona: la base exige liderazgo y plan
 * Plus/Pro, y solo devuelve agregados (lo que involucra a menos de 5 personas sale vacío). Nunca cacheable.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/communities/[id]/stats">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "unauthenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { data, error } = await supabase.rpc("community_stats", { p_community_id: id });
  if (error) {
    const forbidden = error.message === "not_leader" || error.message === "plan_required";
    return Response.json({ error: forbidden ? error.message : "unavailable" }, { status: forbidden ? 403 : 400, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = statsSchema.safeParse(data);
  if (!parsed.success) return Response.json({ error: "unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });

  return new Response(statsToCsv(parsed.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="estadisticas-${parsed.data.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
