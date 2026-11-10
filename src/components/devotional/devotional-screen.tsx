"use client";

import { BookOpen, CheckCircle2, Flame } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { DevotionalProgress, DevotionalStats, TodayDevotional } from "@/features/devotionals/types";
import { createClient } from "@/lib/supabase/client";

const NOTE_MAX = 2000;

/**
 * Devocional del día. Lee en el servidor y escribe con el cliente del navegador: lo que protege el
 * progreso y las notas es RLS (solo la propia cuenta), no esta pantalla.
 */
export function DevotionalScreen({
  devotional,
  initialProgress,
  initialStats,
  embedded = false,
}: {
  devotional: TodayDevotional;
  initialProgress: DevotionalProgress | null;
  initialStats: DevotionalStats;
  /** Dentro de una comunidad: título como h2 y sin racha (la racha es del devocional general). */
  embedded?: boolean;
}) {
  const t = useTranslations("Devotional");
  const [supabase] = useState(() => createClient());
  const [progress, setProgress] = useState(initialProgress);
  const [stats, setStats] = useState(initialStats);
  const [note, setNote] = useState(initialProgress?.note ?? "");
  const [busy, setBusy] = useState<"read" | "note" | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState(false);

  const isRead = Boolean(progress?.read_at);

  async function refreshStats() {
    const { data } = await supabase.rpc("devotional_stats");
    const row = data?.[0];
    if (row) setStats(row);
  }

  async function save(patch: { read_at?: string; note?: string }, kind: "read" | "note") {
    setBusy(kind);
    setError(false);
    setNoteSaved(false);
    // La fila puede no existir aún (primera nota o primera lectura): primero se intenta actualizar y,
    // si no había nada, se crea. (No se usa upsert: solo se permite actualizar read_at y note.)
    const columns = "devotional_id, read_at, note";
    const updated = await supabase.from("devotional_progress").update(patch).eq("devotional_id", devotional.id).select(columns);
    let data = updated.data?.[0] ?? null;
    let failure = updated.error;
    if (!failure && !data) {
      const created = await supabase.from("devotional_progress").insert({ devotional_id: devotional.id, ...patch }).select(columns).single();
      data = created.data;
      failure = created.error;
    }
    setBusy(null);
    if (failure || !data) return setError(true);
    setProgress(data);
    if (kind === "note") setNoteSaved(true);
    await refreshStats();
  }

  const trimmedNote = note.trim();

  return (
    <article className="flex flex-col gap-6">
      {embedded ? null : (
        <header>
          <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-semibold text-answered-foreground">
              <Flame className="size-4" aria-hidden="true" />
              {t("streak", { count: stats.streak })}
            </span>
            {stats.total_read > 0 ? <span>{t("total", { count: stats.total_read })}</span> : null}
          </p>
        </header>
      )}

      <section aria-labelledby="devotional-passage" className="rounded-3xl bg-brand-dusk p-6 text-white shadow-sm">
        <h2 id="devotional-passage" className="flex items-center gap-2 font-heading text-lg font-extrabold">
          <BookOpen className="size-5 text-brand-cyan" aria-hidden="true" />
          {devotional.passage_reference}
        </h2>
        <blockquote className="mt-3 text-lg leading-relaxed whitespace-pre-line">{devotional.passage_text}</blockquote>
        <p className="mt-3 text-xs tracking-wide text-white/75 uppercase">{t("version", { version: devotional.bible_version })}</p>
      </section>

      <section aria-labelledby="devotional-reflection" className="flex flex-col gap-3">
        <h2 id="devotional-reflection" className="font-heading text-lg font-extrabold">
          {t("reflection")}
        </h2>
        <p className="leading-relaxed whitespace-pre-line">{devotional.reflection}</p>
      </section>

      <section aria-labelledby="devotional-question" className="rounded-2xl bg-background p-5 ring-1 ring-border">
        <h2 id="devotional-question" className="font-heading text-base font-extrabold">
          {t("question")}
        </h2>
        <p className="mt-2 leading-relaxed">{devotional.question}</p>
      </section>

      {devotional.suggested_prayer ? (
        <section aria-labelledby="devotional-prayer" className="flex flex-col gap-3">
          <h2 id="devotional-prayer" className="font-heading text-lg font-extrabold">
            {t("prayer")}
          </h2>
          <p className="leading-relaxed whitespace-pre-line text-muted-foreground italic">{devotional.suggested_prayer}</p>
        </section>
      ) : null}

      {isRead ? (
        <p className="inline-flex items-center gap-2 font-heading font-bold text-success" role="status">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          {t("read")}
        </p>
      ) : (
        <Button
          size="lg"
          onClick={() => save({ read_at: new Date().toISOString() }, "read")}
          disabled={busy !== null}
          aria-busy={busy === "read"}
        >
          {busy === "read" ? t("marking") : t("markRead")}
        </Button>
      )}

      <section aria-labelledby="devotional-note" className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border">
        <h2 id="devotional-note" className="font-heading text-lg font-extrabold">
          {t("note.label")}
        </h2>
        <label htmlFor="devotional-note-text" className="sr-only">
          {t("note.label")}
        </label>
        <Textarea
          id="devotional-note-text"
          rows={4}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setNoteSaved(false);
          }}
          placeholder={t("note.placeholder")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{t("note.private")}</p>
          <Button
            size="md"
            variant="secondary"
            className="ml-auto text-foreground"
            onClick={() => save({ note: trimmedNote }, "note")}
            disabled={busy !== null || trimmedNote.length === 0 || trimmedNote === (progress?.note ?? "")}
            aria-busy={busy === "note"}
          >
            {busy === "note" ? t("note.saving") : t("note.save")}
          </Button>
        </div>
        {noteSaved ? (
          <p role="status" className="text-sm font-semibold text-success">
            {t("note.saved")}
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("errors.generic")}
        </p>
      ) : null}
    </article>
  );
}
