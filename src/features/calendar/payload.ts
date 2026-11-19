import { wallClock } from "@/features/events/ics";
import type { GoogleEventBody } from "@/lib/google/client";

/**
 * Cómo se ve en Google Calendar un evento o una sala programada de INTERCEDE (CLAUDE.md §16.3 C6 nivel 2). Funciones puras. Cada evento
 * lleva el enlace a INTERCEDE, un recordatorio de 10 minutos y una propiedad privada con su identificador, que hace idempotente la
 * sincronización (se puede reintentar sin duplicar).
 */
export const REMINDER_MINUTES = 10;

export type SourceType = "event" | "schedule" | "chain_slot";

/** Identificador de INTERCEDE guardado en las propiedades privadas del evento de Google. */
export const sourceKey = (type: SourceType, id: string) => `${type}:${id}`;

export interface EventSource {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  community_id: string;
}

export function eventPayload(event: EventSource, siteUrl: string): GoogleEventBody {
  const url = `${siteUrl}/es/comunidades/${event.community_id}/eventos`;
  return {
    summary: event.title,
    description: [event.description?.trim(), url].filter(Boolean).join("\n\n"),
    start: { dateTime: new Date(event.starts_at).toISOString(), timeZone: event.timezone },
    end: { dateTime: new Date(event.ends_at).toISOString(), timeZone: event.timezone },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: REMINDER_MINUTES }] },
    extendedProperties: { private: { intercede: sourceKey("event", event.id) } },
    source: { title: "INTERCEDE", url },
  };
}

export interface ScheduleSource {
  id: string;
  name: string;
  timezone: string;
  recurrence: "once" | "daily" | "weekly";
  weekdays: number[];
  next_occurrence_at: string;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** AAAAMMDDTHHMMSS → AAAA-MM-DDTHH:MM:SS (hora de pared que entiende Google junto con la zona horaria). */
const localIso = (compact: string) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}`;

export function schedulePayload(schedule: ScheduleSource, siteUrl: string): GoogleEventBody {
  const start = new Date(schedule.next_occurrence_at);
  const end = new Date(start.getTime() + 60 * 60_000);
  const url = `${siteUrl}/es/programadas`;
  // Hora de pared + zona: una recurrencia respeta el horario de verano (la hora local no se mueve)
  const recurrence =
    schedule.recurrence === "daily"
      ? ["RRULE:FREQ=DAILY"]
      : schedule.recurrence === "weekly"
        ? [`RRULE:FREQ=WEEKLY;BYDAY=${[...new Set(schedule.weekdays)].sort().map((day) => DAYS[day]).filter(Boolean).join(",")}`]
        : undefined;
  return {
    summary: schedule.name,
    description: `Sala de oración programada en INTERCEDE.\n\n${url}`,
    start: { dateTime: localIso(wallClock(start, schedule.timezone)), timeZone: schedule.timezone },
    end: { dateTime: localIso(wallClock(end, schedule.timezone)), timeZone: schedule.timezone },
    ...(recurrence ? { recurrence } : {}),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: REMINDER_MINUTES }] },
    extendedProperties: { private: { intercede: sourceKey("schedule", schedule.id) } },
    source: { title: "INTERCEDE", url },
  };
}
