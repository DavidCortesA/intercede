"use client";

import { Headphones, Loader2, LogOut, Mic, MicOff, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { LiveAudio } from "@/features/audio/use-live-audio";

/**
 * Entrar y controlar el audio. El micrófono NO se pide al cargar la página: solo cuando la
 * persona elige "Orar con micrófono" (permisos en contexto, CLAUDE.md §6).
 */
export function AudioPanel({ audio }: { audio: LiveAudio }) {
  const t = useTranslations("Audio");
  const { status, mode, micEnabled, error, soundBlocked } = audio;

  return (
    <section aria-labelledby="audio-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="audio-title" className="font-heading text-base font-bold">
          {t("title")}
        </h2>
        {status !== "idle" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {status === "connecting" ? t("join.connecting") : null}
            {status === "reconnecting" ? t("status.reconnecting") : null}
            {status === "connected" ? (mode === "listen" ? t("status.listening") : micEnabled ? t("status.talking") : t("status.muted")) : null}
          </p>
        ) : null}
      </div>

      {status === "idle" ? (
        <>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="md" onClick={() => void audio.join("talk")} className="flex-1">
              <Mic className="size-5" aria-hidden="true" />
              {t("join.talk")}
            </Button>
            <Button size="md" variant="secondary" onClick={() => void audio.join("listen")} className="flex-1">
              <Headphones className="size-5" aria-hidden="true" />
              {t("join.listen")}
            </Button>
          </div>
        </>
      ) : status === "connecting" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("join.connecting")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="md"
            variant={micEnabled ? "primary" : "secondary"}
            onClick={() => void audio.toggleMic()}
            aria-pressed={micEnabled}
            disabled={status === "reconnecting"}
          >
            {micEnabled ? <Mic className="size-5" aria-hidden="true" /> : <MicOff className="size-5" aria-hidden="true" />}
            {micEnabled ? t("controls.mute") : t("controls.unmute")}
          </Button>
          <Button size="md" variant="secondary" onClick={() => void audio.leave()}>
            <LogOut className="size-5" aria-hidden="true" />
            {t("controls.leave")}
          </Button>
        </div>
      )}

      {soundBlocked && status === "connected" ? (
        <Button size="md" variant="secondary" onClick={() => void audio.enableSound()}>
          <Volume2 className="size-5" aria-hidden="true" />
          {t("controls.enableSound")}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </section>
  );
}
