/**
 * URL pública del sitio. Se define con NEXT_PUBLIC_SITE_URL; en desarrollo cae a localhost.
 * No inventar dominios: si la variable no existe se usa el origen local.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * "Continuar con Google" solo se muestra si el proveedor ya está configurado en Supabase
 * (Authentication → Providers → Google). No se ofrece un botón que no puede funcionar.
 */
export const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
