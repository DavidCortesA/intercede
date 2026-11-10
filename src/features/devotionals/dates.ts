/** Fecha de hoy (AAAA-MM-DD) en la zona horaria de la persona: el devocional "de hoy" depende de dónde está. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    // Zona inválida (no debería ocurrir: la base la valida): se usa UTC
    return now.toISOString().slice(0, 10);
  }
}
