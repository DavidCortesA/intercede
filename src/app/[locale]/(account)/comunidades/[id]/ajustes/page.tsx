import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SettingsScreen } from "@/components/communities/settings-screen";
import { getCommunityContext } from "@/features/communities/queries";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/ajustes">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/ajustes`, title: t("communityTitle"), description: t("description"), noindex: true });
}

export default async function SettingsPage({ params }: PageProps<"/[locale]/comunidades/[id]/ajustes">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  // Solo la administración (la base lo exige igual; esto evita una pantalla que no podría guardar nada)
  if (!ctx.isAdmin) notFound();

  return <SettingsScreen community={ctx.community} />;
}
