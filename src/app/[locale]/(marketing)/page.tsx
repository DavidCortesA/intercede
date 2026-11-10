import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Churches } from "@/components/marketing/churches";
import { Faq } from "@/components/marketing/faq";
import { Features } from "@/components/marketing/features";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { JsonLd } from "@/components/marketing/json-ld";
import { Problem } from "@/components/marketing/problem";
import { Trust } from "@/components/marketing/trust";
import { FAQ_KEYS } from "@/config/faq";
import { SITE_URL } from "@/config/site";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "", title: t("title"), description: t("description") });
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const meta = await getTranslations("Metadata");
  const faq = await getTranslations("Faq");
  const url = `${SITE_URL}/${locale}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: "INTERCEDE",
        url: SITE_URL,
        logo: `${SITE_URL}/icons/icon-512.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#site`,
        url,
        name: "INTERCEDE",
        inLanguage: locale,
        publisher: { "@id": `${SITE_URL}/#org` },
      },
      {
        "@type": "SoftwareApplication",
        name: "INTERCEDE",
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Web",
        description: meta("description"),
        url,
        inLanguage: locale,
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_KEYS.map((key) => ({
          "@type": "Question",
          name: faq(`items.${key}.q`),
          acceptedAnswer: { "@type": "Answer", text: faq(`items.${key}.a`) },
        })),
      },
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <Churches />
      <Trust />
      <Faq />
      <FinalCta />
    </>
  );
}
