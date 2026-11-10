import { buildIcs, icsFileName } from "@/features/events/ics";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Descarga un evento de la comunidad como archivo de calendario (.ics). Lee el evento COMO la persona (RLS):
 * si no es de la comunidad, el evento "no existe" (404). La respuesta es privada y nunca se cachea.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/events/[id]/ics">) {
  const { id } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!UUID.test(id)) return new Response("Not found", { status: 404, headers });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("Unauthorized", { status: 401, headers });

  const { data: event } = await supabase.from("events").select("id, community_id, title, description, starts_at, ends_at").eq("id", id).maybeSingle();
  if (!event) return new Response("Not found", { status: 404, headers });

  const origin = new URL(request.url).origin;
  const body = buildIcs({
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    url: `${origin}/${routing.defaultLocale}/comunidades/${event.community_id}/eventos`,
  });

  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(event.title)}"`,
    },
  });
}
