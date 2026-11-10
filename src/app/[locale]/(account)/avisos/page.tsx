import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { NotificationsScreen } from "@/components/notifications/notifications-screen";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/avisos">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/avisos", title: t("notificationsTitle"), description: t("description"), noindex: true });
}

export default async function NotificationsPage({ params }: PageProps<"/[locale]/avisos">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/avisos");
  if (session.isAnonymous) return <GuestInvite kind="notifications" />;

  const supabase = await createClient();
  const [{ data: prefs }, { data: recent }] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("push_enabled, email_enabled, schedule_reminders, devotional_reminder, devotional_reminder_time")
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.from("notifications").select("id, kind, title, body, url, created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  return <NotificationsScreen initialPrefs={prefs} recent={recent ?? []} hasEmail={Boolean(session.email)} />;
}
