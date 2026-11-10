import type { Tables } from "@/types/database";

export type JournalEntry = Tables<"prayer_journal_entries">;
export type JournalFilter = "praying" | "answered" | "all";
