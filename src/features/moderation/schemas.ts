import { z } from "zod";

export const REPORT_REASONS = ["harassment", "hate", "spam", "inappropriate", "self_harm", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportTarget = "room" | "prayer_request" | "community_request" | "user";

/** Palabra que hay que escribir para confirmar el borrado de la cuenta (se compara tal cual, sin mayúsculas ni espacios de más). */
export const DELETE_CONFIRMATION = "ELIMINAR";

export const deleteAccountSchema = z.object({
  confirm: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal(DELETE_CONFIRMATION)),
  /** Solo se exige a quien entra con correo y contraseña. */
  password: z.string().max(72).optional(),
});

/** Códigos de error de reportes y bloqueos que devuelve la base (ver la migración de moderación). */
export const MODERATION_ERROR_KEYS = [
  "generic",
  "not_authenticated",
  "target_not_found",
  "own_content",
  "no_shared_context",
  "invalid_reason",
  "invalid_details",
  "already_reported",
  "too_many_reports",
  "cannot_block_self",
  "too_many_blocks",
] as const;
export type ModerationErrorKey = (typeof MODERATION_ERROR_KEYS)[number];

export function toModerationError(error: { message?: string } | null | undefined): ModerationErrorKey {
  return (MODERATION_ERROR_KEYS as readonly string[]).includes(error?.message ?? "") ? (error!.message as ModerationErrorKey) : "generic";
}
