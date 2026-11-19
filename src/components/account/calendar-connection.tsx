"use client";

import { CalendarSync } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CalendarResult } from "@/features/calendar/results";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export interface CalendarState {
  status: "connected" | "disconnected";
  syncEvents: boolean;
  syncSchedules: boolean;
}

/**
 * Conectar Google Calendar (CLAUDE.md §16 C6 nivel 2). Un permiso APARTE del inicio de sesión y el más acotado: INTERCEDE crea un
 * calendario "INTERCEDE" y solo escribe ahí; no lee tu calendario principal ni ningún otro. Sincroniza en un solo sentido (INTERCEDE → Google).
 */
export function CalendarConnection({ state, result }: { state: CalendarState | null; result: CalendarResult | null }) {
  const t = useTranslations("CalendarSync");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  const connected = state?.status === "connected";

  async function savePrefs(next: { events: boolean; schedules: boolean }) {
    setBusy(true);
    setError(false);
    const { error: failure } = await createClient().rpc("set_calendar_preferences", { p_sync_events: next.events, p_sync_schedules: next.schedules });
    setBusy(false);
    if (failure) return setError(true);
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(false);
    const response = await fetch("/api/calendar/google/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!response?.ok) return setError(true);
    router.refresh();
  }

  return (
    <section aria-labelledby="calendar-title" className="flex flex-col gap-4 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border">
      <div>
        <h2 id="calendar-title" className="flex items-center gap-2 font-heading text-lg font-extrabold">
          <CalendarSync className="size-5 text-primary-text" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {result ? (
        <p role={result === "ok" ? "status" : "alert"} className={result === "ok" ? "text-sm font-semibold text-success" : "rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive"} data-testid="calendar-result">
          {t(`results.${result}`)}
        </p>
      ) : null}

      {state?.status === "disconnected" ? (
        <p role="status" className="rounded-xl bg-surface px-4 py-3 text-sm">
          {t("disconnected")}
        </p>
      ) : null}

      {connected ? (
        <>
          <p className="text-sm font-semibold" data-testid="calendar-status">
            {t("connected")}
          </p>
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="text-sm font-semibold">{t("whatSyncs")}</legend>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={state.syncEvents} onChange={(e) => void savePrefs({ events: e.target.checked, schedules: state.syncSchedules })} className="size-5 accent-[var(--color-brand-violet)]" />
              {t("events")}
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={state.syncSchedules} onChange={(e) => void savePrefs({ events: state.syncEvents, schedules: e.target.checked })} className="size-5 accent-[var(--color-brand-violet)]" />
              {t("schedules")}
            </label>
          </fieldset>
          <p className="text-xs text-muted-foreground">{t("deletedNote")}</p>
          {confirming ? (
            <div role="group" aria-label={t("disconnectConfirm")} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{t("disconnectConfirm")}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void disconnect()}>
                {t("disconnectYes")}
              </Button>
              <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </Button>
            </div>
          ) : (
            <Button size="md" variant="secondary" className="self-start text-foreground" onClick={() => setConfirming(true)}>
              {t("disconnect")}
            </Button>
          )}
        </>
      ) : (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>{t("point1")}</li>
            <li>{t("point2")}</li>
            <li>{t("point3")}</li>
          </ul>
          {/* Es una navegación a Google (flujo de autorización, ruta de API que redirige): un enlace normal, no <Link> */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/calendar/google/connect" className={buttonVariants({ size: "md" }) + " self-start"}>
            {state?.status === "disconnected" ? t("reconnect") : t("connect")}
          </a>
        </>
      )}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("error")}
        </p>
      ) : null}
    </section>
  );
}
