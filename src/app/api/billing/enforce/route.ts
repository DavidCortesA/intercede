import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRoomService } from "@/lib/livekit/server";
import { createAdminClient } from "@/lib/supabase/admin";

function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cierra las salas que pasaron su tiempo MÁS la gracia de 5 minutos (CLAUDE.md §14.8): marca la sala cerrada en la
 * base y desconecta el audio en LiveKit (un token vigente no se "revoca" solo). La llama pg_cron cada minuto
 * mediante pg_net con un secreto compartido (`ENFORCER_SECRET` aquí, `enforcer_secret` en Vault). Los avisos previos
 * (10 y 2 minutos) los muestra la propia sala a partir de `rooms.ends_at`.
 */
export async function POST(request: Request) {
  const secret = process.env.ENFORCER_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  if (!sameSecret(request.headers.get("x-enforcer-secret"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: roomIds, error } = await admin.rpc("rooms_over_limit");
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });

  // Repartos en grupos pequeños vencidos: se cierran y se cortan sus salas de audio (los dispositivos ya volvieron solos)
  let breakouts = 0;
  const { data: expiredGroups } = await admin.rpc("end_expired_breakouts");
  for (const name of expiredGroups ?? []) {
    breakouts += 1;
    await getRoomService().deleteRoom(name).catch(() => undefined);
  }

  let closed = 0;
  for (const roomId of roomIds ?? []) {
    // Las salas de los grupos se leen antes de cerrar (cerrar la sala termina el reparto)
    const { data: groupRooms } = await admin.rpc("breakout_group_rooms", { p_room_id: roomId });
    // Primero la base (la sala ya no admite a nadie); luego se corta el audio
    const { error: closeError } = await admin.rpc("close_room_system", { p_room_id: roomId });
    if (closeError) continue;
    closed += 1;
    for (const name of groupRooms ?? []) await getRoomService().deleteRoom(name).catch(() => undefined);
    try {
      await getRoomService().deleteRoom(roomId);
    } catch {
      // Si LiveKit no la conoce ya (sala vacía) no hay nada que cortar
    }
  }
  return NextResponse.json({ closed, breakouts }, { headers: { "Cache-Control": "no-store" } });
}
