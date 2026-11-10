import { z } from "zod";

export const SCHEDULE_RECURRENCES = ["once", "daily", "weekly"] as const;
export type ScheduleRecurrence = (typeof SCHEDULE_RECURRENCES)[number];

/** Minutos de aviso previo que admite la base de datos (CHECK de room_schedules.reminder_minutes). */
export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

/** Códigos de error que devuelven las funciones de programación (ver la migración). */
export const SCHEDULE_ERROR_KEYS = [
  "generic",
  "invalid_name",
  "invalid_timezone",
  "invalid_weekdays",
  "schedule_in_past",
  "too_many_schedules",
  "account_required",
] as const;
export type ScheduleErrorKey = (typeof SCHEDULE_ERROR_KEYS)[number];

export function toScheduleErrorKey(message: string | undefined): ScheduleErrorKey {
  return (SCHEDULE_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as ScheduleErrorKey) : "generic";
}

/** Formulario "Nueva sala programada". Los mensajes son claves de messages → Schedules.errors. */
export const scheduleFormSchema = z
  .object({
    name: z.string().trim().min(1, "invalid_name").max(60, "invalid_name"),
    recurrence: z.enum(SCHEDULE_RECURRENCES),
    date: z.iso.date("schedule_in_past"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "generic"),
    weekdays: z.array(z.number().int().min(0).max(6)),
    timezone: z.string().min(1, "invalid_timezone"),
    reminderMinutes: z.number().refine((minutes) => (REMINDER_OPTIONS as readonly number[]).includes(minutes), "generic"),
  })
  .refine((form) => form.recurrence !== "weekly" || form.weekdays.length > 0, { message: "invalid_weekdays", path: ["weekdays"] });

export type ScheduleForm = z.infer<typeof scheduleFormSchema>;
