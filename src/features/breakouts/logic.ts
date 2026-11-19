import { z } from "zod";

/**
 * Grupos pequeños (CLAUDE.md §16 B2): reglas puras del lado del navegador. La base decide quién puede qué; aquí solo se
 * calcula en qué sala de audio le toca estar a cada quien según la hora del servidor, y se prepara el reparto.
 */

export const breakoutSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  status: z.enum(["active", "ended"]),
  minutes: z.number().int(),
  ends_at: z.string(),
  announcement: z.string().nullable(),
  announced_at: z.string().nullable(),
});
export type Breakout = z.infer<typeof breakoutSchema>;

export const groupSchema = z.object({
  id: z.string(),
  breakout_id: z.string(),
  position: z.number().int(),
  name: z.string(),
  request_id: z.string().nullable(),
});
export type BreakoutGroup = z.infer<typeof groupSchema>;

export const assignmentSchema = z.object({ breakout_id: z.string(), group_id: z.string(), user_id: z.string() });
export type BreakoutAssignment = z.infer<typeof assignmentSchema>;

/** Milisegundos que le quedan al reparto (0 si ya pasó). */
export function breakoutRemainingMs(endsAt: string, serverNowMs: number): number {
  return Math.max(0, new Date(endsAt).getTime() - serverNowMs);
}

/**
 * El grupo de audio que le toca a esta persona AHORA, o `null` (sala principal). Vuelve a la sala principal por su cuenta al
 * terminar el tiempo o el reparto, sin esperar a la anfitriona ni a ningún mensaje: por eso nadie queda "atrapado".
 */
export function activeGroupId(breakout: Breakout | null, myGroupId: string | null, serverNowMs: number): string | null {
  if (!breakout || breakout.status !== "active" || !myGroupId) return null;
  return breakoutRemainingMs(breakout.ends_at, serverNowMs) > 0 ? myGroupId : null;
}

/** Cantidad de grupos para repartir a `people` personas en grupos de `size`, entre 2 y `max`. */
export function groupCountForSize(people: number, size: number, max: number): number {
  if (people < 2 || size < 2) return 2;
  return Math.max(2, Math.min(Math.ceil(people / size), max, people));
}

/** Tamaño aproximado de cada grupo al repartir `people` en `groups` (los primeros reciben una persona más). */
export function groupSizes(people: number, groups: number): number[] {
  const base = Math.floor(people / groups);
  const extra = people % groups;
  return Array.from({ length: groups }, (_, index) => base + (index < extra ? 1 : 0));
}

/** Reparto aleatorio y parejo ({usuario: número de grupo}); `random` se inyecta para poder probarlo. */
export function randomAssignments(userIds: string[], groups: number, random: () => number = Math.random): Record<string, number> {
  const shuffled = [...userIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return Object.fromEntries(shuffled.map((userId, index) => [userId, (index % groups) + 1]));
}

/** Personas por grupo a partir de un reparto manual (los grupos sin nadie aparecen con 0). */
export function countByGroup(assignments: Record<string, number>, groups: number): number[] {
  const counts = Array.from({ length: groups }, () => 0);
  for (const group of Object.values(assignments)) if (group >= 1 && group <= groups) counts[group - 1]! += 1;
  return counts;
}

export const BREAKOUT_MINUTES = [5, 10, 15, 20, 30, 45, 60] as const;
export const BREAKOUT_SIZES = [2, 3, 4, 5] as const;
