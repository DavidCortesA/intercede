import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LegalDocument } from "@/components/marketing/legal-document";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

const SECTIONS = ["respect", "moderation", "content", "service", "changes"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/terminos">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({
    locale,
    path: "/terminos",
    title: t("termsTitle"),
    description: t("termsDescription"),
  });
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terminos">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Legal.terms");

  return (
    <LegalDocument
      title={t("title")}
      intro={t("intro")}
      sections={SECTIONS.map((id) => ({
        id,
        title: t(`sections.${id}.title`),
        body: t(`sections.${id}.body`),
      }))}
    />
  );
}
