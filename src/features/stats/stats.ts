import { z } from "zod";

/**
 * Estadísticas para líderes (CLAUDE.md §16 B5). La base entrega SOLO agregados semanales por comunidad y ya oculta
 * (null) todo indicador de tiempo, participación o devocionales que involucre a menos de 5 personas. Aquí se suman las
 * semanas SIN deshacer esa protección: un total no se muestra si alguna semana oculta quedaría deducible por resta.
 */

const weekSchema = z.object({
  week_start: z.string(),
  rooms: z.number().int(),
  person_minutes: z.number().nullable(),
  avg_participants: z.number().nullable(),
  had_attendance: z.boolean(),
  requests_new: z.number().int(),
  requests_answered: z.number().int(),
  devotionals_read: z.number().nullable(),
  had_devotional_reads: z.boolean(),
  members: z.number().int(),
});
export type StatsWeek = z.infer<typeof weekSchema>;

export const statsSchema = z.object({
  level: z.enum(["last_30_days", "history"]),
  from: z.string(),
  to: z.string(),
  people_in_period: z.number().int(),
  weeks: z.array(weekSchema),
});
export type CommunityStats = z.infer<typeof statsSchema>;

/** Mínimo de personas para mostrar un indicador de tiempo o participación (igual que en la base). */
export const MIN_PEOPLE = 5;

export interface StatsTotals {
  rooms: number;
  requestsNew: number;
  requestsAnswered: number;
  /** Horas-persona de la comunidad; null si algún dato quedaría deducible (menos de 5 personas en alguna semana). */
  personHours: number | null;
  devotionalsRead: number | null;
  membersStart: number;
  membersEnd: number;
}

/** Suma un rango de semanas (por defecto todas). */
export function summarize(weeks: StatsWeek[], peopleInPeriod = MIN_PEOPLE): StatsTotals {
  const hiddenAttendance = weeks.some((week) => week.had_attendance && week.person_minutes === null);
  const noAttendance = weeks.every((week) => !week.had_attendance);
  const hiddenReads = weeks.some((week) => week.had_devotional_reads && week.devotionals_read === null);

  const minutes = weeks.reduce((sum, week) => sum + (week.person_minutes ?? 0), 0);
  const reads = weeks.reduce((sum, week) => sum + (week.devotionals_read ?? 0), 0);

  return {
    rooms: weeks.reduce((sum, week) => sum + week.rooms, 0),
    requestsNew: weeks.reduce((sum, week) => sum + week.requests_new, 0),
    requestsAnswered: weeks.reduce((sum, week) => sum + week.requests_answered, 0),
    // Sin asistencia no hay nada que ocultar (0 horas); con asistencia, hace falta que ninguna semana esté oculta y que
    // el periodo tenga al menos 5 personas distintas
    personHours: noAttendance ? 0 : hiddenAttendance || peopleInPeriod < MIN_PEOPLE ? null : Math.round((minutes / 60) * 10) / 10,
    devotionalsRead: hiddenReads ? null : reads,
    membersStart: weeks[0]?.members ?? 0,
    membersEnd: weeks.at(-1)?.members ?? 0,
  };
}

export interface Comparison {
  current: StatsTotals;
  previous: StatsTotals;
}

/**
 * Comparativa (plan Pro): las últimas `size` semanas contra las `size` anteriores. Solo si hay semanas suficientes.
 * Cada periodo respeta la regla de ocultar por separado (el número de personas se toma del periodo completo).
 */
export function compare(weeks: StatsWeek[], peopleInPeriod: number, size = 4): Comparison | null {
  if (weeks.length < size * 2) return null;
  return {
    current: summarize(weeks.slice(-size), peopleInPeriod),
    previous: summarize(weeks.slice(-size * 2, -size), peopleInPeriod),
  };
}

/** Protege contra inyección de fórmulas al abrir el CSV en Excel (CLAUDE.md §15.6): comilla delante de = + - @. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === "string" ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV con SOLO los datos agregados que la pantalla muestra (lo oculto sale vacío). Con BOM para que Excel lea los acentos. */
export function statsToCsv(stats: CommunityStats): string {
  const header = ["semana", "salas", "horas_persona", "participacion_media", "peticiones_nuevas", "peticiones_respondidas", "devocionales_leidos", "miembros"];
  const rows = stats.weeks.map((week) =>
    [
      week.week_start,
      week.rooms,
      week.person_minutes === null ? null : Math.round((week.person_minutes / 60) * 10) / 10,
      week.avg_participants,
      week.requests_new,
      week.requests_answered,
      week.devotionals_read,
      week.members,
    ]
      .map(csvCell)
      .join(","),
  );
  return `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`;
}
