"use client";

import { Bell, BellOff, BookOpenCheck, Pause, Play, Plus, SkipForward, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createBell, type Bell as BellHandle } from "@/features/guides/bell";
import { formatCountdown, guideSegmentSchema, guideState, type GuideRun } from "@/features/guides/timer";
import { useGuideRun, useServerClock } from "@/features/guides/use-guide";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { z } from "zod";

interface GuideOption {
  id: string;
  title: string;
  description: string | null;
  isSystem: boolean;
  minutes: number;
}

type Action = "pause" | "resume" | "skip" | "add_minute" | "stop";

/** Refresco de la cuenta regresiva (4 veces por segundo; los números solo cambian cada segundo). */
function useTick(intervalMs = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

/**
 * Guía de oración con temporizador (CLAUDE.md §16 B3). Todos ven el momento actual y la cuenta regresiva (con la hora
 * del servidor, no la del dispositivo); solo quien anfitriona inicia, pausa, salta, suma un minuto o termina. Una
 * campana suave opcional suena al cambiar de momento.
 */
export function GuidePanel({ roomId, isHost }: { roomId: string; isHost: boolean }) {
  const t = useTranslations("Guides.room");
  const run = useGuideRun(roomId);
  const serverNow = useServerClock();
  useTick();

  const [options, setOptions] = useState<GuideOption[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bellOn, setBellOn] = useState(false);
  const bell = useRef<BellHandle | null>(null);
  const lastIndex = useRef<{ title: string; index: number } | null>(null);

  const state = run ? guideState(run, serverNow()) : null;

  // La campana suena cuando cambia el momento (no al entrar ni al empezar)
  useEffect(() => {
    if (!run || !state) {
      lastIndex.current = null;
      return;
    }
    const previous = lastIndex.current;
    if (previous && previous.title === run.title && previous.index !== state.index && state.phase !== "paused") bell.current?.ring();
    if (previous?.title !== run.title || previous.index !== state.index) lastIndex.current = { title: run.title, index: state.index };
  }, [run, state]);

  useEffect(
    () => () => {
      bell.current?.close();
    },
    [],
  );

  function toggleBell() {
    if (bellOn) {
      bell.current?.close();
      bell.current = null;
      setBellOn(false);
      return;
    }
    bell.current = createBell();
    if (bell.current) {
      bell.current.ring(); // confirma cómo suena
      setBellOn(true);
    }
  }

  async function openChooser() {
    setChoosing(true);
    if (options) return;
    const { data } = await createClient().from("prayer_guides").select("id, title, description, is_system, segments").order("is_system", { ascending: false }).order("title");
    setOptions(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        isSystem: row.is_system,
        minutes: z.array(guideSegmentSchema).safeParse(row.segments).data?.reduce((sum, segment) => sum + segment.minutes, 0) ?? 0,
      })),
    );
  }

  async function start(guideId: string) {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().rpc("start_guide", { p_room_id: roomId, p_guide_id: guideId });
    setBusy(false);
    if (error) return setFailed(true);
    setChoosing(false);
  }

  async function control(action: Action) {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().rpc("control_guide", { p_room_id: roomId, p_action: action });
    setBusy(false);
    // "No hay guía" ya es el estado que se buscaba al terminar
    if (error && !(action === "stop" && error.message === "no_guide_running")) setFailed(true);
  }

  if (!run || !state) {
    if (!isHost) return null;
    return (
      <section aria-labelledby="guide-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="guide-title" className="flex items-center gap-2 font-heading text-base font-bold">
            <BookOpenCheck className="size-5 text-primary-text" aria-hidden="true" />
            {t("title")}
          </h2>
          {!choosing ? (
            <Button size="sm" variant="secondary" onClick={() => void openChooser()}>
              {t("start")}
            </Button>
          ) : null}
        </div>
        {choosing ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t("choose")}</p>
            {options === null ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
            <ul className="flex flex-col gap-2">
              {(options ?? []).map((option) => (
                <li key={option.id} className="flex items-center justify-between gap-3 rounded-xl bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{option.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.isSystem ? t("system") : t("community")} · {t("totalMinutes", { count: option.minutes })}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => void start(option.id)} disabled={busy}>
                    {t("begin")}
                  </Button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="secondary" onClick={() => setChoosing(false)}>
              {t("cancel")}
            </Button>
          </div>
        ) : null}
        {failed ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("error")}
          </p>
        ) : null}
      </section>
    );
  }

  const segment = run.segments[state.index]!;
  const percent = state.totalMs > 0 ? Math.min(100, Math.round((state.elapsedMs / state.totalMs) * 100)) : 0;

  return (
    <section aria-labelledby="guide-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="guide-title" className="flex items-center gap-2 font-heading text-sm font-bold text-muted-foreground">
            <BookOpenCheck className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{run.title}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state.phase === "finished" ? t("finishedShort") : t("segmentOf", { current: state.index + 1, total: run.segments.length })}
            {state.phase === "paused" ? ` · ${t("paused")}` : ""}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={toggleBell} aria-pressed={bellOn} aria-label={bellOn ? t("bellOn") : t("bellOff")}>
          {bellOn ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
        </Button>
      </header>

      {state.phase === "finished" ? (
        <p className="font-heading text-xl font-extrabold">{t("finished")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-heading text-2xl font-extrabold text-balance">{segment.title}</p>
          {segment.instruction ? <p className="leading-relaxed text-muted-foreground">{segment.instruction}</p> : null}
          {/* El número se lee solo bajo demanda: anunciarlo cada segundo sería insoportable con lector de pantalla */}
          <p className="font-mono text-5xl font-bold tabular-nums" aria-label={t("remaining", { time: formatCountdown(state.remainingMs) })}>
            {formatCountdown(state.remainingMs)}
          </p>
        </div>
      )}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("progress")}
        className="h-2 overflow-hidden rounded-full bg-background"
      >
        <div className="h-full bg-brand-gradient transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>

      <ol className="flex flex-col gap-1 text-sm">
        {run.segments.map((item, index) => (
          <li key={`${item.title}-${index}`} aria-current={index === state.index && state.phase !== "finished" ? "step" : undefined} className={cn("flex justify-between gap-3 rounded-lg px-3 py-1.5", index === state.index && state.phase !== "finished" ? "bg-background font-bold" : "text-muted-foreground")}>
            <span className="truncate">{item.title}</span>
            <span className="shrink-0 tabular-nums">{t("minutes", { count: item.minutes + Math.round((run.extra_ms[index] ?? 0) / 60_000) })}</span>
          </li>
        ))}
      </ol>

      {/* Anuncio educado del cambio de momento para lectores de pantalla */}
      <p className="sr-only" role="status" aria-live="polite">
        {state.phase === "finished" ? t("finished") : t("announce", { title: segment.title })}
      </p>

      {isHost ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("controls")}>
          {state.phase === "paused" ? (
            <Button size="sm" onClick={() => void control("resume")} disabled={busy}>
              <Play className="size-4" aria-hidden="true" />
              {t("resume")}
            </Button>
          ) : state.phase === "running" ? (
            <Button size="sm" variant="secondary" onClick={() => void control("pause")} disabled={busy}>
              <Pause className="size-4" aria-hidden="true" />
              {t("pause")}
            </Button>
          ) : null}
          {state.phase !== "finished" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void control("skip")} disabled={busy}>
                <SkipForward className="size-4" aria-hidden="true" />
                {t("next")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void control("add_minute")} disabled={busy}>
                <Plus className="size-4" aria-hidden="true" />
                {t("addMinute")}
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => void control("stop")} disabled={busy}>
            <Square className="size-4" aria-hidden="true" />
            {t("stop")}
          </Button>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("error")}
        </p>
      ) : null}
    </section>
  );
}

export type { GuideRun };
