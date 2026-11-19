import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BrandSettings } from "@/components/brand/brand-settings";
import { SettingsScreen } from "@/components/communities/settings-screen";
import { getEntitlements } from "@/features/billing/entitlements";
import { getCommunityContext } from "@/features/communities/queries";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const [entitlements, { data: brand }] = await Promise.all([
    getEntitlements(supabase, id),
    supabase.from("community_brands").select("display_name, accent").eq("community_id", id).maybeSingle(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <SettingsScreen community={ctx.community} />
      <BrandSettings
        communityId={id}
        communityName={ctx.community.name}
        canBrand={entitlements?.branding ?? false}
        initial={brand ? { displayName: brand.display_name, accent: brand.accent } : null}
      />
    </div>
  );
}
