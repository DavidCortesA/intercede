"use client";

import { CalendarPlus, DoorOpen, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import { EVENT_DURATIONS, EVENT_REMINDERS, type EventView, type RsvpStatus } from "@/features/events/types";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const RSVP: RsvpStatus[] = ["going", "maybe", "no"];

/**
 * Eventos de la comunidad (vigilias, retiros, ayunos, cultos): confirmar asistencia, añadir al calendario
 * (.ics) y, para el liderazgo, crear y eliminar. Zona horaria, reglas y permisos los decide la base de datos.
 */
export function EventsScreen({
  communityId,
  isLeader,
  upcoming,
  past,
  timezones,
  defaultTimezone,
  today,
}: {
  communityId: string;
  isLeader: boolean;
  upcoming: EventView[];
  past: EventView[];
  timezones: string[];
  defaultTimezone: string;
  today: string;
}) {
  const t = useTranslations("Communities.events");
  const errors = useTranslations("Communities.errors");
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("19:00");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [duration, setDuration] = useState(120);
  const [opensRoom, setOpensRoom] = useState(false);
  const [reminder, setReminder] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !date || !time) return setError("invalid_title");
    setSaving(true);
    setError(null);
    const { error: failure } = await supabase.rpc("create_event", {
      p_community_id: communityId,
      p_title: title.trim(),
      p_description: description.trim(),
      p_date: date,
      p_time: time,
      p_timezone: timezone,
      p_duration_minutes: duration,
      p_opens_room: opensRoom,
      p_reminder_minutes: reminder,
    });
    setSaving(false);
    if (failure) return setError(toCommunityError(failure));
    setTitle("");
    setDescription("");
    setOpensRoom(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
        <h2 id="upcoming-title" className="font-heading text-2xl font-extrabold">
          {t("upcomingTitle")}
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border p-6 text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((item) => (
              <li key={item.id}>
                <EventCard event={item} isLeader={isLeader} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLeader ? (
        <form onSubmit={create} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
          <h2 className="font-heading text-lg font-extrabold">{t("new.title")}</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-title" className="text-sm font-semibold">
              {t("new.name")}
            </label>
            <Input id="event-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder={t("new.namePlaceholder")} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-description" className="text-sm font-semibold">
              {t("new.description")}
            </label>
            <Textarea id="event-description" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-date" className="text-sm font-semibold">
                {t("new.date")}
              </label>
              <Input id="event-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-time" className="text-sm font-semibold">
                {t("new.time")}
              </label>
              <Input id="event-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-timezone" className="text-sm font-semibold">
              {t("new.timezone")}
            </label>
            <select id="event-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base">
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-duration" className="text-sm font-semibold">
                {t("new.duration")}
              </label>
              <select id="event-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base">
                {EVENT_DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t("new.durationOption", { minutes })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-reminder" className="text-sm font-semibold">
                {t("new.reminder")}
              </label>
              <select id="event-reminder" value={reminder} onChange={(e) => setReminder(Number(e.target.value))} className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base">
                {EVENT_REMINDERS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t("new.reminderOption", { minutes })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor="event-opens-room" className="flex min-h-11 cursor-pointer items-center gap-3">
            <input id="event-opens-room" type="checkbox" checked={opensRoom} onChange={(e) => setOpensRoom(e.target.checked)} className="size-6 shrink-0 accent-brand-violet" />
            <span className="text-sm font-semibold">{t("new.opensRoom")}</span>
          </label>
          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errors(error)}
            </p>
          ) : null}
          <Button type="submit" size="md" className="self-start" disabled={saving} aria-busy={saving}>
            {saving ? t("new.submitting") : t("new.submit")}
          </Button>
        </form>
      ) : null}

      {past.length > 0 ? (
        <section aria-labelledby="past-title" className="flex flex-col gap-3">
          <h2 id="past-title" className="font-heading text-lg font-extrabold">
            {t("pastTitle")}
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((item) => (
              <li key={item.id}>
                <EventCard event={item} isLeader={isLeader} ended />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EventCard({ event, isLeader, ended = false }: { event: EventView; isLeader: boolean; ended?: boolean }) {
  const t = useTranslations("Communities.events");
  const errors = useTranslations("Communities.errors");
  const format = useFormatter();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [mine, setMine] = useState<RsvpStatus | null>(event.myStatus);
  const [counts, setCounts] = useState({ going: event.going, maybe: event.maybe });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  async function respond(status: RsvpStatus) {
    if (status === mine) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.rpc("set_rsvp", { p_event_id: event.id, p_status: status });
    setBusy(false);
    if (failure) return setError(toCommunityError(failure));
    setCounts((current) => ({
      going: current.going + (status === "going" ? 1 : 0) - (mine === "going" ? 1 : 0),
      maybe: current.maybe + (status === "maybe" ? 1 : 0) - (mine === "maybe" ? 1 : 0),
    }));
    setMine(status);
  }

  async function remove() {
    setBusy(true);
    const { error: failure } = await supabase.from("events").delete().eq("id", event.id);
    setBusy(false);
    if (failure) return setError("generic");
    router.refresh();
  }

  const when = format.dateTime(new Date(event.starts_at), { dateStyle: "full", timeStyle: "short", timeZone: event.timezone });

  return (
    <article className={cn("flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border", ended && "opacity-80")}>
      <header>
        <h3 className="font-heading text-lg font-extrabold">{event.title}</h3>
        <p className="text-sm font-semibold">{t("card.when", { date: when })}</p>
        <p className="text-xs text-muted-foreground">{t("card.zone", { zone: event.timezone })}</p>
      </header>
      {event.description ? <p className="leading-relaxed whitespace-pre-line text-muted-foreground">{event.description}</p> : null}

      {event.roomCode && !ended ? (
        <Link href={`/r/${event.roomCode}`} className={buttonVariants({ size: "sm" }) + " self-start"}>
          <DoorOpen className="size-4" aria-hidden="true" />
          {t("card.room")}
        </Link>
      ) : event.opens_room && !ended ? (
        <p className="text-xs text-muted-foreground">{t("card.roomLater")}</p>
      ) : null}

      {ended ? (
        <p className="text-xs font-semibold text-muted-foreground">{t("card.ended")}</p>
      ) : (
        <div role="group" aria-label={t("rsvp.label")} className="flex flex-wrap items-center gap-2">
          {RSVP.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={mine === status ? "primary" : "secondary"}
              className={mine === status ? undefined : "text-foreground"}
              aria-pressed={mine === status}
              disabled={busy}
              onClick={() => respond(status)}
            >
              {t(`rsvp.${status}`)}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground" data-testid="rsvp-summary">
        {t("rsvp.summary", { going: counts.going, maybe: counts.maybe })}
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors(error)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* Descarga por la ruta del servidor (requiere sesión): no es una página, por eso un enlace normal */}
        <a href={`/api/events/${event.id}/ics`} download className={buttonVariants({ size: "sm", variant: "secondary" }) + " text-foreground"}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          {t("card.addToCalendar")}
        </a>
        {isLeader ? (
          confirming ? (
            <div role="group" aria-label={t("card.confirmDelete")} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{t("card.confirmDelete")}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
                {t("card.confirmYes")}
              </Button>
              <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t("card.delete")}
            </Button>
          )
        ) : null}
      </div>
    </article>
  );
}
