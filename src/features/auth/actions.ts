"use server";

import { createClient } from "@/lib/supabase/server";
import { guestSignInSchema, type GuestSignInInput } from "./schemas";

export type GuestSignInResult =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid_name" | "rate_limited" | "guests_disabled" | "captcha_failed" | "unexpected" };

/**
 * Entra como invitado: sin cuenta, solo con un nombre (principio rector del CLAUDE.md §1).
 * Si ya hay sesión (invitado o cuenta) no crea otro usuario: solo actualiza el nombre,
 * así el historial de la persona no se fragmenta.
 */
export async function signInAsGuest(input: GuestSignInInput, captchaToken?: string): Promise<GuestSignInResult> {
  const parsed = guestSignInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_name" };
  const { displayName } = parsed.data;

  const supabase = await createClient();

  // getUser() valida el token contra Auth (no confiamos en lo que haya en la cookie).
  const { data: current } = await supabase.auth.getUser();
  if (current.user) {
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", current.user.id);
    return error ? { ok: false, error: "unexpected" } : { ok: true, userId: current.user.id };
  }

  // El trigger de la base crea el perfil a partir de options.data.display_name
  const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: displayName }, captchaToken } });

  if (error || !data.user) {
    if (error?.code === "anonymous_provider_disabled") return { ok: false, error: "guests_disabled" };
    if (error?.code === "captcha_failed") return { ok: false, error: "captcha_failed" };
    if (error?.code === "over_request_rate_limit" || error?.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "unexpected" };
  }

  return { ok: true, userId: data.user.id };
}
