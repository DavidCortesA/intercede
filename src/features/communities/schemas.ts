import { z } from "zod";

export const COMMUNITY_KINDS = ["church", "ministry", "group"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const COMMUNITY_ROLES = ["admin", "leader", "member"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

/** Códigos de error que devuelve la base (ver la migración de comunidades); el resto cae en "generic". */
export const COMMUNITY_ERROR_KEYS = [
  "generic",
  "invalid_name",
  "invalid_kind",
  "too_many_communities",
  "community_not_found",
  "community_full",
  "not_admin",
  "not_leader",
  "not_member",
  "member_not_found",
  "invalid_role",
  "last_admin",
  "cannot_remove_admin",
  "account_required",
  "too_many_requests",
  "invalid_title",
  "invalid_timezone",
  "invalid_duration",
  "event_in_past",
  "too_many_events",
  "event_ended",
  "invalid_weekdays",
  "schedule_in_past",
  "too_many_schedules",
  "invalid_room_name",
  "too_many_rooms",
  "duplicate_devotional",
] as const;
export type CommunityErrorKey = (typeof COMMUNITY_ERROR_KEYS)[number];

export function toCommunityError(error: { message?: string; code?: string } | null | undefined): CommunityErrorKey {
  if (!error) return "generic";
  if (error.code === "23505") return "duplicate_devotional";
  return (COMMUNITY_ERROR_KEYS as readonly string[]).includes(error.message ?? "") ? (error.message as CommunityErrorKey) : "generic";
}

export const communityFormSchema = z.object({
  name: z.string().trim().min(1, "invalid_name").max(60, "invalid_name"),
  kind: z.enum(COMMUNITY_KINDS, "invalid_kind"),
  description: z.string().trim().max(500, "invalid_name"),
});

/** Acepta el enlace completo (`https://…/es/c/<token>`) o solo el código. Devuelve el token o null. */
export function parseInviteToken(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/\/c\/([A-Za-z0-9_-]{16,})\/?(?:[?#].*)?$/);
  const candidate = fromUrl?.[1] ?? trimmed;
  return /^[A-Za-z0-9_-]{16,64}$/.test(candidate) ? candidate : null;
}
