/**
 * Exportar un evento a calendario (.ics, RFC 5545). Funciones puras: sin dependencias, probadas aparte.
 * Las fechas van en UTC (Z): cada calendario las muestra en la zona horaria de quien las abre.
 */

export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
  /** Enlace a la pantalla del evento en INTERCEDE. */
  url?: string;
  /** Momento de creación del archivo (por defecto, ahora). */
  stamp?: Date;
}

/** AAAAMMDDTHHMMSSZ */
export function icsDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapa un valor de texto: barra invertida, punto y coma, coma y saltos de línea (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Dobla las líneas a 75 octetos (UTF-8) como exige el formato: la continuación empieza con un espacio. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // La primera línea admite 75 octetos; las siguientes 74 (el espacio de continuación cuenta)
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//INTERCEDE//Eventos//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@intercede`,
    `DTSTAMP:${icsDate(event.stamp ?? new Date())}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Nombre de archivo seguro (sin acentos ni símbolos) para la descarga. */
export function icsFileName(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "evento"}.ics`;
}

// ───────────────────────── Google Calendar (CLAUDE.md §16 C6, nivel 1) ─────────────────────────

/** Hora de pared (AAAAMMDDTHHMMSS, sin Z) de un instante en una zona horaria. */
export function wallClock(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}T${part("hour")}${part("minute")}${part("second")}`;
}

const GOOGLE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export interface GoogleCalendarInput {
  title: string;
  description?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
  /** Enlace de INTERCEDE (sala o evento): va como ubicación y al final de los detalles. */
  url?: string;
  /** Con zona horaria, la hora se manda como hora de pared (la recurrencia respeta el horario de verano). */
  timezone?: string;
  /** Repetición: diaria o semanal (días 0 = domingo … 6 = sábado). */
  recurrence?: { freq: "daily" } | { freq: "weekly"; weekdays: number[] };
}

/**
 * Enlace que abre el formulario de Google Calendar ya lleno. NO requiere conectar la cuenta ni permisos: es una URL
 * de plantilla pública. Para Apple y Outlook sigue existiendo la descarga .ics.
 */
export function googleCalendarUrl(input: GoogleCalendarInput): string {
  const start = input.timezone ? wallClock(input.startsAt, input.timezone) : icsDate(input.startsAt);
  const end = input.timezone ? wallClock(input.endsAt, input.timezone) : icsDate(input.endsAt);
  const params = new URLSearchParams({ action: "TEMPLATE", text: input.title, dates: `${start}/${end}` });
  const details = [input.description?.trim(), input.url].filter(Boolean).join("\n\n");
  if (details) params.set("details", details);
  if (input.url) params.set("location", input.url);
  if (input.timezone) params.set("ctz", input.timezone);
  if (input.recurrence) {
    const rule =
      input.recurrence.freq === "daily"
        ? "RRULE:FREQ=DAILY"
        : `RRULE:FREQ=WEEKLY;BYDAY=${[...new Set(input.recurrence.weekdays)].sort().map((day) => GOOGLE_DAYS[day]).filter(Boolean).join(",")}`;
    params.set("recur", rule);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
