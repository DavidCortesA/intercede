import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DevotionalManager } from "@/components/communities/devotional-manager";
import { DevotionalScreen } from "@/components/devotional/devotional-screen";
import { getCommunityContext } from "@/features/communities/queries";
import { todayIn } from "@/features/devotionals/dates";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/devocional">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/devocional`, title: t("communityTitle"), description: t("description"), noindex: true });
}

/** Devocional de hoy de la comunidad (según tu zona horaria) y, para el liderazgo, publicar y retirar. */
export default async function CommunityDevotionalPage({ params }: PageProps<"/[locale]/comunidades/[id]/devocional">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  const t = await getTranslations("Communities.devotional");
  const today = todayIn(ctx.timezone);

  const supabase = await createClient();
  const { data: devotional } = await supabase
    .from("devotionals")
    .select("id, devotional_date, passage_reference, passage_text, bible_version, reflection, question, suggested_prayer")
    .eq("community_id", id)
    .eq("devotional_date", today)
    .maybeSingle();

  const progress = devotional
    ? (await supabase.from("devotional_progress").select("devotional_id, read_at, note").eq("devotional_id", devotional.id).maybeSingle()).data
    : null;

  const managed = ctx.isLeader
    ? ((await supabase.from("devotionals").select("id, devotional_date, passage_reference").eq("community_id", id).order("devotional_date", { ascending: false }).limit(30)).data ?? [])
    : [];

  return (
    <div className="flex flex-col gap-8">
      {devotional ? (
        <>
          <h2 className="font-heading text-2xl font-extrabold">{t("title")}</h2>
          <DevotionalScreen devotional={devotional} initialProgress={progress} initialStats={{ streak: 0, total_read: 0, read_today: false }} embedded />
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-3xl border border-dashed border-border p-6">
          <BookOpen className="size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-heading text-xl font-extrabold">{t("empty.title")}</h2>
          <p className="text-muted-foreground">{t("empty.body")}</p>
        </div>
      )}

      {ctx.isLeader ? <DevotionalManager communityId={id} today={today} items={managed} /> : null}
    </div>
  );
}
