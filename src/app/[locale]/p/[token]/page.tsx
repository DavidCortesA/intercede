import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RoomShell } from "@/components/room/room-shell";
import { FollowButton } from "@/components/schedules/follow-button";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/features/auth/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

// El enlace es la llave de la invitación: nunca se indexa.
export async function generateMetadata({ params }: PageProps<"/[locale]/p/[token]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("inviteTitle"), robots: { index: false, follow: false } };
}

/**
 * Invitación a una sala programada. Cualquiera con el enlace ve de qué se trata (nombre y horario);
 * para recibir avisos hace falta una cuenta. Revocar el enlace (desde el panel de quien lo creó) lo
 * deja sin efecto.
 */
export default async function InvitePage({ params }: PageProps<"/[locale]/p/[token]">) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, schedules] = await Promise.all([getTranslations("Invite"), getTranslations("Schedules")]);

  const supabase = await createClient();
  const { data } = await supabase.rpc("peek_schedule", { p_token: token });
  const schedule = data?.[0];

  if (!schedule?.is_active) {
    return (
      <RoomShell>
        <h1 className="font-heading text-3xl font-extrabold text-balance">{t("notFound.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("notFound.body")}</p>
        <Link href="/orar" className={buttonVariants({ size: "md" }) + " mt-8"}>
          {t("pray")}
        </Link>
      </RoomShell>
    );
  }

  const session = await getCurrentSession();
  const time = schedule.local_time.slice(0, 5);
  const days = schedule.weekdays.map((day) => schedules(`weekdaysShort.${String(day) as "0" | "1" | "2" | "3" | "4" | "5" | "6"}`)).join(", ");
  const recurrence =
    schedule.recurrence === "once"
      ? schedules("card.onceAt", { time })
      : schedule.recurrence === "daily"
        ? schedules("card.dailyAt", { time })
        : schedules("card.weeklyAt", { days, time });
  const nextPath = encodeURIComponent(`/p/${token}`);

  return (
    <RoomShell>
      <p className="text-sm font-semibold tracking-widest text-brand-cyan uppercase">{t("title")}</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold text-balance">{schedule.name}</h1>
      <p className="mt-3 text-lg">{recurrence}</p>
      <p className="text-sm text-muted-foreground">{schedules("card.zone", { zone: schedule.timezone })}</p>

      <div className="mt-8">
        {session && !session.isAnonymous ? (
          <FollowButton token={token} />
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-muted-foreground">{t("needAccount")}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/registro?next=${nextPath}`} className={buttonVariants({ size: "md" })}>
                {t("createAccount")}
              </Link>
              <Link href={`/entrar?next=${nextPath}`} className={buttonVariants({ size: "md", variant: "secondary" })}>
                {t("signIn")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </RoomShell>
  );
}
