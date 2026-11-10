import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RecoverForm } from "@/components/account/recover-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/recuperar">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/recuperar", title: t("recoverTitle"), description: t("description"), noindex: true });
}

export default async function RecoverPage({ params }: PageProps<"/[locale]/recuperar">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Auth");

  return (
    <>
      <h1 className="font-heading text-3xl font-extrabold">{t("recover.title")}</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">{t("recover.subtitle")}</p>
      <div className="mt-6">
        <RecoverForm />
      </div>
      <p className="mt-6 text-center text-sm">
        <Link href="/entrar" className="font-bold text-primary-text underline-offset-4 hover:underline">
          {t("recover.back")}
        </Link>
      </p>
    </>
  );
}
