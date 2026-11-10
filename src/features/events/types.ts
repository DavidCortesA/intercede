import type { Tables } from "@/types/database";

export type EventRow = Pick<
  Tables<"events">,
  "id" | "title" | "description" | "starts_at" | "ends_at" | "timezone" | "opens_room" | "room_id" | "reminder_minutes"
>;

export type RsvpStatus = "going" | "maybe" | "no";

export interface EventView extends EventRow {
  going: number;
  maybe: number;
  myStatus: RsvpStatus | null;
  /** Código de la sala si ya se abrió y sigue abierta. */
  roomCode: string | null;
}

export const EVENT_DURATIONS = [30, 60, 90, 120, 180, 240, 480, 720] as const;
export const EVENT_REMINDERS = [0, 15, 30, 60, 120, 1440] as const;
