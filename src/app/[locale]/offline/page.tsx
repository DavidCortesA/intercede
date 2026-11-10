import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

export default async function OfflinePage({ params }: PageProps<"/[locale]/offline">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Offline");

  return (
    <main
      id="contenido"
      className="dark flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground"
    >
      <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("description")}</p>
    </main>
  );
}
