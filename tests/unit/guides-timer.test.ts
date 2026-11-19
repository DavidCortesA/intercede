import { describe, expect, it } from "vitest";
import { clockOffset, formatCountdown, guidePosition, guideRunSchema, guideState, totalMs, type GuideRun } from "@/features/guides/timer";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const run = (over: Partial<GuideRun> = {}): GuideRun => ({
  title: "Prueba",
  segments: [
    { title: "Entrada", minutes: 2 },
    { title: "Centro", minutes: 10 },
    { title: "Cierre", minutes: 3 },
  ],
  extra_ms: [0, 0, 0],
  status: "running",
  base_elapsed_ms: 0,
  running_since: new Date(T0).toISOString(),
  ...over,
});

describe("temporizador de guías (hora del servidor)", () => {
  it("ubica el segmento y la cuenta regresiva a partir de cuándo empezó", () => {
    expect(guideState(run(), T0)).toMatchObject({ phase: "running", index: 0, remainingMs: 2 * MIN, durationMs: 2 * MIN, totalMs: 15 * MIN });
    expect(guideState(run(), T0 + 90_000)).toMatchObject({ index: 0, remainingMs: 30_000 });
    expect(guideState(run(), T0 + 2 * MIN)).toMatchObject({ index: 1, remainingMs: 10 * MIN });
    expect(guideState(run(), T0 + 14 * MIN + 30_000)).toMatchObject({ index: 2, remainingMs: 30_000 });
  });

  it("al terminar queda en finished en el último segmento", () => {
    expect(guideState(run(), T0 + 15 * MIN)).toMatchObject({ phase: "finished", index: 2, remainingMs: 0, elapsedMs: 15 * MIN });
    expect(guideState(run(), T0 + 99 * MIN).phase).toBe("finished");
  });

  it("en pausa el progreso no avanza aunque pase el tiempo", () => {
    const paused = run({ status: "paused", running_since: null, base_elapsed_ms: 3 * MIN });
    expect(guidePosition(paused, T0 + 60 * MIN)).toBe(3 * MIN);
    expect(guideState(paused, T0 + 60 * MIN)).toMatchObject({ phase: "paused", index: 1, remainingMs: 9 * MIN });
  });

  it("después de saltar o reanudar suma el progreso acumulado al tiempo corrido", () => {
    const resumed = run({ base_elapsed_ms: 2 * MIN, running_since: new Date(T0).toISOString() });
    expect(guideState(resumed, T0 + 5 * MIN)).toMatchObject({ index: 1, remainingMs: 5 * MIN });
  });

  it("los minutos extra alargan solo ese segmento y la guía completa", () => {
    const extended = run({ extra_ms: [0, 60_000, 0] });
    expect(totalMs(extended)).toBe(16 * MIN);
    expect(guideState(extended, T0 + 12 * MIN + 30_000)).toMatchObject({ index: 1, remainingMs: 30_000, durationMs: 11 * MIN });
  });

  it("una hora del servidor anterior al inicio no da tiempos negativos", () => {
    expect(guidePosition(run(), T0 - 5_000)).toBe(0);
  });

  it("formatCountdown redondea hacia arriba y usa horas cuando hace falta", () => {
    expect(formatCountdown(2 * MIN)).toBe("2:00");
    expect(formatCountdown(59_001)).toBe("1:00");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
  });

  it("dos dispositivos con relojes distintos muestran lo mismo al corregir con la hora del servidor", () => {
    const serverNow = T0 + 5 * MIN;
    // A atrasado 40 s y B adelantado 25 s respecto del servidor; ambos miden su diferencia con una petición de 200 ms
    const deviceA = serverNow - 40_000;
    const deviceB = serverNow + 25_000;
    const offsetA = clockOffset(serverNow, deviceA - 100, deviceA + 100);
    const offsetB = clockOffset(serverNow, deviceB - 100, deviceB + 100);
    const a = guideState(run(), deviceA + offsetA);
    const b = guideState(run(), deviceB + offsetB);
    expect(Math.abs(a.remainingMs - b.remainingMs)).toBeLessThan(1000);
    expect(a.index).toBe(b.index);
  });

  it("guideRunSchema acepta la fila de la base y rechaza una mal formada", () => {
    expect(guideRunSchema.safeParse(run()).success).toBe(true);
    expect(guideRunSchema.safeParse({ ...run(), segments: [] }).success).toBe(false);
    expect(guideRunSchema.safeParse({ ...run(), status: "otro" }).success).toBe(false);
  });
});
