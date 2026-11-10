import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/marketing/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/orar">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({
    locale,
    path: "/orar",
    title: t("prayTitle"),
    description: t("prayDescription"),
    noindex: true,
  });
}

// PROVISIONAL (Fase 1): el CTA "Orar ahora" de la landing apunta aquí hasta que existan
// las salas (Fase 3). No simula crear una sala: avisa con honestidad que viene pronto.
export default async function PrayPage({ params }: PageProps<"/[locale]/orar">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Pray");

  return (
    <main
      id="contenido"
      className="dark flex min-h-dvh flex-col items-center justify-center gap-6 bg-brand-dusk px-6 text-center text-foreground"
    >
      <Wordmark className="h-10" />
      <h1 className="max-w-xl font-heading text-4xl font-extrabold text-balance sm:text-5xl">{t("title")}</h1>
      <p className="max-w-md text-lg text-brand-cream/85">{t("body")}</p>
      <Link href="/" className={buttonVariants({ variant: "secondary", size: "md" })}>
        {t("back")}
      </Link>
    </main>
  );
}
