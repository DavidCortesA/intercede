"use client";

import { CalendarClock, Check, Copy, Link2, Pause, Play, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { toScheduleErrorKey, type ScheduleErrorKey } from "@/features/schedules/schemas";
import type { ScheduleView } from "@/features/schedules/types";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Clave de messages → Schedules.weekdaysShort para un día de la base (0 = domingo). */
const dayKey = (day: number) => String(day) as "0" | "1" | "2" | "3" | "4" | "5" | "6";

/**
 * Salas programadas: crear (una vez, a diario o cada semana, en la zona horaria elegida), compartir el
 * enlace de invitación (revocable) y pausar/eliminar. Escribe con funciones de la base de datos
 * (create_schedule, set_schedule_active…): las reglas viven allí, esta pantalla solo las presenta.
 */
export function SchedulesScreen({
  mine,
  following,
  timezones,
  defaultTimezone,
  today,
}: {
  mine: ScheduleView[];
  following: ScheduleView[];
  timezones: string[];
  defaultTimezone: string;
  today: string;
}) {
  const t = useTranslations("Schedules");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ScheduleForm timezones={timezones} defaultTimezone={defaultTimezone} today={today} />

      <section aria-labelledby="mine-title" className="flex flex-col gap-3">
        <h2 id="mine-title" className="font-heading text-lg font-extrabold">
          {t("mine.title")}
        </h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mine.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((schedule) => (
              <li key={schedule.id}>
                <ScheduleCard schedule={schedule} isOwner />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="following-title" className="flex flex-col gap-3">
        <h2 id="following-title" className="font-heading text-lg font-extrabold">
          {t("following.title")}
        </h2>
        {following.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("following.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {following.map((schedule) => (
              <li key={schedule.id}>
                <ScheduleCard schedule={schedule} isOwner={false} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Tarjeta de una programación. `isOwner` = puede administrarla (pausar, eliminar). Con `community`, es una
 * programación de una comunidad: no hay enlace de invitación y cualquier miembro puede seguirla o dejarla.
 */
export function ScheduleCard({ schedule, isOwner, community }: { schedule: ScheduleView; isOwner: boolean; community?: { following: boolean } }) {
  const t = useTranslations("Schedules");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [token, setToken] = useState(schedule.inviteToken);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<"copied" | "revoked" | null>(null);
  const [error, setError] = useState<ScheduleErrorKey | null>(null);

  const time = schedule.local_time.slice(0, 5);
  const ended = !schedule.is_active && schedule.next_occurrence_at === null;
  const paused = !schedule.is_active && !ended;

  const recurrenceText =
    schedule.recurrence === "once"
      ? t("card.onceAt", { time })
      : schedule.recurrence === "daily"
        ? t("card.dailyAt", { time })
        : t("card.weeklyAt", { days: schedule.weekdays.map((day) => t(`weekdaysShort.${dayKey(day)}`)).join(", "), time });

  // Origen del navegador sin romper la hidratación (en el servidor es "" y el cliente lo completa)
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const inviteUrl = token && origin ? new URL(`/${locale}/p/${token}`, origin).href : "";

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) {
      setError(toScheduleErrorKey(failure.message));
      return false;
    }
    router.refresh();
    return true;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("copied");
    } catch {
      setError("generic");
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const { data, error: failure } = await supabase.rpc("regenerate_schedule_invite", { p_schedule_id: schedule.id });
    setBusy(false);
    if (failure || !data) return setError("generic");
    setToken(data);
    setNotice("revoked");
  }

  return (
    <article className={cn("flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border", !schedule.is_active && "opacity-80")}>
      <header className="flex items-start gap-3">
        <CalendarClock className="mt-1 size-5 shrink-0 text-primary-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-base font-extrabold">{schedule.name}</h3>
          <p className="text-sm text-muted-foreground">{recurrenceText}</p>
          <p className="text-xs text-muted-foreground">{t("card.zone", { zone: schedule.timezone })}</p>
        </div>
        {paused ? <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{t("card.paused")}</span> : null}
        {ended ? <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{t("card.ended")}</span> : null}
      </header>

      {schedule.is_active && schedule.next_occurrence_at ? (
        <p className="text-sm font-semibold">
          {t("card.next", {
            date: format.dateTime(new Date(schedule.next_occurrence_at), { dateStyle: "full", timeStyle: "short", timeZone: schedule.timezone }),
          })}
        </p>
      ) : null}

      {isOwner || community ? <p className="text-xs text-muted-foreground">{t("card.followers", { count: schedule.followers })}</p> : null}

      {schedule.openRoomCode ? (
        <Link href={`/r/${schedule.openRoomCode}`} className={buttonVariants({ size: "sm", variant: "secondary" }) + " self-start text-foreground"}>
          {t("card.openRoom")}
        </Link>
      ) : null}

      {isOwner && token && !community ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" aria-hidden="true" />
            {t("card.invite")}
          </p>
          <p className="text-xs break-all text-muted-foreground" data-testid="invite-url">
            {inviteUrl}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="text-foreground" onClick={copyLink} disabled={busy}>
              {notice === "copied" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {t("card.copy")}
            </Button>
            <Button size="sm" variant="secondary" className="text-foreground" onClick={revoke} disabled={busy}>
              {t("card.revoke")}
            </Button>
          </div>
          {notice ? (
            <p role="status" className="text-xs font-semibold text-success">
              {t(`card.${notice}`)}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {isOwner ? (
          <>
            {!ended ? (
              <Button
                size="sm"
                variant="secondary"
                className="text-foreground"
                disabled={busy}
                onClick={() => run(() => supabase.rpc("set_schedule_active", { p_schedule_id: schedule.id, p_active: !schedule.is_active }))}
              >
                {schedule.is_active ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                {schedule.is_active ? t("card.pause") : t("card.resume")}
              </Button>
            ) : null}
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("card.confirmRemove")}>
                <span className="text-sm">{t("card.confirmRemove")}</span>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => supabase.from("room_schedules").delete().eq("id", schedule.id))}>
                  {t("card.remove")}
                </Button>
                <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(false)}>
                  {t("card.cancel")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => setConfirming(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t("card.remove")}
              </Button>
            )}
          </>
        ) : null}
        {community && schedule.is_active && !community.following ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => supabase.rpc("follow_community_schedule", { p_schedule_id: schedule.id }))}>
            {t("card.follow")}
          </Button>
        ) : null}
        {(community ? community.following : !isOwner) ? (
          <Button
            size="sm"
            variant="secondary"
            className="text-foreground"
            disabled={busy}
            onClick={() => run(() => supabase.from("schedule_subscriptions").delete().eq("schedule_id", schedule.id))}
          >
            {t("card.leave")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
