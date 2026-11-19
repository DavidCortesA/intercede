/**
 * Reloj de una sala frente a su límite de tiempo (CLAUDE.md §14.8). El servidor es quien la cierra (ver
 * `/api/billing/enforce`); esto solo decide qué aviso mostrar. Los números coinciden con la base:
 * `join_room` y `rooms_over_limit` usan la misma gracia de 5 minutos.
 */
export const ROOM_GRACE_MINUTES = 5;
/** Avisos antes del límite, en minutos. */
export const ROOM_WARNING_MINUTES = [10, 2] as const;

export type RoomClockPhase = "ok" | "warning" | "urgent" | "grace" | "over";

export interface RoomClock {
  phase: RoomClockPhase;
  /** Minutos que faltan para el límite (redondeado hacia arriba); 0 si ya pasó. */
  minutesLeft: number;
  /** Minutos que quedan de gracia (solo en `grace`). */
  graceMinutesLeft: number;
}

export function roomClock(endsAtMs: number, nowMs: number): RoomClock {
  const msLeft = endsAtMs - nowMs;
  if (msLeft > ROOM_WARNING_MINUTES[0] * 60_000) return { phase: "ok", minutesLeft: Math.ceil(msLeft / 60_000), graceMinutesLeft: 0 };
  if (msLeft > ROOM_WARNING_MINUTES[1] * 60_000) return { phase: "warning", minutesLeft: Math.ceil(msLeft / 60_000), graceMinutesLeft: 0 };
  if (msLeft > 0) return { phase: "urgent", minutesLeft: Math.ceil(msLeft / 60_000), graceMinutesLeft: 0 };
  const graceLeftMs = ROOM_GRACE_MINUTES * 60_000 + msLeft;
  if (graceLeftMs > 0) return { phase: "grace", minutesLeft: 0, graceMinutesLeft: Math.ceil(graceLeftMs / 60_000) };
  return { phase: "over", minutesLeft: 0, graceMinutesLeft: 0 };
}
