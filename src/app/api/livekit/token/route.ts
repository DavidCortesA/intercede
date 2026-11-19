import { z } from "zod";
import { ROOM_GRACE_MINUTES } from "@/features/billing/limits";
import { createParticipantToken, getLiveKitEnv, getRoomService, LIVEKIT_ROOM_CEILING } from "@/lib/livekit/server";
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

  // El tiempo de la sala (plan o pase) más 5 minutos de gracia; pasado eso no se emiten más tokens (el servidor la cierra)
  const hardEndMs = new Date(room.ends_at).getTime() + ROOM_GRACE_MINUTES * 60_000;
  const secondsLeft = Math.floor((hardEndMs - Date.now()) / 1000);
  if (secondsLeft <= 0) return apiError("room_expired", 409);

  let wsUrl: string;
  try {
    wsUrl = getLiveKitEnv().wsUrl;
  } catch {
    return apiError("server_misconfigured", 500);
  }

  try {
    // Idempotente: crea la sala de audio con aforo y vida corta si no existe todavía
    await getRoomService().createRoom({ name: room.id, maxParticipants: LIVEKIT_ROOM_CEILING, emptyTimeout: 10 * 60 });
  } catch {
    // No es fatal: LiveKit también crea la sala al entrar el primer participante
  }

  const token = await createParticipantToken({
    roomName: room.id,
    identity: user.id,
    displayName: member.display_name,
    isHost: room.host_id === user.id,
    ttlSeconds: secondsLeft,
  });

  return apiOk({ token, serverUrl: wsUrl, identity: user.id });
}
