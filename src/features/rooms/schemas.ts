import { z } from "zod";

/** Aforo de una sala (coincide con join_room en la base). */
export const ROOM_CAPACITY = 20;
/** Máximo de peticiones por persona y sala (coincide con el trigger de la base). */
export const MAX_REQUESTS_PER_AUTHOR = 20;
export const REQUEST_MAX_LENGTH = 500;

/** Mismo formato que el CHECK de rooms.code: 6 caracteres sin ambiguos (sin i, l, o, 0, 1). */
const ROOM_CODE_PATTERN = /^[a-hj-km-np-z2-9]{6}$/;

export const roomCodeSchema = z.string().trim().toLowerCase().regex(ROOM_CODE_PATTERN);

/**
 * Acepta un código ("abc234") o un enlace completo ("https://…/es/r/abc234") y devuelve el
 * código normalizado, o `null` si no tiene el formato de una sala.
 */
export function extractRoomCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lastSegment = trimmed.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
  const parsed = roomCodeSchema.safeParse(lastSegment);
  return parsed.success ? parsed.data : null;
}

/** Códigos de error de validación; los textos viven en messages (Room.errors). */
export const requestContentSchema = z
  .string()
  .trim()
  .min(1, "request_empty")
  .max(REQUEST_MAX_LENGTH, "request_too_long");

export const testimonySchema = z.string().trim().max(REQUEST_MAX_LENGTH, "request_too_long");
