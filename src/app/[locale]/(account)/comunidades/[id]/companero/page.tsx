import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PartnerScreen } from "@/components/partners/partner-screen";
import { getCommunityContext } from "@/features/communities/queries";
import { overviewSchema } from "@/features/partners/schemas";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/companero">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Partners" });
  return pageMetadata({ locale, path: `/comunidades/${id}/companero`, title: t("metaTitle"), description: t("intro"), noindex: true });
}

/** Compañero de oración de la comunidad (solo personas adultas): lo lee cada persona COMO ella (la base decide qué ve). */
export default async function PartnerPage({ params }: PageProps<"/[locale]/comunidades/[id]/companero">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await getCommunityContext(id);

  const supabase = await createClient();
  const { data } = await supabase.rpc("partner_overview", { p_community_id: id });
  const parsed = overviewSchema.safeParse(data);
  if (!parsed.success) notFound();

  return <PartnerScreen communityId={id} initial={parsed.data} />;
}
