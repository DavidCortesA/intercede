"use client";

import { Maximize2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { QrCode } from "@/components/shared/qr-code";
import { Wordmark } from "@/components/marketing/wordmark";
import { useWakeLock } from "@/features/audio/use-wake-lock";
import { clockOffset, formatCountdown, guideRunSchema, guideState } from "@/features/guides/timer";

const stateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("closed"), name: z.string(), server_now: z.string() }),
  z.object({
    status: z.literal("open"),
    name: z.string(),
    code: z.string(),
    focus: z.string().nullable(),
    next: z.array(z.string()),
    guide: guideRunSchema.omit({ title: true }).extend({ title: z.string() }).nullable(),
    server_now: z.string(),
  }),
]);
type DisplayState = z.infer<typeof stateSchema>;

const POLL_MS = 2500;

/**
 * Pantalla de proyección (CLAUDE.md §16 B4): solo lectura, sin audio y sin sesión. Pregunta al servidor cada pocos
 * segundos y muestra en grande la petición en foco, las que siguen, la guía con su cuenta regresiva y el QR para entrar.
 * Alto contraste, tipografía grande y pantalla siempre encendida.
 */
export function DisplayScreen({ code, token }: { code: string; token: string }) {
  const t = useTranslations("Display");
  const locale = useLocale();
  // Última respuesta del servidor y la diferencia entre su reloj y el de este equipo (para la cuenta regresiva)
  const [snapshot, setSnapshot] = useState<{ state: DisplayState; offset: number } | null>(null);
  const [problem, setProblem] = useState<"invalid" | "network" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  // El origen del navegador sin romper la hidratación (en el servidor es "" y el cliente lo completa)
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const joinUrl = origin ? `${origin}/${locale}/r/${code}` : "";
  const state = snapshot?.state ?? null;

  useWakeLock(true);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const start = Date.now();
      try {
        const response = await fetch(`/api/display?code=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}`, { cache: "no-store" });
        const end = Date.now();
        if (cancelled) return;
        if (response.status === 404) return setProblem("invalid");
        if (!response.ok) return setProblem("network");
        const parsed = stateSchema.safeParse(await response.json());
        if (!parsed.success) return setProblem("network");
        setSnapshot({ state: parsed.data, offset: clockOffset(new Date(parsed.data.server_now).getTime(), start, end) });
        setProblem(null);
      } catch {
        if (!cancelled) setProblem("network");
      }
    }
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [code, token]);

  // La cuenta regresiva se redibuja 4 veces por segundo
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  async function fullscreen() {
    try {
      await rootRef.current?.requestFullscreen();
    } catch {
      // Sin pantalla completa disponible: se sigue viendo bien en la ventana
    }
  }

  if (problem === "invalid") {
    return (
      <main id="contenido" className="dark flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-navy-950 px-8 text-center text-foreground">
        <Wordmark className="h-9" />
        <h1 className="font-heading text-3xl font-extrabold">{t("invalidTitle")}</h1>
        <p className="max-w-md text-lg text-brand-cream/85">{t("invalidBody")}</p>
      </main>
    );
  }

  if (state?.status === "closed") {
    return (
      <main id="contenido" className="dark flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-navy-950 px-8 text-center text-foreground">
        <Wordmark className="h-9" />
        <h1 className="font-heading text-[clamp(2rem,5vw,4rem)] font-extrabold">{t("closedTitle", { name: state.name })}</h1>
        <p className="text-xl text-brand-cream/85">{t("closedBody")}</p>
      </main>
    );
  }

  const guide = state?.status === "open" && state.guide ? guideState(state.guide, now + (snapshot?.offset ?? 0)) : null;
  const segment = state?.status === "open" && state.guide && guide ? state.guide.segments[guide.index] : null;

  return (
    <div ref={rootRef} className="dark flex min-h-dvh flex-col bg-brand-navy-950 text-foreground">
      <header className="flex items-center justify-between gap-4 px-[clamp(1.25rem,3vw,3rem)] py-4">
        <h1 className="min-w-0 truncate font-heading text-[clamp(1.25rem,2.5vw,2rem)] font-extrabold">{state?.name ?? t("loading")}</h1>
        <div className="flex items-center gap-4">
          {problem === "network" ? (
            <p role="status" className="text-sm text-brand-gold">
              {t("reconnecting")}
            </p>
          ) : null}
          <button type="button" onClick={() => void fullscreen()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-semibold hover:bg-white/10">
            <Maximize2 className="size-4" aria-hidden="true" />
            {t("fullscreen")}
          </button>
        </div>
      </header>

      <main id="contenido" className="grid flex-1 gap-8 px-[clamp(1.25rem,3vw,3rem)] pb-8 lg:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col justify-center gap-8">
          {guide && segment && state?.status === "open" && state.guide ? (
            <section aria-label={state.guide.title} className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-white/5 p-[clamp(1rem,2vw,2rem)]">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-lavender">{state.guide.title}</p>
                <p className="mt-1 font-heading text-[clamp(1.5rem,3.5vw,3rem)] font-extrabold text-balance">
                  {guide.phase === "finished" ? t("guideFinished") : segment.title}
                </p>
                {segment.instruction && guide.phase !== "finished" ? <p className="mt-2 max-w-3xl text-[clamp(1rem,1.6vw,1.5rem)] text-brand-cream/85">{segment.instruction}</p> : null}
              </div>
              {guide.phase !== "finished" ? (
                <p className="font-mono text-[clamp(3rem,8vw,7rem)] leading-none font-bold tabular-nums" aria-label={formatCountdown(guide.remainingMs)}>
                  {formatCountdown(guide.remainingMs)}
                  {guide.phase === "paused" ? <span className="ml-3 text-lg font-sans font-semibold text-brand-gold">{t("paused")}</span> : null}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="focus-title" className="flex flex-col gap-3">
            {state?.status === "open" && state.focus ? (
              <>
                <h2 id="focus-title" className="text-[clamp(1rem,1.8vw,1.5rem)] font-bold uppercase tracking-[0.2em] text-brand-gold">
                  {t("now")}
                </h2>
                <p className="font-heading text-[clamp(2rem,5.5vw,5rem)] leading-[1.1] font-extrabold text-balance whitespace-pre-wrap break-words" data-testid="display-focus">
                  {state.focus}
                </p>
              </>
            ) : (
              <>
                <h2 id="focus-title" className="sr-only">
                  {t("now")}
                </h2>
                <p className="font-heading text-[clamp(1.75rem,4vw,3.5rem)] font-extrabold text-brand-cream/80 text-balance">{t("noFocus")}</p>
              </>
            )}
          </section>

          {state?.status === "open" && state.next.length > 0 ? (
            <section aria-labelledby="next-title" className="flex flex-col gap-2">
              <h2 id="next-title" className="text-sm font-bold uppercase tracking-[0.2em] text-brand-lavender">
                {t("next")}
              </h2>
              <ul className="flex flex-col gap-2">
                {state.next.map((text, index) => (
                  <li key={`${index}-${text.slice(0, 20)}`} className="truncate text-[clamp(1.1rem,2vw,1.75rem)] text-brand-cream/85">
                    {text}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside aria-label={t("joinTitle")} className="flex flex-row items-center gap-5 self-end rounded-3xl bg-white/5 p-5 lg:flex-col lg:items-center">
          {joinUrl ? <QrCode value={joinUrl} label={t("qrLabel")} className="size-[clamp(7rem,14vw,12rem)]" /> : <div className="size-28" aria-hidden="true" />}
          <div className="text-center">
            <p className="text-sm text-brand-cream/80">{t("joinTitle")}</p>
            <p className="font-mono text-[clamp(1.5rem,3vw,2.5rem)] font-bold uppercase tracking-[0.15em]" data-testid="display-code">
              {code}
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
