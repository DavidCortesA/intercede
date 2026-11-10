/** Errores de cuenta que la interfaz sabe explicar (textos en messages → Auth.errors). */
export const AUTH_ERROR_CODES = [
  "invalid_email",
  "weak_password",
  "password_mismatch",
  "invalid_credentials",
  "email_not_confirmed",
  "email_in_use",
  "already_signed_in",
  "rate_limited",
  "same_password",
  "link_expired",
  "not_authenticated",
  "invalid_name",
  "invalid_timezone",
  "generic",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/** Traduce los códigos de GoTrue (Supabase Auth) a los de la app. */
export function toAuthError(error: AuthErrorLike | null | undefined): AuthErrorCode {
  switch (error?.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "weak_password":
      return "weak_password";
    case "same_password":
      return "same_password";
    case "email_exists":
    case "user_already_exists":
    case "identity_already_exists":
      return "email_in_use";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate_limited";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
      return "link_expired";
    case "validation_failed":
      return "invalid_email";
    default:
      return error?.status === 429 ? "rate_limited" : "generic";
  }
}

/**
 * Solo se redirige a rutas internas conocidas (evita "open redirect" con ?next=https://malo.com).
 * Devuelve `fallback` si `next` no es una ruta interna segura.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  // Una sola barra inicial y solo letras, números, guion y barras: sin esquemas, dominios ni "//"
  if (!next || !/^\/(?!\/)[a-z0-9\-_/]*$/.test(next)) return fallback;
  return next;
}
