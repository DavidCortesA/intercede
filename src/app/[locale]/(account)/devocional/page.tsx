import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { DevotionalScreen } from "@/components/devotional/devotional-screen";
import { buttonVariants } from "@/components/ui/button";
import { todayIn } from "@/features/devotionals/dates";
import type { DevotionalStats } from "@/features/devotionals/types";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/devocional">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/devocional", title: t("devotionalTitle"), description: t("description"), noindex: true });
}

export default async function DevotionalPage({ params }: PageProps<"/[locale]/devocional">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/devocional");
  if (session.isAnonymous) return <GuestInvite kind="devotional" />;

  const supabase = await createClient();
  // "Hoy" se decide con la zona horaria del perfil (no la del servidor)
  const today = todayIn(session.profile?.timezone ?? "UTC");

  const { data: devotional } = await supabase
    .from("devotionals")
    .select("id, devotional_date, passage_reference, passage_text, bible_version, reflection, question, suggested_prayer")
    .is("community_id", null)
    .eq("devotional_date", today)
    .maybeSingle();

  if (!devotional) {
    const t = await getTranslations("Devotional");
    return (
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-dashed border-border p-8">
        <BookOpen className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-heading text-2xl font-extrabold">{t("empty.title")}</h1>
        <p className="text-muted-foreground">{t("empty.body")}</p>
        <Link href="/orar" className={buttonVariants({ size: "md" })}>
          {t("pray")}
        </Link>
      </div>
    );
  }

  const [{ data: progress }, { data: statsRows }] = await Promise.all([
    supabase.from("devotional_progress").select("devotional_id, read_at, note").eq("devotional_id", devotional.id).maybeSingle(),
    supabase.rpc("devotional_stats"),
  ]);
  const stats: DevotionalStats = statsRows?.[0] ?? { streak: 0, total_read: 0, read_today: false };

  return <DevotionalScreen devotional={devotional} initialProgress={progress} initialStats={stats} />;
}
