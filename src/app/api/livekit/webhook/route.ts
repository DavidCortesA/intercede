import { WebhookReceiver } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveKitEnv } from "@/lib/livekit/server";
import { createAdminClient } from "@/lib/supabase/admin";

const idSchema = z.uuid();

/**
 * Webhook de LiveKit: mide el uso (minutos conectados por sala) para las horas-persona de las comunidades
 * (CLAUDE.md §14.7). LiveKit firma la petición con un JWT en `Authorization`; el SDK lo verifica con nuestro secreto.
 * Solo se registra al SALIR cada participante (con su hora de entrada); el id del evento es único, así que
 * un reintento no cuenta dos veces. No se guarda nada del contenido de las oraciones.
 */
export async function POST(request: Request) {
  let receiver: WebhookReceiver;
  try {
    const env = getLiveKitEnv();
    receiver = new WebhookReceiver(env.apiKey, env.apiSecret);
  } catch {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const rawBody = await request.text();
  let event: Awaited<ReturnType<WebhookReceiver["receive"]>>;
  try {
    event = await receiver.receive(rawBody, request.headers.get("authorization") ?? undefined);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  if (event.event !== "participant_left" || !event.participant || !event.room) return NextResponse.json({ ignored: true });

  const roomId = idSchema.safeParse(event.room.name);
  const userId = idSchema.safeParse(event.participant.identity);
  if (!roomId.success || !userId.success || !event.id) return NextResponse.json({ ignored: true });

  const leftAt = new Date(Number(event.createdAt) * 1000);
  const joinedSeconds = Number(event.participant.joinedAt);
  const joinedAt = joinedSeconds > 0 ? new Date(joinedSeconds * 1000) : leftAt;

  const { error } = await createAdminClient().rpc("record_usage", {
    p_event_id: event.id,
    p_room_id: roomId.data,
    p_user_id: userId.data,
    p_joined_at: joinedAt.toISOString(),
    p_left_at: leftAt.toISOString(),
  });
  // 500 → LiveKit reintenta; el id único evita duplicados
  if (error) return NextResponse.json({ error: "record_failed" }, { status: 500 });
  return NextResponse.json({ recorded: true });
}
