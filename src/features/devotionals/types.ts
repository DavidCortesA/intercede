import type { Tables } from "@/types/database";

export type TodayDevotional = Pick<
  Tables<"devotionals">,
  "id" | "devotional_date" | "passage_reference" | "passage_text" | "bible_version" | "reflection" | "question" | "suggested_prayer"
>;

export type DevotionalProgress = Pick<Tables<"devotional_progress">, "devotional_id" | "read_at" | "note">;

export interface DevotionalStats {
  streak: number;
  total_read: number;
  read_today: boolean;
}
