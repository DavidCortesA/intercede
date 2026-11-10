"use client";

import { CheckCircle2, HandHeart, Pencil, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import {
  JOURNAL_CATEGORIES,
  JOURNAL_MAX_LENGTH,
  JOURNAL_TESTIMONY_MAX_LENGTH,
  journalContentSchema,
  type JournalCategory,
} from "@/features/journal/schemas";
import type { JournalEntry, JournalFilter } from "@/features/journal/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ErrorKey = "generic" | "too_many_entries" | "request_empty" | "request_too_long";

const byNewest = (a: JournalEntry, b: JournalEntry) => b.created_at.localeCompare(a.created_at);

/**
 * Diario de oración (privado). Lee y escribe con el cliente del navegador: la barrera es RLS
 * (solo la propia persona y solo cuentas permanentes), no esta pantalla.
 */
export function JournalScreen({ initialEntries }: { initialEntries: JournalEntry[] }) {
  const t = useTranslations("Journal");
  const [supabase] = useState(() => createClient());
  const [entries, setEntries] = useState(initialEntries);
  const [filter, setFilter] = useState<JournalFilter>("praying");
  const [category, setCategory] = useState<JournalCategory | "all">("all");
  const [error, setError] = useState<ErrorKey | null>(null);

  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState<JournalCategory>("other");
  const [saving, setSaving] = useState(false);

  const visible = useMemo(
    () =>
      entries
        .filter((e) => filter === "all" || (filter === "praying" ? e.status === "praying" : e.status === "answered"))
        .filter((e) => category === "all" || e.category === category)
        .sort(byNewest),
    [entries, filter, category],
  );

  function fail(message: string | undefined) {
    setError(message === "too_many_entries" ? "too_many_entries" : "generic");
  }

  const replace = (row: JournalEntry) => setEntries((list) => list.map((e) => (e.id === row.id ? row : e)));

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const parsed = journalContentSchema.safeParse(draft);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message === "request_too_long" ? "request_too_long" : "request_empty");

    setSaving(true);
    setError(null);
    const { data, error: failure } = await supabase
      .from("prayer_journal_entries")
      .insert({ content: parsed.data, category: draftCategory })
      .select()
      .single();
    setSaving(false);
    if (failure || !data) return fail(failure?.message);
    setEntries((list) => [data, ...list]);
    setDraft("");
    setFilter("praying");
  }

  async function update(id: string, patch: { content?: string; category?: JournalCategory; status?: "praying" | "answered"; testimony?: string | null }) {
    setError(null);
    const { data, error: failure } = await supabase.from("prayer_journal_entries").update(patch).eq("id", id).select().single();
    if (failure || !data) {
      fail(failure?.message);
      return false;
    }
    replace(data);
    return true;
  }

  async function remove(id: string) {
    setError(null);
    const { data, error: failure } = await supabase.from("prayer_journal_entries").delete().eq("id", id).select("id");
    if (failure) return fail(failure.message);
    if (data && data.length > 0) setEntries((list) => list.filter((e) => e.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <form onSubmit={add} className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <label htmlFor="journal-draft" className="sr-only">
          {t("label")}
        </label>
        <Textarea
          id="journal-draft"
          rows={3}
          maxLength={JOURNAL_MAX_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("placeholder")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="journal-category" className="text-sm font-semibold">
            {t("category")}
          </label>
          <select
            id="journal-category"
            value={draftCategory}
            onChange={(event) => setDraftCategory(event.target.value as JournalCategory)}
            className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm"
          >
            {JOURNAL_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {t(`categories.${key}`)}
              </option>
            ))}
          </select>
          <Button type="submit" size="md" className="ml-auto" disabled={saving || draft.trim().length === 0} aria-busy={saving}>
            {saving ? t("adding") : t("add")}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/15 px-4 py-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label={t("title")} className="flex rounded-full bg-background p-1 ring-1 ring-border">
          {(["praying", "answered", "all"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "min-h-10 flex-1 cursor-pointer rounded-full px-3 text-sm font-semibold transition-colors",
                filter === key ? "bg-brand-gradient text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`filters.${key}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("category")}>
          {(["all", ...JOURNAL_CATEGORIES] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
              className={cn(
                "min-h-9 cursor-pointer rounded-full px-3.5 text-xs font-semibold ring-1 ring-border transition-colors",
                category === key ? "bg-brand-violet-100 text-brand-violet-800" : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`categories.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">{t(`empty.${filter}`)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((entry) => (
            <Entry key={entry.id} entry={entry} onUpdate={update} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface EntryProps {
  entry: JournalEntry;
  onUpdate: (id: string, patch: { content?: string; category?: JournalCategory; status?: "praying" | "answered"; testimony?: string | null }) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
}

function Entry({ entry, onUpdate, onRemove }: EntryProps) {
  const t = useTranslations("Journal");
  const format = useFormatter();
  const [mode, setMode] = useState<"view" | "edit" | "testimony" | "delete">("view");
  const [text, setText] = useState(entry.content);
  const [testimony, setTestimony] = useState("");
  const [busy, setBusy] = useState(false);
  const answered = entry.status === "answered";

  async function run(task: () => Promise<boolean | void>) {
    setBusy(true);
    const ok = await task();
    setBusy(false);
    if (ok !== false) setMode("view");
  }

  return (
    <li className={cn("rounded-2xl bg-background p-4 shadow-sm ring-1 ring-border", answered && "border-l-[3px] border-l-answered")}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-brand-violet-100 px-2.5 py-1 font-semibold text-brand-violet-800">{t(`categories.${entry.category as JournalCategory}`)}</span>
        <time dateTime={entry.created_at} suppressHydrationWarning>
          {format.dateTime(new Date(entry.created_at), { dateStyle: "medium" })}
        </time>
        {entry.source_request_id ? <span>· {t("fromRoom")}</span> : null}
        {answered ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-answered-surface px-2.5 py-1 font-bold text-answered-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t("answered")}
          </span>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`edit-${entry.id}`} className="sr-only">
            {t("edit")}
          </label>
          <Textarea id={`edit-${entry.id}`} rows={3} maxLength={JOURNAL_MAX_LENGTH} value={text} onChange={(event) => setText(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || text.trim().length === 0} onClick={() => run(() => onUpdate(entry.id, { content: text.trim() }))}>
              {t("save")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setText(entry.content); setMode("view"); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{entry.content}</p>
      )}

      {answered && entry.testimony ? (
        <p className="mt-3 rounded-xl bg-answered-surface p-3 text-sm leading-relaxed text-answered-foreground">
          <strong>{t("testimonyPrefix")}</strong> {entry.testimony}
        </p>
      ) : null}

      {mode === "testimony" ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`testimony-${entry.id}`} className="text-sm font-semibold">
            {t("testimonyLabel")}
          </label>
          <Textarea
            id={`testimony-${entry.id}`}
            rows={2}
            maxLength={JOURNAL_TESTIMONY_MAX_LENGTH}
            value={testimony}
            onChange={(event) => setTestimony(event.target.value)}
            placeholder={t("testimonyPlaceholder")}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => onUpdate(entry.id, { status: "answered", testimony: testimony.trim() || null }))}>
              {t("save")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("view")}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div role="alertdialog" aria-label={t("confirmDelete")} className="mt-3 flex flex-col gap-2 rounded-xl bg-destructive/10 p-3">
          <p className="text-sm">{t("confirmDelete")}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => onRemove(entry.id))}>
              {t("confirmDeleteYes")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("view")}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "view" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => (answered ? run(() => onUpdate(entry.id, { status: "praying" })) : setMode("testimony"))}
          >
            <HandHeart className="size-4" aria-hidden="true" />
            {answered ? t("unmark") : t("markAnswered")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("edit")}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("edit")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} aria-label={t("delete")} onClick={() => setMode("delete")}>
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("delete")}</span>
          </Button>
        </div>
      ) : null}
    </li>
  );
}
