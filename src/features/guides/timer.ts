import { z } from "zod";

/**
 * Temporizador de una guía de oración (CLAUDE.md §16 B3). El servidor guarda el progreso acumulado y, si corre,
 * DESDE CUÁNDO corre (hora del servidor). Cada dispositivo calcula aquí el segmento y la cuenta regresiva con la hora
 * del servidor estimada (`serverNow`), no con su reloj: por eso coinciden entre dispositivos y sobreviven a reconectar.
 * Funciones puras: las mismas reglas que `guide_segment_at` en la base.
 */

export const guideSegmentSchema = z.object({
  title: z.string(),
  minutes: z.number().int().min(1).max(60),
  instruction: z.string().optional(),
});
export type GuideSegment = z.infer<typeof guideSegmentSchema>;

export const guideRunSchema = z.object({
  title: z.string(),
  segments: z.array(guideSegmentSchema).min(1),
  extra_ms: z.array(z.number().int()),
  status: z.enum(["running", "paused"]),
  base_elapsed_ms: z.number(),
  running_since: z.string().nullable(),
});
export type GuideRun = z.infer<typeof guideRunSchema>;

export type GuidePhase = "running" | "paused" | "finished";

export interface GuideState {
  phase: GuidePhase;
  /** Segmento actual (0…n-1); en `finished` es el último. */
  index: number;
  /** Milisegundos que le quedan al segmento actual (0 si terminó). */
  remainingMs: number;
  /** Duración total del segmento actual, con los minutos extra. */
  durationMs: number;
  /** Duración total de la guía y progreso, para la barra. */
  totalMs: number;
  elapsedMs: number;
}

export function segmentDurationMs(run: Pick<GuideRun, "segments" | "extra_ms">, index: number): number {
  return (run.segments[index]?.minutes ?? 0) * 60_000 + (run.extra_ms[index] ?? 0);
}

export function totalMs(run: Pick<GuideRun, "segments" | "extra_ms">): number {
  return run.segments.reduce((sum, _segment, index) => sum + segmentDurationMs(run, index), 0);
}

/** Posición (ms desde el inicio) en el instante `serverNowMs` según el servidor. */
export function guidePosition(run: Pick<GuideRun, "status" | "base_elapsed_ms" | "running_since">, serverNowMs: number): number {
  if (run.status !== "running" || !run.running_since) return run.base_elapsed_ms;
  return run.base_elapsed_ms + Math.max(0, serverNowMs - new Date(run.running_since).getTime());
}

export function guideState(run: GuideRun, serverNowMs: number): GuideState {
  const position = guidePosition(run, serverNowMs);
  let start = 0;
  for (let index = 0; index < run.segments.length; index++) {
    const durationMs = segmentDurationMs(run, index);
    if (position < start + durationMs) {
      return { phase: run.status, index, remainingMs: start + durationMs - position, durationMs, totalMs: totalMs(run), elapsedMs: position };
    }
    start += durationMs;
  }
  const last = run.segments.length - 1;
  return { phase: "finished", index: last, remainingMs: 0, durationMs: segmentDurationMs(run, last), totalMs: start, elapsedMs: start };
}

/** mm:ss (o h:mm:ss) para la cuenta regresiva; redondea hacia arriba para no mostrar 0:00 con tiempo aún por correr. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Diferencia entre la hora del servidor y la de este dispositivo, estimada con el punto medio de la petición
 * (descuenta la mitad del tiempo de ida y vuelta). `serverNow ≈ Date.now() + offset`.
 */
export function clockOffset(serverTimeMs: number, requestStartMs: number, responseEndMs: number): number {
  return serverTimeMs - (requestStartMs + responseEndMs) / 2;
}
