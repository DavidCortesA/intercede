import { z } from "zod";

/** Nombre que ven los demás en la sala (coincide con el CHECK de public.profiles). */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Escribe un nombre")
  .max(40, "Usa 40 caracteres o menos");

export const guestSignInSchema = z.object({ displayName: displayNameSchema });

export type GuestSignInInput = z.input<typeof guestSignInSchema>;

export const emailSchema = z.email().max(254).transform((value) => value.toLowerCase());

/** Mínimo 8 (igual que Supabase) y máximo 72 (límite de bcrypt). */
export const passwordSchema = z.string().min(8).max(72);

/** ¿Es una zona horaria IANA que el navegador/servidor reconoce? */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("es", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().refine(isValidTimeZone);
