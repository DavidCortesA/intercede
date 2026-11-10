/**
 * URL pública del sitio. Se define con NEXT_PUBLIC_SITE_URL; en desarrollo cae a localhost.
 * No inventar dominios: si la variable no existe se usa el origen local.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
