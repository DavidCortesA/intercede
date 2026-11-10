import type { Tables } from "@/types/database";

export type ScheduleRow = Pick<
  Tables<"room_schedules">,
  | "id"
  | "owner_id"
  | "name"
  | "timezone"
  | "recurrence"
  | "local_time"
  | "start_date"
  | "weekdays"
  | "reminder_minutes"
  | "is_active"
  | "next_occurrence_at"
  | "last_room_id"
>;

/** Una programación con lo que la pantalla necesita saber de ella. */
export interface ScheduleView extends ScheduleRow {
  /** Solo quien la creó ve el enlace de invitación. */
  inviteToken: string | null;
  followers: number;
  /** Código de la última sala abierta (solo si la persona puede leerla: la anfitriona). */
  openRoomCode: string | null;
}
