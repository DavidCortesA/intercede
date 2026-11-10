import type { Locale } from "next-intl";
import { getCurrentSession, type CurrentSession } from "@/features/auth/queries";
import { redirect } from "@/i18n/navigation";

/**
 * Exige una sesión (invitado o cuenta). Sin sesión lleva a "entrar" y, tras entrar, de vuelta
 * a esta pantalla. La autorización real sigue siendo RLS: esto solo evita pantallas vacías.
 */
export async function requireSession(locale: Locale, nextPath: string): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect({ href: `/entrar?next=${encodeURIComponent(nextPath)}`, locale });
  return session as CurrentSession;
}
