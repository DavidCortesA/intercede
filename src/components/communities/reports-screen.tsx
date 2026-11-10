"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import type { ReportReason, ReportTarget } from "@/features/moderation/schemas";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export interface ReportView {
  id: string;
  type: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  /** Nombre de la persona reportada (o autora del contenido), si sigue en la comunidad. */
  targetName: string | null;
  /** Texto de la publicación del muro, si todavía existe. */
  preview: string | null;
}

/**
 * Reportes de la comunidad para el liderazgo. Quien reportó permanece anónima (la pantalla ni siquiera
 * recibe su identidad). Atender, descartar y eliminar la publicación son acciones de la base (RLS y funciones).
 */
export function ReportsScreen({ open, closed }: { open: ReportView[]; closed: ReportView[] }) {
  const t = useTranslations("Communities.reports");
  const moderation = useTranslations("Moderation.report.reasons");
  const errors = useTranslations("Communities.errors");
  const format = useFormatter();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  async function resolve(id: string, status: "resolved" | "dismissed" | "open") {
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.rpc("resolve_report", { p_report_id: id, p_status: status });
    setBusy(false);
    if (failure) return setError(toCommunityError(failure));
    router.refresh();
  }

  async function deletePost(report: ReportView) {
    setConfirming(null);
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.from("community_requests").delete().eq("id", report.targetId);
    if (failure) {
      setBusy(false);
      return setError("generic");
    }
    await resolve(report.id, "resolved");
  }

  const card = (report: ReportView, isOpen: boolean) => (
    <li key={report.id} className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border">
      <header>
        <p className="font-heading font-bold">{t(`types.${report.type}`)}</p>
        <p className="text-xs text-muted-foreground">
          {format.dateTime(new Date(report.createdAt), { dateStyle: "medium", timeStyle: "short" })} ·{" "}
          {t("target", { name: report.targetName ?? t("unknownTarget") })}
        </p>
      </header>
      <p className="text-sm">
        <span className="font-semibold">{t("reasonLabel")}: </span>
        {moderation(report.reason)}
      </p>
      {report.details ? <p className="rounded-xl bg-surface p-3 text-sm whitespace-pre-line">{report.details}</p> : null}
      {report.type === "community_request" ? (
        report.preview ? (
          <blockquote className="border-l-[3px] border-border pl-3 text-sm whitespace-pre-line text-muted-foreground">{report.preview}</blockquote>
        ) : (
          <p className="text-xs text-muted-foreground">{t("removed")}</p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isOpen ? (
          <>
            {report.type === "community_request" && report.preview ? (
              confirming === report.id ? (
                <div role="group" aria-label={t("confirmDelete")} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{t("confirmDelete")}</span>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => deletePost(report)}>
                    {t("confirmYes")}
                  </Button>
                  <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(null)}>
                    {t("cancel")}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => setConfirming(report.id)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t("deletePost")}
                </Button>
              )
            ) : null}
            <Button size="sm" disabled={busy} onClick={() => resolve(report.id, "resolved")}>
              {t("markResolved")}
            </Button>
            <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => resolve(report.id, "dismissed")}>
              {t("dismiss")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => resolve(report.id, "open")}>
            {t("reopen")}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-extrabold">{t("title")}</h2>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors(error)}
        </p>
      ) : null}

      {open.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-6 text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">{open.map((report) => card(report, true))}</ul>
      )}

      {closed.length > 0 ? (
        <section aria-labelledby="closed-reports-title" className="flex flex-col gap-3">
          <h3 id="closed-reports-title" className="font-heading text-lg font-extrabold">
            {t("resolvedTitle")}
          </h3>
          <ul className="flex flex-col gap-3">{closed.map((report) => card(report, false))}</ul>
        </section>
      ) : null}
    </div>
  );
}
