"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REMINDER_OPTIONS, SCHEDULE_RECURRENCES, scheduleFormSchema, toScheduleErrorKey, type ScheduleErrorKey, type ScheduleRecurrence } from "@/features/schedules/schemas";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Formulario "Nueva sala programada" (una vez, a diario o cada semana, con zona horaria). Se usa para las
 * programaciones personales y, con `communityId`, para las de una comunidad (solo su liderazgo; lo exige la base).
 */
export function ScheduleForm({
  timezones,
  defaultTimezone,
  today,
  communityId,
}: {
  timezones: string[];
  defaultTimezone: string;
  today: string;
  communityId?: string;
}) {
  const t = useTranslations("Schedules");
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [name, setName] = useState("");
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>("daily");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("06:00");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [reminder, setReminder] = useState<number>(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ScheduleErrorKey | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const parsed = scheduleFormSchema.safeParse({ name, recurrence, date, time, weekdays, timezone, reminderMinutes: reminder });
    if (!parsed.success) return setError(toScheduleErrorKey(parsed.error.issues[0]?.message));

    setSaving(true);
    setError(null);
    const form = parsed.data;
    const { error: failure } = await supabase.rpc("create_schedule", {
      p_name: form.name,
      p_recurrence: form.recurrence,
      p_local_time: form.time,
      p_start_date: form.date,
      p_weekdays: form.recurrence === "weekly" ? form.weekdays : [],
      p_timezone: form.timezone,
      p_reminder_minutes: form.reminderMinutes,
      p_community_id: communityId,
    });
    setSaving(false);
    if (failure) return setError(toScheduleErrorKey(failure.message));
    setName("");
    setWeekdays([]);
    router.refresh();
  }

  const toggleDay = (day: number) => setWeekdays((list) => (list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort()));

  return (
      <form onSubmit={create} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("new.title")}</h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-name" className="text-sm font-semibold">
            {t("new.name")}
          </label>
          <Input id="schedule-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("new.namePlaceholder")} required />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">{t("new.recurrence")}</legend>
          <div className="flex flex-wrap gap-2">
            {SCHEDULE_RECURRENCES.map((key) => (
              <label
                key={key}
                className={cn(
                  "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  recurrence === key ? "border-transparent bg-brand-gradient text-white" : "border-border bg-surface hover:border-ring",
                )}
              >
                <input type="radio" name="recurrence" value={key} checked={recurrence === key} onChange={() => setRecurrence(key)} className="sr-only" />
                {t(`new.${key}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {recurrence === "weekly" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("new.days")}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label
                  key={day}
                  className={cn(
                    "inline-flex min-h-11 min-w-12 cursor-pointer items-center justify-center rounded-full border px-3 text-sm font-semibold transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    weekdays.includes(day) ? "border-transparent bg-brand-gradient text-white" : "border-border bg-surface hover:border-ring",
                  )}
                >
                  <input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleDay(day)} className="sr-only" />
                  {t(`weekdaysShort.${day}`)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="schedule-date" className="text-sm font-semibold">
              {recurrence === "once" ? t("new.date") : t("new.startDate")}
            </label>
            <Input id="schedule-date" type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="schedule-time" className="text-sm font-semibold">
              {t("new.time")}
            </label>
            <Input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-timezone" className="text-sm font-semibold">
            {t("new.timezone")}
          </label>
          <select
            id="schedule-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base"
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t("new.timezoneHelp")}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-reminder" className="text-sm font-semibold">
            {t("new.reminder")}
          </label>
          <select
            id="schedule-reminder"
            value={reminder}
            onChange={(event) => setReminder(Number(event.target.value))}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base"
          >
            {REMINDER_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t("new.reminderOption", { minutes })}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        ) : null}

        <Button type="submit" size="md" className="self-start" disabled={saving} aria-busy={saving}>
          {saving ? t("new.submitting") : t("new.submit")}
        </Button>
      </form>
  );
}
