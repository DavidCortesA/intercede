import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppTabs } from "@/components/account/app-tabs";
import { Wordmark } from "@/components/marketing/wordmark";
import { getCurrentSession } from "@/features/auth/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Zona de la cuenta (perfil, diario, salas): clara, con barra de pestañas abajo (móvil primero). */
export default async function AccountLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await getCurrentSession();

  return (
    <div className="light min-h-dvh bg-surface-warm pb-24 text-foreground">
      <header className="mx-auto flex max-w-2xl items-center px-5 pt-5">
        <Link href="/" className="rounded-lg">
          <Wordmark variant="color" className="h-8" />
        </Link>
      </header>
      <main id="contenido" className="mx-auto max-w-2xl px-5 py-6">
        {children}
      </main>
      <AppTabs isGuest={Boolean(session?.isAnonymous)} />
    </div>
  );
}
