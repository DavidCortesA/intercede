/**
 * Compartir una sala (CLAUDE.md §16 A1). Funciones puras. El mensaje NUNCA incluye peticiones ni datos personales:
 * solo la invitación y el enlace de la sala.
 */
export const SHARE_MESSAGE_MAX = 300;

/** Mensaje predefinido en español; la persona puede editarlo antes de enviarlo. */
export function defaultShareMessage(url: string): string {
  return `Te invito a orar conmigo en INTERCEDE: ${url}`;
}

/** Enlace de WhatsApp (abre la app o WhatsApp Web) con el texto ya escrito. */
export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message.slice(0, SHARE_MESSAGE_MAX * 3))}`;
}

/** Enlace de la sala sin parámetros de consulta ni ancla (lo que se comparte y se codifica en el QR). */
export function cleanRoomUrl(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.toString();
}
