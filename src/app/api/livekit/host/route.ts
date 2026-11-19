import { TrackType } from "livekit-server-sdk";
import { z } from "zod";
import { toRoomError } from "@/features/rooms/errors";
import { getRoomService } from "@/lib/livekit/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, apiOk, authorizeRoomRequest, parseJson, type ApiErrorCode } from "@/lib/livekit/route-auth";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mute_all"), roomId: z.uuid() }),
  z.object({ action: z.literal("mute"), roomId: z.uuid(), identity: z.uuid() }),
  z.object({ action: z.literal("remove"), roomId: z.uuid(), identity: z.uuid() }),
  z.object({ action: z.literal("close"), roomId: z.uuid() }),
  z.object({ action: z.literal("end_breakout"), roomId: z.uuid() }),
]);

/** ¿El error de LiveKit es "no existe" (persona o sala ya no están conectadas)? */
function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number; code?: string } | null)?.status;
  const code = (error as { code?: string } | null)?.code;
  return status === 404 || code === "not_found";
}

/**
 * La API de LiveKit puede fallar de forma pasajera (se vio una respuesta vacía intermitente).
 * Una acción de moderación no debe perderse por eso: se reintenta una vez, salvo "no existe".
 */
async function withRetry<T>(task: () => Promise<T>, attempts = 2): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (attempts <= 1 || isNotFound(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return withRetry(task, attempts - 1);
  }
}

/**
 * Controles del anfitrión sobre el audio: silenciar a una persona o a todas, expulsar y cerrar la
 * sala. La autorización es SIEMPRE del servidor (el anfitrión se lee de la base con RLS) y la
 * expulsión se ejecuta desde aquí con la API de LiveKit: un token vigente no se "revoca" solo.
 */
export async function POST(request: Request) {
  const body = await parseJson(request, bodySchema);
  if (!body.ok) return body.response;
  const command = body.data;

  const authorization = await authorizeRoomRequest(command.roomId, { requireHost: true });
  if (!authorization.ok) return authorization.response;
  const { user, supabase, room } = authorization.auth;

  const livekit = getRoomService();

  try {
    switch (command.action) {
      case "mute": {
        if (command.identity === user.id) return apiError("invalid_request", 400);
        const participant = await withRetry(() => livekit.getParticipant(room.id, command.identity)).catch((error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        });
        if (!participant) return apiError("participant_not_connected", 404);
        const muted = await muteAudioTracks(livekit, room.id, participant);
        return apiOk({ muted });
      }

      case "mute_all": {
        const participants = await withRetry(() => livekit.listParticipants(room.id)).catch((error: unknown) => {
          if (isNotFound(error)) return [];
          throw error;
        });
        let muted = 0;
        for (const participant of participants) {
          if (participant.identity === user.id) continue; // el anfitrión no se silencia a sí mismo
          muted += await muteAudioTracks(livekit, room.id, participant);
        }
        return apiOk({ muted });
      }

      case "remove": {
        // Primero la base (marca la expulsión y bloquea el reingreso); luego se corta el audio.
        const { error } = await supabase.rpc("remove_member", { p_room_id: room.id, p_user_id: command.identity });
        if (error) {
          const code = toRoomError(error);
          if (code === "not_host") return apiError("not_host", 403);
          if (code === "member_not_found") return apiError("member_not_found", 404);
          if (code === "cannot_remove_self") return apiError("cannot_remove_self", 400);
          return apiError("unexpected", 500);
        }
        // Quien está en un grupo pequeño también se saca de su sala de audio
        const groupRooms = await breakoutRooms(room.id);
        for (const name of groupRooms) await livekit.removeParticipant(name, command.identity).catch(() => undefined);
        await withRetry(() => livekit.removeParticipant(room.id, command.identity)).catch((livekitError: unknown) => {
          if (!isNotFound(livekitError)) throw livekitError; // si no estaba conectada, ya está fuera
        });
        return apiOk({ removed: true });
      }

      case "end_breakout": {
        // Primero la base (todos vuelven a la sala principal); luego se cierran las salas de audio de los grupos
        const { data: groupRooms, error } = await supabase.rpc("end_breakout", { p_room_id: room.id });
        if (error) return apiError(error.message === "no_breakout" ? "no_breakout" : "not_host", error.message === "no_breakout" ? 404 : 403);
        for (const name of groupRooms ?? []) await livekit.deleteRoom(name).catch(() => undefined);
        return apiOk({ ended: true });
      }

      case "close": {
        // Las salas de los grupos se leen ANTES de cerrar (cerrar la sala termina el reparto)
        const groupRooms = await breakoutRooms(room.id);
        const { error } = await supabase.rpc("close_room", { p_room_id: room.id });
        if (error) return apiError(toRoomError(error) === "not_host" ? "not_host" : "unexpected", error ? 403 : 500);
        // Desconecta a todas las personas del audio (ya no pueden volver: la sala está cerrada)
        await withRetry(() => livekit.deleteRoom(room.id)).catch((livekitError: unknown) => {
          if (!isNotFound(livekitError)) throw livekitError;
        });
        for (const name of groupRooms) await livekit.deleteRoom(name).catch(() => undefined);
        return apiOk({ closed: true });
      }
    }
  } catch {
    const code: ApiErrorCode = "livekit_unavailable";
    return apiError(code, 502);
  }
}

async function muteAudioTracks(
  livekit: ReturnType<typeof getRoomService>,
  roomName: string,
  participant: Awaited<ReturnType<ReturnType<typeof getRoomService>["getParticipant"]>>,
): Promise<number> {
  let muted = 0;
  for (const track of participant.tracks) {
    if (track.type === TrackType.AUDIO && !track.muted) {
      await withRetry(() => livekit.mutePublishedTrack(roomName, participant.identity, track.sid, true));
      muted += 1;
    }
  }
  return muted;
}

/** Salas de audio de los grupos pequeños activos de una sala (lectura de servidor; la autorización ya se hizo). */
async function breakoutRooms(roomId: string): Promise<string[]> {
  try {
    const { data } = await createAdminClient().rpc("breakout_group_rooms", { p_room_id: roomId });
    return data ?? [];
  } catch {
    return [];
  }
}
