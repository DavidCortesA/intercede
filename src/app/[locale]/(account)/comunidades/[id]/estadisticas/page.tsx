import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { StatsScreen } from "@/components/stats/stats-screen";
import { buttonVariants } from "@/components/ui/button";
import { getCommunityContext } from "@/features/communities/queries";
import { statsSchema } from "@/features/stats/stats";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/estadisticas">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Stats" });
  return pageMetadata({ locale, path: `/comunidades/${id}/estadisticas`, title: t("metaTitle"), description: t("metaTitle"), noindex: true });
}

/** Estadísticas agregadas de la comunidad: liderazgo (la base lo exige) y plan Plus o Pro. */
export default async function CommunityStatsPage({ params }: PageProps<"/[locale]/comunidades/[id]/estadisticas">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  if (!ctx.isLeader) notFound();

  const t = await getTranslations("Stats");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_stats", { p_community_id: id });

  if (error?.message === "plan_required") {
    return (
      <section className="flex flex-col items-start gap-4 rounded-3xl bg-background p-6 ring-1 ring-border">
        <h2 className="font-heading text-xl font-extrabold">{t("lockedTitle")}</h2>
        <p className="text-muted-foreground">{t("lockedBody")}</p>
        {ctx.isAdmin ? (
          <Link href={`/comunidades/${id}/facturacion`} className={buttonVariants({ size: "md" })}>
            {t("lockedCta")}
          </Link>
        ) : null}
      </section>
    );
  }

  const parsed = statsSchema.safeParse(data);
  if (error || !parsed.success) {
    return (
      <p role="alert" className="rounded-2xl bg-destructive/10 px-5 py-4 text-sm text-destructive">
        {t("error")}
      </p>
    );
  }

  return <StatsScreen stats={parsed.data} communityId={id} />;
}
