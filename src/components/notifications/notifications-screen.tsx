"use client";

import { Bell, BellOff, Smartphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  getCurrentSubscription,
  getPushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushSupport,
} from "@/features/notifications/push-client";
import { reminderTimeSchema } from "@/features/notifications/schemas";
import type { NotificationItem, NotificationPrefs } from "@/features/notifications/types";
import { createClient } from "@/lib/supabase/client";

type PushState = "checking" | "off" | "on" | "denied" | PushSupport;
type ErrorKey = "generic" | "too_many_devices" | "account_required";

export const DEFAULT_PREFS: NotificationPrefs = {
  push_enabled: true,
  email_enabled: false,
  schedule_reminders: true,
  devotional_reminder: false,
  devotional_reminder_time: "07:00",
};

/**
 * Avisos: activar este dispositivo, elegir qué avisos recibir y ver los recientes. El permiso del
 * navegador se pide solo al tocar el botón (nunca al cargar la página).
 */
export function NotificationsScreen({
  initialPrefs,
  recent,
  hasEmail,
}: {
  initialPrefs: NotificationPrefs | null;
  recent: NotificationItem[];
  hasEmail: boolean;
}) {
  const t = useTranslations("Notifications");
  const format = useFormatter();
  const [supabase] = useState(() => createClient());

  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs ?? DEFAULT_PREFS);
  const [savedPrefs, setSavedPrefs] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const support = getPushSupport();
      if (support !== "supported") return !cancelled && setPushState(support);
      if (Notification.permission === "denied") return !cancelled && setPushState("denied");
      const subscription = await getCurrentSubscription();
      if (!cancelled) setPushState(subscription && Notification.permission === "granted" ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setError(null);
    if (pushState === "on") {
      const ok = await unsubscribeThisDevice();
      if (ok) setPushState("off");
      else setError("generic");
    } else {
      const result = await subscribeThisDevice();
      if (result === "subscribed") setPushState("on");
      else if (result === "denied") setPushState("denied");
      else setError(result === "too_many_devices" || result === "account_required" ? result : "generic");
    }
    setPushBusy(false);
  }

  async function savePrefs(event: React.FormEvent) {
    event.preventDefault();
    if (!reminderTimeSchema.safeParse(prefs.devotional_reminder_time.slice(0, 5)).success) return setError("generic");
    setSavingPrefs(true);
    setError(null);
    const { error: failure } = await supabase.from("notification_preferences").upsert(
      {
        push_enabled: prefs.push_enabled,
        email_enabled: prefs.email_enabled,
        schedule_reminders: prefs.schedule_reminders,
        devotional_reminder: prefs.devotional_reminder,
        devotional_reminder_time: prefs.devotional_reminder_time.slice(0, 5),
      },
      { onConflict: "user_id" },
    );
    setSavingPrefs(false);
    if (failure) return setError("generic");
    setSavedPrefs(true);
  }

  const setPref = <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }));
    setSavedPrefs(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section aria-labelledby="push-title" className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border">
        <h2 id="push-title" className="flex items-center gap-2 font-heading text-lg font-extrabold">
          <Smartphone className="size-5 text-primary-text" aria-hidden="true" />
          {t("push.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("push.help")}</p>

        {pushState === "needs_install" ? <p className="rounded-xl bg-answered/15 px-4 py-3 text-sm">{t("push.iosInstall")}</p> : null}
        {pushState === "unsupported" ? <p className="text-sm text-muted-foreground">{t("push.unsupported")}</p> : null}
        {pushState === "unavailable" ? <p className="text-sm text-muted-foreground">{t("push.unavailable")}</p> : null}
        {pushState === "denied" ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{t("push.denied")}</p> : null}
        {pushState === "on" ? (
          <p role="status" className="text-sm font-semibold text-success">
            {t("push.enabled")}
          </p>
        ) : null}

        {pushState === "off" || pushState === "on" ? (
          <Button
            size="md"
            variant={pushState === "on" ? "secondary" : "primary"}
            className={pushState === "on" ? "self-start text-foreground" : "self-start"}
            onClick={togglePush}
            disabled={pushBusy}
            aria-busy={pushBusy}
          >
            {pushState === "on" ? <BellOff className="size-5" aria-hidden="true" /> : <Bell className="size-5" aria-hidden="true" />}
            {pushState === "on" ? t("push.disable") : pushBusy ? t("push.enabling") : t("push.enable")}
          </Button>
        ) : null}
      </section>

      <form onSubmit={savePrefs} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("prefs.title")}</h2>

        <Toggle id="pref-push" checked={prefs.push_enabled} onChange={(value) => setPref("push_enabled", value)} label={t("prefs.push")} />
        <Toggle
          id="pref-email"
          checked={prefs.email_enabled}
          onChange={(value) => setPref("email_enabled", value)}
          label={t("prefs.email")}
          disabled={!hasEmail}
        />
        <Toggle
          id="pref-schedules"
          checked={prefs.schedule_reminders}
          onChange={(value) => setPref("schedule_reminders", value)}
          label={t("prefs.schedules")}
        />
        <Toggle
          id="pref-devotional"
          checked={prefs.devotional_reminder}
          onChange={(value) => setPref("devotional_reminder", value)}
          label={t("prefs.devotional")}
        />
        {prefs.devotional_reminder ? (
          <div className="flex items-center gap-3 pl-9">
            <label htmlFor="pref-devotional-time" className="text-sm font-semibold">
              {t("prefs.devotionalTime")}
            </label>
            <Input
              id="pref-devotional-time"
              type="time"
              value={prefs.devotional_reminder_time.slice(0, 5)}
              onChange={(event) => setPref("devotional_reminder_time", event.target.value)}
              className="w-auto"
              required
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" disabled={savingPrefs} aria-busy={savingPrefs}>
            {savingPrefs ? t("prefs.saving") : t("prefs.save")}
          </Button>
          {savedPrefs ? (
            <p role="status" className="text-sm font-semibold text-success">
              {t("prefs.saved")}
            </p>
          ) : null}
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <section aria-labelledby="recent-title" className="flex flex-col gap-3">
        <h2 id="recent-title" className="font-heading text-lg font-extrabold">
          {t("recent.title")}
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recent.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((item) => (
              <li key={item.id}>
                <Link href={item.url} className="block rounded-2xl bg-background p-4 shadow-sm ring-1 ring-border transition-colors hover:ring-ring">
                  <p className="font-heading font-bold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{format.dateTime(new Date(item.created_at), { dateStyle: "medium", timeStyle: "short" })}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Toggle({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input
        id={id}
        type="checkbox"
        checked={checked && !disabled}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="size-6 shrink-0 accent-brand-violet"
      />
      <span className="text-sm font-semibold">{label}</span>
    </label>
  );
}
