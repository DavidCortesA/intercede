import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

// PLACEHOLDER de la Fase 0: la landing real se construye en la Fase 1.
// El logo oficial llega en public/brand/ (no se redibuja ni se aproxima).
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const brand = await getTranslations("Brand");

  return (
    <main
      id="contenido"
      className="dark flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground"
    >
      {/* Texto temporal en lugar del logo: reemplazar por /public/brand/logo-white.svg */}
      <p className="font-heading text-3xl font-extrabold tracking-wide">{brand("name")}</p>
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{brand("tagline")}</p>
      <h1 className="max-w-xl font-heading text-4xl font-extrabold sm:text-5xl">{brand("slogan")}</h1>
      <p className="max-w-md text-muted-foreground">{t("placeholder")}</p>
    </main>
  );
}
