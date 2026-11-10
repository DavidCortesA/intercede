/**
 * Limpieza de lo que sale de la aplicación hacia Sentry y la analítica (CLAUDE.md §3: "sin rastrear contenido
 * de oraciones"). Funciones puras, sin dependencias, con pruebas propias.
 *
 * Qué se considera sensible en una URL:
 *   - /r/<código>   → el código ES la llave de la sala
 *   - /p/<token>    → invitación a una sala programada
 *   - /c/<token>    → invitación a una comunidad
 *   - ?query y #hash → pueden traer códigos, tokens de correo (token_hash) o rutas de regreso
 *   - ids de comunidad y de evento → se generalizan (no hacen falta para depurar)
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Quita lo que identifica salas, invitaciones y comunidades. Acepta URLs completas o rutas. */
export function scrubUrl(url: string): string {
  const noQuery = url.replace(/[?#].*$/, "");
  return noQuery
    .replace(/(\/(?:[a-z]{2}\/)?)r\/[^/\s]+/i, "$1r/[code]")
    .replace(/(\/(?:[a-z]{2}\/)?)p\/[^/\s]+/i, "$1p/[token]")
    .replace(/(\/(?:[a-z]{2}\/)?)c\/[^/\s]+/i, "$1c/[token]")
    .replace(new RegExp(`/comunidades/${UUID}`, "gi"), "/comunidades/[id]")
    .replace(new RegExp(`/events/${UUID}`, "gi"), "/events/[id]");
}

interface BreadcrumbLike {
  category?: string;
  data?: Record<string, unknown>;
}

interface EventLike {
  request?: { url?: string };
  user?: unknown;
  transaction?: string;
  breadcrumbs?: BreadcrumbLike[];
  extra?: unknown;
}

/** Migajas: se descartan las que pueden llevar texto escrito o impreso; las de red y navegación pierden su query. */
export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T | null {
  const category = breadcrumb.category ?? "";
  // Teclas, clics con texto y consola pueden contener lo que la persona escribió (peticiones, notas, contraseñas)
  if (category.startsWith("ui.") || category === "console") return null;

  const data = breadcrumb.data ? { ...breadcrumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = scrubUrl(value);
    }
    // Cuerpos y parámetros de las peticiones (pueden ser peticiones de oración, correos, contraseñas)
    delete data.request_body_size;
    delete data.body;
    delete data.query;
  }
  return { ...breadcrumb, ...(data ? { data } : {}) };
}

/** Evento (error o transacción) sin cuerpo, cookies, encabezados, usuario ni URLs con llaves. */
export function scrubEvent<T extends EventLike>(event: T): T {
  const scrubbed: T & EventLike = { ...event };

  if (scrubbed.request) {
    const { url } = scrubbed.request;
    // Solo se conserva la URL (generalizada): nada de cuerpo, cookies, encabezados ni query
    scrubbed.request = url ? { url: scrubUrl(url) } : {};
  }
  // Nunca se envía quién es la persona (ni correo ni id): no hace falta para depurar
  delete scrubbed.user;
  delete scrubbed.extra;
  if (typeof scrubbed.transaction === "string") scrubbed.transaction = scrubUrl(scrubbed.transaction);
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.flatMap((breadcrumb) => {
      const clean = scrubBreadcrumb(breadcrumb);
      return clean ? [clean] : [];
    });
  }
  return scrubbed;
}

/** Para `@vercel/analytics` (`beforeSend`): solo se registran rutas generalizadas. */
export function scrubAnalyticsEvent<T extends { url: string }>(event: T): T {
  return { ...event, url: scrubUrl(event.url) };
}
