import { z } from "zod";

/** Nombre que ven los demás en la sala (coincide con el CHECK de public.profiles). */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Escribe un nombre")
  .max(40, "Usa 40 caracteres o menos");

export const guestSignInSchema = z.object({ displayName: displayNameSchema });

export type GuestSignInInput = z.input<typeof guestSignInSchema>;
