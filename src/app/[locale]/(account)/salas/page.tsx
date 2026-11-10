import { CalendarClock, History as HistoryIcon } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/salas">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/salas", title: t("historyTitle"), description: t("description"), noindex: true });
}

export default async function HistoryPage({ params }: PageProps<"/[locale]/salas">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/salas");
  if (session.isAnonymous) return <GuestInvite kind="history" />;

  const t = await getTranslations("History");
  const format = await getFormatter();
  const supabase = await createClient();

  // RLS: solo las salas en las que la persona participó
  const { data: rows } = await supabase
    .from("room_members")
    .select("joined_at, role, rooms(id, code, name, status)")
    .eq("user_id", session.userId)
    .order("joined_at", { ascending: false })
    .limit(50);

  return (
    <>
      <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>

      <Link
        href="/programadas"
        className="mt-6 flex items-center gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border transition-colors hover:ring-ring"
      >
        <CalendarClock className="size-6 shrink-0 text-primary-text" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-heading font-bold">{t("schedulesLink")}</span>
          <span className="block text-sm text-muted-foreground">{t("schedulesLinkHelp")}</span>
        </span>
      </Link>

      {!rows || rows.length === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-4 rounded-3xl border border-dashed border-border p-8">
          <HistoryIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-muted-foreground">{t("empty")}</p>
          <Link href="/orar" className={buttonVariants({ size: "md" })}>
            {t("pray")}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((row) => {
            const room = row.rooms;
            if (!room) return null;
            const open = room.status === "open";
            return (
              <li key={room.id} className="flex items-center gap-4 rounded-2xl bg-background p-4 shadow-sm ring-1 ring-border">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading font-bold">{room.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{t("joined", { date: format.dateTime(new Date(row.joined_at), { dateStyle: "medium" }) })}</span>
                    {row.role === "host" ? <span className="font-semibold text-answered-foreground">· {t("host")}</span> : null}
                    <span className={open ? "font-semibold text-success" : ""}>· {open ? t("open") : t("closed")}</span>
                  </p>
                </div>
                {open ? (
                  <Link href={`/r/${room.code}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                    {t("rejoin")}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
