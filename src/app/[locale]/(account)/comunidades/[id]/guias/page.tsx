import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuidesManager, type GuideListItem } from "@/components/guides/guides-manager";
import { getEntitlements } from "@/features/billing/entitlements";
import { getCommunityContext } from "@/features/communities/queries";
import { guideSegmentSchema } from "@/features/guides/timer";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/guias">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Guides.manager" });
  return pageMetadata({ locale, path: `/comunidades/${id}/guias`, title: t("metaTitle"), description: t("intro"), noindex: true });
}

/** Guías de oración propias de la comunidad: liderazgo (la base exige además plan Plus o Pro para crearlas). */
export default async function CommunityGuidesPage({ params }: PageProps<"/[locale]/comunidades/[id]/guias">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  if (!ctx.isLeader) notFound();

  const supabase = await createClient();
  const [{ data: rows }, entitlements] = await Promise.all([
    supabase.from("prayer_guides").select("id, title, description, segments").eq("community_id", id).order("created_at", { ascending: false }),
    getEntitlements(supabase, id),
  ]);
  const guides: GuideListItem[] = (rows ?? []).flatMap((row) => {
    const segments = z.array(guideSegmentSchema).safeParse(row.segments);
    return segments.success ? [{ id: row.id, title: row.title, description: row.description, segments: segments.data }] : [];
  });

  return <GuidesManager communityId={id} guides={guides} canCreate={entitlements?.own_guides ?? false} />;
}
