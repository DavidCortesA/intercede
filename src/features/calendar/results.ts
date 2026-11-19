/** Resultados con los que /api/calendar/google/callback regresa al perfil (`?calendario=…`). Módulo neutro: lo usan servidor y cliente. */
export const CALENDAR_RESULTS = ["ok", "cancelado", "error", "sin_token", "permiso", "no_disponible"] as const;
export type CalendarResult = (typeof CALENDAR_RESULTS)[number];

export const toCalendarResult = (value: string | undefined): CalendarResult | null =>
  (CALENDAR_RESULTS as readonly string[]).includes(value ?? "") ? (value as CalendarResult) : null;
