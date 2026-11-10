import { getCurrentSession } from "@/features/auth/queries";
import { createClient } from "@/lib/supabase/server";
import { extractRoomCode } from "./schemas";
import type { PrayerRequest, Room, RoomMember } from "./types";

export type RoomSnapshot =
  | { kind: "not_found" }
  | { kind: "closed"; name: string }
  | { kind: "locked"; name: string }
  | { kind: "join"; code: string; name: string; activeMembers: number; suggestedName: string }
  | {
      kind: "member";
      room: Room;
      meId: string;
      /** Todas las filas de la sala (incluye a quienes salieron, para mostrar sus nombres en peticiones). */
      members: RoomMember[];
      requests: PrayerRequest[];
    };

/**
 * Estado de la sala para la persona actual (servidor, con RLS):
 *  - sin sesión o fuera de la sala: vista previa con lo mínimo (peek_room) para unirse;
 *  - dentro de la sala: datos completos (miembros y peticiones).
 */
export async function getRoomSnapshot(rawCode: string): Promise<RoomSnapshot> {
  const code = extractRoomCode(rawCode);
  if (!code) return { kind: "not_found" };

  const supabase = await createClient();
  const { data: peek } = await supabase.rpc("peek_room", { p_code: code });
  const preview = peek?.[0];
  if (!preview) return { kind: "not_found" };
  if (preview.status === "closed") return { kind: "closed", name: preview.name };

  const session = await getCurrentSession();

  if (session) {
    // RLS: solo devuelve la sala si la persona participa (o participó) en ella
    const { data: room } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
    if (room) {
      const [{ data: members }, { data: requests }] = await Promise.all([
        supabase.from("room_members").select("*").eq("room_id", room.id),
        supabase.from("prayer_requests").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(200),
      ]);
      const me = members?.find((m) => m.user_id === session.userId);
      if (me && me.left_at === null) {
        return { kind: "member", room, meId: session.userId, members: members ?? [], requests: requests ?? [] };
      }
    }
  }

  if (preview.is_locked) return { kind: "locked", name: preview.name };

  return {
    kind: "join",
    code,
    name: preview.name,
    activeMembers: preview.active_members,
    suggestedName: session?.profile?.display_name ?? "",
  };
}
