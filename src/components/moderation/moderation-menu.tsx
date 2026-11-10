"use client";

import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { REPORT_REASONS, toModerationError, type ModerationErrorKey, type ReportReason, type ReportTarget } from "@/features/moderation/schemas";
import { createClient } from "@/lib/supabase/client";

interface Props {
  /** Qué se reporta (la base comprueba que la persona pueda verlo). */
  target: { type: ReportTarget; id: string };
  /** Si el contenido es de otra persona: permite también bloquearla. */
  author?: { id: string; name: string };
  /** Comunidad desde la que se reporta (el liderazgo la ve). */
  communityId?: string;
  /** Texto del botón: por defecto "Reportar o bloquear" si hay autor, "Reportar" si no. */
  label?: string;
  onBlocked?: (userId: string) => void;
  className?: string;
}

/**
 * Reportar un contenido y/o bloquear a su autor/a. Es un panel que se abre en el mismo lugar (sin ventana
 * encima: la sala de oración se mantiene sobria). Reglas (qué se puede reportar, límites diarios) en la base.
 */
export function ModerationMenu({ target, author, communityId, label, onBlocked, className }: Props) {
  const t = useTranslations("Moderation");
  const panelId = useId();
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<ModerationErrorKey | null>(null);

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) return setError("invalid_reason");
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.rpc("create_report", {
      p_type: target.type,
      p_target_id: target.id,
      p_reason: reason,
      p_details: details.trim() || undefined,
      p_community_id: communityId,
    });
    setBusy(false);
    if (failure) return setError(toModerationError(failure));
    setSent(true);
  }

  async function block() {
    if (!author) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.rpc("block_user", { p_user_id: author.id });
    setBusy(false);
    if (failure) return setError(toModerationError(failure));
    setBlocked(true);
    onBlocked?.(author.id);
  }

  return (
    <div className={className}>
      <Button
        size="sm"
        variant="secondary"
        className="text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Flag className="size-4" aria-hidden="true" />
        {label ?? (author ? t("trigger") : t("triggerReport"))}
      </Button>

      {open ? (
        <div id={panelId} className="mt-3 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 text-left">
          {sent ? (
            <p role="status" className="text-sm font-semibold text-success">
              {t("report.sent")}
            </p>
          ) : (
            <form onSubmit={submitReport} className="flex flex-col gap-3" noValidate>
              <h4 className="font-heading text-sm font-bold">{t("report.title")}</h4>
              <fieldset className="flex flex-col gap-1">
                <legend className="sr-only">{t("report.reason")}</legend>
                {REPORT_REASONS.map((key) => (
                  <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="radio" name={`reason-${panelId}`} value={key} checked={reason === key} onChange={() => setReason(key)} className="size-5 shrink-0 accent-brand-violet" />
                    {t(`report.reasons.${key}`)}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`details-${panelId}`} className="text-sm font-semibold">
                  {t("report.details")}
                </label>
                <Textarea id={`details-${panelId}`} rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t("report.detailsHelp")}</p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || !reason} aria-busy={busy}>
                  {busy ? t("report.submitting") : t("report.submit")}
                </Button>
                <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </form>
          )}

          {author ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {blocked ? (
                <p role="status" className="text-sm font-semibold text-success">
                  {t("block.done", { name: author.name })}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t("block.help")}</p>
                  <Button size="sm" variant="secondary" className="self-start text-foreground" disabled={busy} onClick={block}>
                    {t("block.action", { name: author.name })}
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
