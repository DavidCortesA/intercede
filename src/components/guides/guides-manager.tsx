"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export interface GuideListItem {
  id: string;
  title: string;
  description: string | null;
  segments: { title: string; minutes: number; instruction?: string }[];
}

interface Draft {
  key: number;
  title: string;
  minutes: string;
  instruction: string;
}

const ERROR_KEYS = ["generic", "not_leader", "plan_required", "invalid_title", "invalid_segments", "too_many_guides", "guide_not_found"] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];
const toErrorKey = (message: string | undefined): ErrorKey => ((ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as ErrorKey) : "generic");

let nextKey = 1;
const blank = (): Draft => ({ key: nextKey++, title: "", minutes: "5", instruction: "" });

/** Guías propias de la comunidad (CLAUDE.md §16 B3): liderazgo con plan Plus o Pro. La base valida todo de nuevo. */
export function GuidesManager({ communityId, guides, canCreate }: { communityId: string; guides: GuideListItem[]; canCreate: boolean }) {
  const t = useTranslations("Guides.manager");
  const errors = useTranslations("Guides.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [segments, setSegments] = useState<Draft[]>(() => [blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const totalMinutes = segments.reduce((sum, segment) => sum + (Number.parseInt(segment.minutes, 10) || 0), 0);

  function update(key: number, patch: Partial<Draft>) {
    setSegments((list) => list.map((segment) => (segment.key === key ? { ...segment, ...patch } : segment)));
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = segments.map((segment) => ({
      title: segment.title.trim(),
      minutes: Number.parseInt(segment.minutes, 10),
      ...(segment.instruction.trim() ? { instruction: segment.instruction.trim() } : {}),
    }));
    if (payload.some((segment) => !segment.title || !Number.isInteger(segment.minutes) || segment.minutes < 1 || segment.minutes > 60)) return setError("invalid_segments");

    setBusy(true);
    const { error: failure } = await createClient().rpc("create_guide", { p_community_id: communityId, p_title: title, p_description: description, p_segments: payload });
    setBusy(false);
    if (failure) return setError(toErrorKey(failure.message));
    setOpen(false);
    setTitle("");
    setDescription("");
    setSegments([blank(), blank()]);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const { error: failure } = await createClient().rpc("delete_guide", { p_guide_id: id });
    setBusy(false);
    setConfirming(null);
    if (failure) return setError(toErrorKey(failure.message));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">{t("intro")}</p>

      {!canCreate ? (
        <p role="status" className="rounded-2xl bg-surface px-5 py-4 text-sm ring-1 ring-border">
          {t("planRequired")}
        </p>
      ) : !open ? (
        <Button size="md" className="self-start" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("new")}
        </Button>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-4 rounded-3xl bg-background p-5 ring-1 ring-border" aria-label={t("new")}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guide-title" className="text-sm font-semibold">
              {t("titleLabel")}
            </label>
            <Input id="guide-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guide-description" className="text-sm font-semibold">
              {t("descriptionLabel")}
            </label>
            <Input id="guide-description" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold">{t("segments")}</legend>
            <ol className="flex flex-col gap-3">
              {segments.map((segment, index) => (
                <li key={segment.key} className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`seg-title-${segment.key}`} className="text-xs font-semibold text-muted-foreground">
                        {t("segmentTitle", { number: index + 1 })}
                      </label>
                      <Input id={`seg-title-${segment.key}`} value={segment.title} maxLength={60} onChange={(e) => update(segment.key, { title: e.target.value })} required />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`seg-min-${segment.key}`} className="text-xs font-semibold text-muted-foreground">
                        {t("minutes")}
                      </label>
                      <Input id={`seg-min-${segment.key}`} type="number" inputMode="numeric" min={1} max={60} value={segment.minutes} onChange={(e) => update(segment.key, { minutes: e.target.value })} required />
                    </div>
                    {segments.length > 1 ? (
                      <Button type="button" size="sm" variant="secondary" className="self-end text-foreground" onClick={() => setSegments((list) => list.filter((item) => item.key !== segment.key))} aria-label={t("removeSegment", { number: index + 1 })}>
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`seg-ins-${segment.key}`} className="text-xs font-semibold text-muted-foreground">
                      {t("instruction")}
                    </label>
                    <Textarea id={`seg-ins-${segment.key}`} rows={2} maxLength={300} value={segment.instruction} onChange={(e) => update(segment.key, { instruction: e.target.value })} />
                  </div>
                </li>
              ))}
            </ol>
            {segments.length < 20 ? (
              <Button type="button" size="sm" variant="secondary" className="self-start text-foreground" onClick={() => setSegments((list) => [...list, blank()])}>
                <Plus className="size-4" aria-hidden="true" />
                {t("addSegment")}
              </Button>
            ) : null}
            <p className="text-sm text-muted-foreground">{t("total", { count: totalMinutes })}</p>
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
            <Button type="button" size="md" variant="secondary" className="text-foreground" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}

      {error && !open ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors(error)}
        </p>
      ) : null}

      <section aria-labelledby="guides-list" className="flex flex-col gap-3">
        <h2 id="guides-list" className="font-heading text-lg font-bold">
          {t("listTitle")}
        </h2>
        {guides.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {guides.map((guide) => (
              <li key={guide.id} className="flex flex-col gap-2 rounded-2xl bg-background p-4 ring-1 ring-border">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold">{guide.title}</h3>
                    {guide.description ? <p className="text-sm text-muted-foreground">{guide.description}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("segmentsCount", { count: guide.segments.length })} · {t("total", { count: guide.segments.reduce((sum, s) => sum + s.minutes, 0) })}
                    </p>
                  </div>
                  {confirming === guide.id ? (
                    <div role="group" aria-label={t("confirmDelete")} className="flex items-center gap-2">
                      <span className="text-sm">{t("confirmDelete")}</span>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(guide.id)}>
                        {t("confirmYes")}
                      </Button>
                      <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(null)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(guide.id)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("delete")}
                    </Button>
                  )}
                </div>
                <ol className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {guide.segments.map((segment, index) => (
                    <li key={`${segment.title}-${index}`} className="rounded-full bg-surface px-3 py-1">
                      {segment.title} · {segment.minutes} min
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
