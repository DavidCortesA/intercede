"use server";

import { hasLocale } from "next-intl";
import { redirect as redirectExternal } from "next/navigation";
import { GOOGLE_AUTH_ENABLED, SITE_URL } from "@/config/site";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { toAuthError, safeNextPath, type AuthErrorCode } from "./errors";
import { displayNameSchema, emailSchema, isValidTimeZone, passwordSchema } from "./schemas";

export interface AuthActionState {
  error?: AuthErrorCode;
  done?: "check_email" | "reset_sent" | "password_updated" | "saved";
  email?: string;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function localeOf(formData: FormData) {
  const locale = text(formData, "locale");
  return hasLocale(routing.locales, locale) ? locale : null;
}

/**
 * Enlace al que vuelve la persona desde el correo. La plantilla añade `&token_hash=…&type=…`
 * (ver supabase/templates) y /auth/confirm lo verifica en el servidor.
 */
function confirmUrl(nextPath: string) {
  return `${SITE_URL}/auth/confirm?next=${encodeURIComponent(nextPath)}`;
}

/**
 * Crear cuenta. Si la persona ya está orando como invitado se CONVIERTE ese mismo usuario
 * (no se crea otro): conserva su id y por lo tanto su historial de salas.
 */
export async function signUpAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = localeOf(formData);
  if (!locale) return { error: "generic" };

  const email = emailSchema.safeParse(text(formData, "email"));
  if (!email.success) return { error: "invalid_email" };
  const password = passwordSchema.safeParse(text(formData, "password"));
  if (!password.success) return { error: "weak_password" };

  const rawName = text(formData, "displayName").trim();
  const name = rawName ? displayNameSchema.safeParse(rawName) : null;
  if (name && !name.success) return { error: "invalid_name" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const redirectTo = confirmUrl(`/${locale}/perfil`);

  if (data.user && !data.user.is_anonymous) return { error: "already_signed_in" };

  if (data.user?.is_anonymous) {
    // Convierte al invitado: Supabase envía un correo de confirmación al nuevo correo
    const { error } = await supabase.auth.updateUser({ email: email.data, password: password.data }, { emailRedirectTo: redirectTo });
    return error ? { error: toAuthError(error) } : { done: "check_email", email: email.data };
  }

  const { error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: { emailRedirectTo: redirectTo, data: name?.success ? { display_name: name.data } : undefined },
  });
  return error ? { error: toAuthError(error) } : { done: "check_email", email: email.data };
}

export async function signInAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = localeOf(formData);
  if (!locale) return { error: "generic" };

  const email = emailSchema.safeParse(text(formData, "email"));
  if (!email.success) return { error: "invalid_email" };
  const password = text(formData, "password");
  if (!password) return { error: "invalid_credentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) return { error: toAuthError(error) };

  redirect({ href: safeNextPath(text(formData, "next"), "/orar"), locale });
  return {};
}

/** Pide el enlace para elegir otra contraseña. La respuesta no revela si el correo tiene cuenta. */
export async function requestPasswordResetAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = localeOf(formData);
  if (!locale) return { error: "generic" };
  const email = emailSchema.safeParse(text(formData, "email"));
  if (!email.success) return { error: "invalid_email" };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: confirmUrl(`/${locale}/restablecer`) });
  if (error && toAuthError(error) === "rate_limited") return { error: "rate_limited" };
  return { done: "reset_sent", email: email.data };
}

/** Cambia la contraseña de la sesión actual (tras el enlace de recuperación o desde el perfil). */
export async function updatePasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = passwordSchema.safeParse(text(formData, "password"));
  if (!password.success) return { error: "weak_password" };
  if (text(formData, "confirm") !== password.data) return { error: "password_mismatch" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return { error: "not_authenticated" };

  const { error } = await supabase.auth.updateUser({ password: password.data });
  return error ? { error: toAuthError(error) } : { done: "password_updated" };
}

export async function signOutAction(formData: FormData) {
  const locale = localeOf(formData) ?? routing.defaultLocale;
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/", locale });
}

/** "Continuar con Google": inicia sesión o, si es invitado, vincula Google a ese mismo usuario. */
export async function googleAction(formData: FormData) {
  const locale = localeOf(formData) ?? routing.defaultLocale;
  if (!GOOGLE_AUTH_ENABLED) return;

  const supabase = await createClient();
  const { data: current } = await supabase.auth.getUser();
  // Vuelve a donde iba (p. ej. una invitación); la ruta se valida igual que en el resto de la autenticación
  const next = safeNextPath(text(formData, "next"), "/perfil");
  const redirectTo = `${SITE_URL}/auth/callback?next=${encodeURIComponent(`/${locale}${next}`)}`;

  const result = current.user?.is_anonymous
    ? await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo } })
    : await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });

  if (result.data.url) redirectExternal(result.data.url);
}

/** Nombre y zona horaria del perfil (RLS: solo el propio). */
export async function updateProfileAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const name = displayNameSchema.safeParse(text(formData, "displayName"));
  if (!name.success) return { error: "invalid_name" };
  const timezone = text(formData, "timezone");
  if (!isValidTimeZone(timezone)) return { error: "invalid_timezone" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "not_authenticated" };

  const { error } = await supabase.from("profiles").update({ display_name: name.data, timezone }).eq("id", data.user.id);
  if (error) return { error: error.code === "22023" ? "invalid_timezone" : "generic" };
  return { done: "saved" };
}
