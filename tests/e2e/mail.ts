/**
 * Buzón de pruebas del Supabase local (Mailpit, puerto 54324): aquí caen los correos de
 * confirmación y de recuperación. Solo existe en local/CI; nunca se envía nada real.
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export interface TestEmail {
  subject: string;
  html: string;
}

/** Espera el correo más reciente para `to` (con el asunto indicado, si se pide). */
export async function waitForEmail(to: string, options: { subject?: string; timeoutMs?: number } = {}): Promise<TestEmail> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`).then((r) => r.json() as Promise<{ messages?: { ID: string; Subject: string }[] }>);
    const match = search.messages?.find((m) => !options.subject || m.Subject.includes(options.subject));
    if (match) {
      const message = (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`).then((r) => r.json())) as { Subject: string; HTML: string };
      return { subject: message.Subject, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No llegó ningún correo para ${to}`);
}

/** El primer enlace del correo que pasa por /auth/confirm (con el HTML ya des-escapado). */
export function confirmLink(email: TestEmail): string {
  const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? "").replaceAll("&amp;", "&"));
  const link = hrefs.find((href) => href.includes("/auth/confirm"));
  if (!link) throw new Error(`El correo "${email.subject}" no trae un enlace a /auth/confirm`);
  return link;
}
