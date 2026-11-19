import { z } from "zod";
import { getCalendarDeps } from "@/features/calendar/config";
import { disconnectGoogleCalendar } from "@/features/calendar/sync";
import { apiError, apiOk, parseJson } from "@/lib/livekit/route-auth";
import { createClient } from "@/lib/supabase/server";

/** Desconecta Google Calendar: revoca el permiso en Google y borra lo guardado (conexión cifrada, vínculos y cola). */
export async function POST(request: Request) {
  const body = await parseJson(request, z.object({}).strict());
  if (!body.ok) return body.response;

  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return apiError("unauthenticated", 401);

  const deps = getCalendarDeps();
  if (!deps) return apiError("server_misconfigured", 500);
  await disconnectGoogleCalendar(deps, data.user.id);
  return apiOk({ disconnected: true });
}
