/**
 * Errores de salas que la interfaz sabe explicar. Los de negocio vienen de la base como
 * mensajes-código estables (ver la migración de salas); el resto se clasifica por tipo.
 */
export const ROOM_ERROR_CODES = [
  "invalid_name",
  "invalid_room_name",
  "room_not_found",
  "room_closed",
  "room_locked",
  "room_full",
  "community_only",
  "too_many_rooms",
  "too_many_requests",
  "not_host",
  "removed",
  "member_not_found",
  "cannot_remove_self",
  "not_authenticated",
  "rate_limited",
  "guests_disabled",
  "captcha_failed",
  "request_empty",
  "request_too_long",
  "permission_denied",
  "network",
  "generic",
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

const KNOWN = new Set<string>(ROOM_ERROR_CODES);

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

export function toRoomError(error: ErrorLike | null | undefined): RoomErrorCode {
  if (!error) return "generic";
  if (error.message && KNOWN.has(error.message)) return error.message as RoomErrorCode;
  if (error.code === "42501") return "permission_denied";
  if (error.status === 429) return "rate_limited";
  if (error.status === 0 || /fetch|network/i.test(error.message ?? "")) return "network";
  return "generic";
}
