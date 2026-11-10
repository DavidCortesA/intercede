import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/marketing/wordmark";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Pantallas de cuenta (entrar, crear cuenta, recuperar): tarjeta centrada, clara y sin distracciones. */
export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <div className="light flex min-h-dvh flex-col items-center justify-center gap-8 bg-surface-warm px-5 py-10 text-foreground">
      <Link href="/" className="rounded-lg">
        <Wordmark variant="color" className="h-9" />
      </Link>
      <main id="contenido" className="w-full max-w-md rounded-[2rem] bg-background p-7 shadow-xl ring-1 ring-border sm:p-9">
        {children}
      </main>
    </div>
  );
}
