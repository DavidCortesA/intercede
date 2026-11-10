import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { z } from "zod";

export type ApiErrorCode =
  | "invalid_request"
  | "forbidden_origin"
  | "unauthenticated"
  | "not_a_member"
  | "removed"
  | "room_closed"
  | "not_host"
  | "participant_not_connected"
  | "livekit_unavailable"
  | "server_misconfigured"
  | "member_not_found"
  | "cannot_remove_self"
  | "account_required"
  | "too_many_devices"
  | "invalid_endpoint"
  | "unexpected";

/** Respuesta de error uniforme: `{ error: <código> }`, siempre sin caché. */
export function apiError(error: ApiErrorCode, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiOk(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Defensa CSRF para endpoints con cookies de sesión: el origen debe ser este mismo sitio
 * (si el navegador lo envía) y el cuerpo debe ser JSON (un formulario de otro sitio no puede
 * enviar `application/json` sin pasar por CORS).
 */
function sameSiteJson(request: Request): boolean {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function parseJson<T extends z.ZodType>(request: Request, schema: T) {
  if (!sameSiteJson(request)) return { ok: false as const, response: apiError("forbidden_origin", 403) };
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false as const, response: apiError("invalid_request", 400) };
  return { ok: true as const, data: parsed.data as z.output<T> };
}

type Room = Database["public"]["Tables"]["rooms"]["Row"];
type Member = Database["public"]["Tables"]["room_members"]["Row"];

export interface RoomAuthorization {
  user: User;
  supabase: SupabaseClient<Database>;
  room: Room;
  member: Member;
}

/**
 * La autorización real: lee la sala y la membresía COMO la persona (RLS). Nunca confía en ids
 * o roles que vengan del cliente. Exige estar presente (no haber salido ni haber sido expulsada),
 * sala abierta y, si se pide, ser el anfitrión.
 */
export async function authorizeRoomRequest(
  roomId: string,
  options: { requireHost?: boolean } = {},
): Promise<{ ok: true; auth: RoomAuthorization } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { ok: false, response: apiError("unauthenticated", 401) };

  const [{ data: member }, { data: room }] = await Promise.all([
    supabase.from("room_members").select("*").eq("room_id", roomId).eq("user_id", user.id).maybeSingle(),
    supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
  ]);

  if (member?.removed_at) return { ok: false, response: apiError("removed", 403) };
  if (!member || !room) return { ok: false, response: apiError("not_a_member", 403) };
  // Cerrar una sala saca a todas las personas (left_at): antes de "ya no estás" se explica que se cerró
  if (room.status !== "open") return { ok: false, response: apiError("room_closed", 409) };
  if (member.left_at !== null) return { ok: false, response: apiError("not_a_member", 403) };
  if (options.requireHost && room.host_id !== user.id) return { ok: false, response: apiError("not_host", 403) };

  return { ok: true, auth: { user, supabase, room, member } };
}
