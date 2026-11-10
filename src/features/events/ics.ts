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
