import { z } from "zod";
import { ROOM_CAPACITY } from "@/features/rooms/schemas";
import { createParticipantToken, getLiveKitEnv, getRoomService } from "@/lib/livekit/server";
import { apiError, apiOk, authorizeRoomRequest, parseJson } from "@/lib/livekit/route-auth";

const bodySchema = z.object({ roomId: z.uuid() });

/**
 * Emite el token de LiveKit de una persona para una sala. Valida la sesión de Supabase y la
 * membresía (RLS); el navegador se conecta directo a LiveKit con ese token (CLAUDE.md §3).
 * La respuesta nunca se cachea ni el service worker la guarda (es `/api/*`, solo red).
 */
export async function POST(request: Request) {
  const body = await parseJson(request, bodySchema);
  if (!body.ok) return body.response;

  const authorization = await authorizeRoomRequest(body.data.roomId);
  if (!authorization.ok) return authorization.response;
  const { user, room, member } = authorization.auth;

  let wsUrl: string;
  try {
    wsUrl = getLiveKitEnv().wsUrl;
  } catch {
    return apiError("server_misconfigured", 500);
  }

  try {
    // Idempotente: crea la sala de audio con aforo y vida corta si no existe todavía
    await getRoomService().createRoom({ name: room.id, maxParticipants: ROOM_CAPACITY, emptyTimeout: 10 * 60 });
  } catch {
    // No es fatal: LiveKit también crea la sala al entrar el primer participante
  }

  const token = await createParticipantToken({
    roomName: room.id,
    identity: user.id,
    displayName: member.display_name,
    isHost: room.host_id === user.id,
  });

  return apiOk({ token, serverUrl: wsUrl, identity: user.id });
}
