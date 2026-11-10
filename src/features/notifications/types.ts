import type { Tables } from "@/types/database";

export type NotificationPrefs = Pick<
  Tables<"notification_preferences">,
  "push_enabled" | "email_enabled" | "schedule_reminders" | "devotional_reminder" | "devotional_reminder_time"
>;

export type NotificationItem = Pick<Tables<"notifications">, "id" | "kind" | "title" | "body" | "url" | "created_at">;
