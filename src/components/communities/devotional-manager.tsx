"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export interface ManagedDevotional {
  id: string;
  devotional_date: string;
  passage_reference: string;
}

/**
 * Publicar y retirar los devocionales de la comunidad (solo administración y liderazgo; RLS lo exige).
 * El contenido y su licencia son responsabilidad de quien lo publica.
 */
export function DevotionalManager({ communityId, today, items }: { communityId: string; today: string; items: ManagedDevotional[] }) {
  const t = useTranslations("Communities.devotional.manage");
  const errors = useTranslations("Communities.errors");
  const format = useFormatter();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [text, setText] = useState("");
  const [version, setVersion] = useState("");
  const [reflection, setReflection] = useState("");
  const [question, setQuestion] = useState("");
  const [prayer, setPrayer] = useState("");
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const complete = [date, reference, text, version, reflection, question].every((value) => value.trim().length > 0);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    setPublished(false);
    const { error: failure } = await supabase.from("devotionals").insert({
      community_id: communityId,
      devotional_date: date,
      passage_reference: reference.trim(),
      passage_text: text.trim(),
      bible_version: version.trim(),
      reflection: reflection.trim(),
      question: question.trim(),
      suggested_prayer: prayer.trim() || null,
    });
    setSaving(false);
    if (failure) return setError(toCommunityError(failure));
    setPublished(true);
    setReference("");
    setText("");
    setReflection("");
    setQuestion("");
    setPrayer("");
    router.refresh();
  }

  async function remove(id: string) {
    setRemoving(null);
    const { error: failure } = await supabase.from("devotionals").delete().eq("id", id);
    if (failure) return setError("generic");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={publish} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("license")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dev-date" className="text-sm font-semibold">
              {t("date")}
            </label>
            <Input id="dev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dev-version" className="text-sm font-semibold">
              {t("version")}
            </label>
            <Input id="dev-version" value={version} maxLength={60} onChange={(e) => setVersion(e.target.value)} required />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dev-reference" className="text-sm font-semibold">
            {t("reference")}
          </label>
          <Input id="dev-reference" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dev-text" className="text-sm font-semibold">
            {t("text")}
          </label>
          <Textarea id="dev-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dev-reflection" className="text-sm font-semibold">
            {t("reflection")}
          </label>
          <Textarea id="dev-reflection" rows={4} maxLength={4000} value={reflection} onChange={(e) => setReflection(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dev-question" className="text-sm font-semibold">
            {t("question")}
          </label>
          <Input id="dev-question" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dev-prayer" className="text-sm font-semibold">
            {t("prayer")}
          </label>
          <Textarea id="dev-prayer" rows={2} maxLength={1000} value={prayer} onChange={(e) => setPrayer(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errors(error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" disabled={saving || !complete} aria-busy={saving}>
            {saving ? t("submitting") : t("submit")}
          </Button>
          {published ? (
            <p role="status" className="text-sm font-semibold text-success">
              {t("published")}
            </p>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="dev-list-title" className="flex flex-col gap-3">
        <h2 id="dev-list-title" className="font-heading text-lg font-extrabold">
          {t("listTitle")}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const label = format.dateTime(new Date(`${item.devotional_date}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-3 shadow-sm ring-1 ring-border">
                  <div className="min-w-0 flex-1">
                    <p className="font-heading font-bold">{item.passage_reference}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  {removing === item.id ? (
                    <div role="group" aria-label={t("confirmRemove", { date: label })} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">{t("confirmRemove", { date: label })}</span>
                      <Button size="sm" variant="danger" onClick={() => remove(item.id)}>
                        {t("confirmYes")}
                      </Button>
                      <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setRemoving(null)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setRemoving(item.id)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
