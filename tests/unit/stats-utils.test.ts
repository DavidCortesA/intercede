import { describe, expect, it } from "vitest";
import { compare, csvCell, statsSchema, statsToCsv, summarize, type CommunityStats, type StatsWeek } from "@/features/stats/stats";

const week = (n: number, over: Partial<StatsWeek> = {}): StatsWeek => ({
  week_start: `2026-10-${String(n).padStart(2, "0")}`,
  rooms: 1,
  person_minutes: 600,
  avg_participants: 6,
  had_attendance: true,
  requests_new: 2,
  requests_answered: 1,
  devotionals_read: 7,
  had_devotional_reads: true,
  members: 10 + n,
  ...over,
});

describe("summarize: totales sin romper la privacidad", () => {
  it("suma salas, peticiones y horas cuando todo se puede mostrar", () => {
    const totals = summarize([week(1), week(2), week(3)], 12);
    expect(totals).toMatchObject({ rooms: 3, requestsNew: 6, requestsAnswered: 3, personHours: 30, devotionalsRead: 21, membersStart: 11, membersEnd: 13 });
  });

  it("si alguna semana con asistencia está oculta, el total de horas NO se muestra (no se deduce por resta)", () => {
    const totals = summarize([week(1), week(2, { person_minutes: null, avg_participants: null }), week(3)], 12);
    expect(totals.personHours).toBeNull();
    expect(totals.rooms).toBe(3); // las salas no son datos de personas
  });

  it("sin asistencia el total es 0; con menos de 5 personas en el periodo se oculta", () => {
    expect(summarize([week(1, { person_minutes: null, had_attendance: false })], 0).personHours).toBe(0);
    expect(summarize([week(1)], 4).personHours).toBeNull();
  });

  it("los devocionales leídos se ocultan si alguna semana con lecturas quedó oculta", () => {
    const hidden = summarize([week(1), week(2, { devotionals_read: null, had_devotional_reads: true })], 12);
    expect(hidden.devotionalsRead).toBeNull();
    const none = summarize([week(1, { devotionals_read: null, had_devotional_reads: false })], 12);
    expect(none.devotionalsRead).toBe(0);
  });
});

describe("compare (plan Pro)", () => {
  it("compara las últimas 4 semanas con las 4 anteriores; sin semanas suficientes, nada", () => {
    expect(compare([week(1), week(2)], 12)).toBeNull();
    const weeks = Array.from({ length: 8 }, (_, i) => week(i + 1, { rooms: i < 4 ? 1 : 3 }));
    const result = compare(weeks, 12)!;
    expect(result.previous.rooms).toBe(4);
    expect(result.current.rooms).toBe(12);
  });

  it("cada periodo respeta la regla de ocultar por separado", () => {
    const weeks = Array.from({ length: 8 }, (_, i) => week(i + 1, i === 1 ? { person_minutes: null, avg_participants: null } : {}));
    const result = compare(weeks, 12)!;
    expect(result.previous.personHours).toBeNull();
    expect(result.current.personHours).toBe(40);
  });
});

describe("CSV", () => {
  const stats: CommunityStats = {
    level: "history",
    from: "2026-10-01",
    to: "2026-10-15",
    people_in_period: 12,
    weeks: [week(1), week(8, { person_minutes: null, avg_participants: null, devotionals_read: null })],
  };

  it("trae encabezado, BOM y deja vacío lo oculto", () => {
    const csv = statsToCsv(stats);
    expect(csv.startsWith("﻿semana,salas,horas_persona")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-10-01,1,10,6,2,1,7,11");
    expect(lines[2]).toBe("2026-10-08,1,,,2,1,,18");
  });

  it("antepone una comilla a lo que parezca una fórmula y cita lo que lleva comas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell(-3)).toBe("-3"); // un número negativo no es una fórmula
    expect(csvCell(null)).toBe("");
  });

  it("nunca incluye identificadores de personas", () => {
    expect(statsToCsv(stats)).not.toMatch(/user|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("statsSchema", () => {
  it("valida la respuesta de la base", () => {
    expect(statsSchema.safeParse({ level: "last_30_days", from: "2026-10-01", to: "2026-10-29", people_in_period: 0, weeks: [week(1)] }).success).toBe(true);
    expect(statsSchema.safeParse({ level: "otro", from: "x", to: "y", people_in_period: 0, weeks: [] }).success).toBe(false);
  });
});
