import { z } from "zod";

export const JOURNAL_MAX_LENGTH = 2000;
export const JOURNAL_TESTIMONY_MAX_LENGTH = 1000;

/** Categorías simples (CLAUDE.md §5.2). Los textos viven en messages → Journal.categories. */
export const JOURNAL_CATEGORIES = ["family", "health", "work", "finances", "faith", "other"] as const;
export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

export const journalContentSchema = z.string().trim().min(1, "request_empty").max(JOURNAL_MAX_LENGTH, "request_too_long");
export const journalTestimonySchema = z.string().trim().max(JOURNAL_TESTIMONY_MAX_LENGTH);
