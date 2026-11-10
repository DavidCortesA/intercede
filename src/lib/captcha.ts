/**
 * CAPTCHA (Cloudflare Turnstile) para las altas: anti-bots en la creación de invitados, cuentas y
 * recuperaciones (CLAUDE.md §14.8). Es opcional y está APAGADO por defecto:
 *   - Se enciende al definir NEXT_PUBLIC_TURNSTILE_SITE_KEY (clave pública del sitio).
 *   - El servidor de Supabase Auth verifica el token con la clave secreta, que se configura allí
 *     (Authentication → Attack Protection → CAPTCHA) y NUNCA en esta aplicación.
 * Mientras esté apagado, no se carga ningún script de terceros.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const CAPTCHA_ENABLED = TURNSTILE_SITE_KEY.length > 0;

/** El widget de Turnstile agrega este campo al formulario que lo contiene. */
export const CAPTCHA_FIELD = "cf-turnstile-response";

/** Lee el token del formulario (si no hay, `undefined`: Supabase decide si lo exige). */
export function getCaptchaToken(formData: FormData): string | undefined {
  const value = formData.get(CAPTCHA_FIELD);
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}
