import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { JournalScreen } from "@/components/journal/journal-screen";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/diario">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/diario", title: t("journalTitle"), description: t("description"), noindex: true });
}

export default async function JournalPage({ params }: PageProps<"/[locale]/diario">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/diario");
  if (session.isAnonymous) return <GuestInvite kind="journal" />;

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("prayer_journal_entries")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(500);

  return <JournalScreen initialEntries={entries ?? []} />;
}
