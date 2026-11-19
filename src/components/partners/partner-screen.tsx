"use client";

import { HandHeart, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { ModerationMenu } from "@/components/moderation/moderation-menu";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  overviewSchema,
  PARTNER_MAX_REQUESTS,
  PARTNER_NOTE_MAX,
  PARTNER_REQUEST_MAX,
  parseLabels,
  toPartnerError,
  type PartnerErrorKey,
  type PartnerOverview,
} from "@/features/partners/schemas";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Compañero de oración (CLAUDE.md §16 B7, solo personas adultas). Anotarse, pausar o salir; la pareja de la semana con sus
 * peticiones, "Estoy orando por ti" y una revisión sencilla. De la pareja solo se ve el nombre. Todas las reglas (adultas,
 * bloqueos, máximos) las decide la base de datos; esta pantalla solo las explica.
 */
export function PartnerScreen({ communityId, initial }: { communityId: string; initial: PartnerOverview }) {
  const t = useTranslations("Partners");
  const errors = useTranslations("Partners.errors");
  const [data, setData] = useState(initial);
  const [error, setError] = useState<PartnerErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data: next } = await createClient().rpc("partner_overview", { p_community_id: communityId });
    const parsed = overviewSchema.safeParse(next);
    if (parsed.success) setData(parsed.data);
  }, [communityId]);

  /** Ejecuta una acción de la base y vuelve a leer; muestra el error si lo hay. */
  async function act(run: () => PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { error: failure } = await run();
    setBusy(false);
    if (failure) {
      setError(toPartnerError(failure.message));
      return false;
    }
    await refresh();
    return true;
  }

  const supabase = () => createClient();
  const { program, signup, pair } = data;

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-muted-foreground">{t("intro")}</p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors(error)}
        </p>
      ) : null}

      {data.is_leader ? <LeaderPanel communityId={communityId} data={data} act={act} busy={busy} supabase={supabase} /> : null}

      {!signup ? (
        <JoinPanel communityId={communityId} data={data} act={act} busy={busy} supabase={supabase} />
      ) : (
        <section aria-labelledby="signup-title" className="flex flex-col gap-3 rounded-3xl bg-background p-5 ring-1 ring-border">
          <h2 id="signup-title" className="font-heading text-lg font-bold">
            {signup.paused ? t("status.paused") : t("status.signedUp")}
          </h2>
          <p className="text-sm text-muted-foreground">{signup.paused ? t("status.pausedHelp") : t("status.signedUpHelp")}</p>
          {signup.group_label ? <p className="text-sm">{t("status.group", { label: signup.group_label })}</p> : null}
          <LeaveControls communityId={communityId} paused={signup.paused} act={act} busy={busy} supabase={supabase} />
        </section>
      )}

      {signup && !pair ? (
        <p role="status" className="rounded-2xl bg-surface px-5 py-4 text-sm ring-1 ring-border">
          {t("noPair")}
        </p>
      ) : null}

      {pair ? <PairCard pair={pair} act={act} busy={busy} supabase={supabase} communityId={communityId} /> : null}
      {program && !program.active && !data.is_leader ? <p className="text-sm text-muted-foreground">{t("closed")}</p> : null}
    </div>
  );
}

type Shared = {
  act: (run: () => PromiseLike<{ error: { message: string } | null }>) => Promise<boolean>;
  busy: boolean;
  supabase: () => ReturnType<typeof createClient>;
};

function LeaderPanel({ communityId, data, act, busy, supabase }: Shared & { communityId: string; data: PartnerOverview }) {
  const t = useTranslations("Partners.leader");
  const [mode, setMode] = useState<"random" | "group">(data.program?.mode ?? "random");
  const [labels, setLabels] = useState((data.program?.labels ?? []).join("\n"));
  const [active, setActive] = useState(data.program?.active ?? false);
  const [saved, setSaved] = useState(false);
  const [made, setMade] = useState<number | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const ok = await act(() => supabase().rpc("configure_partner_program", { p_community_id: communityId, p_mode: mode, p_active: active, p_labels: parseLabels(labels) }));
    setSaved(ok);
  }

  async function pairNow() {
    setMade(null);
    const client = supabase();
    await act(async () => {
      const { data: count, error } = await client.rpc("pair_partners_now", { p_community_id: communityId });
      if (!error) setMade(count ?? 0);
      return { error };
    });
  }

  return (
    <section aria-labelledby="leader-title" className="flex flex-col gap-4 rounded-3xl bg-background p-5 ring-1 ring-border">
      <div>
        <h2 id="leader-title" className="font-heading text-lg font-bold">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("help")}</p>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-[var(--color-brand-violet)]" />
          {t("active")}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">{t("mode")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="partner-mode" checked={mode === "random"} onChange={() => setMode("random")} />
            {t("random")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="partner-mode" checked={mode === "group"} onChange={() => setMode("group")} />
            {t("byGroup")}
          </label>
        </fieldset>
        {mode === "group" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="partner-labels" className="text-sm font-semibold">
              {t("labels")}
            </label>
            <Textarea id="partner-labels" rows={3} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("labelsPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("labelsHelp")}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md" disabled={busy}>
            {t("save")}
          </Button>
          {data.program?.active ? (
            <Button type="button" size="md" variant="secondary" className="text-foreground" disabled={busy} onClick={() => void pairNow()}>
              {t("pairNow")}
            </Button>
          ) : null}
        </div>
        {saved ? (
          <p role="status" className="text-sm font-semibold text-success">
            {t("saved")}
          </p>
        ) : null}
        {made !== null ? (
          <p role="status" className="text-sm font-semibold" data-testid="pair-now-result">
            {t("pairedResult", { count: made })}
          </p>
        ) : null}
      </form>

      {data.stats ? (
        <p className="text-sm text-muted-foreground" data-testid="partner-stats">
          {t("stats", { signups: data.stats.signups, paused: data.stats.paused, pairs: data.stats.pairs_this_week })}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
    </section>
  );
}

function JoinPanel({ communityId, data, act, busy, supabase }: Shared & { communityId: string; data: PartnerOverview }) {
  const t = useTranslations("Partners.join");
  const program = data.program;
  const [adult, setAdult] = useState(data.adult_confirmed);
  const [label, setLabel] = useState(program?.labels[0] ?? "");

  if (!program?.active) return null;

  async function join(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      const client = supabase();
      // Solo personas adultas: la declaración se guarda en el perfil (una vez) antes de anotarse
      if (!data.adult_confirmed) {
        const confirmed = await client.rpc("confirm_adult");
        if (confirmed.error) return confirmed;
      }
      return client.rpc("join_partner_program", { p_community_id: communityId, p_group_label: program?.mode === "group" ? label : (undefined as never) });
    });
  }

  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-4 rounded-3xl bg-background p-5 ring-1 ring-border">
      <div>
        <h2 id="join-title" className="font-heading text-lg font-bold">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("how")}</p>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        <li>{t("safety1")}</li>
        <li>{t("safety2")}</li>
        <li>{t("safety3")}</li>
      </ul>
      <form onSubmit={join} className="flex flex-col gap-4">
        {program.mode === "group" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="partner-label" className="text-sm font-semibold">
              {t("groupLabel")}
            </label>
            <select id="partner-label" value={label} onChange={(e) => setLabel(e.target.value)} className="min-h-12 rounded-2xl border border-border bg-surface px-4">
              {program.labels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {!data.adult_confirmed ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--color-brand-violet)]" />
            {t("adult")}
          </label>
        ) : null}
        <Button type="submit" size="md" className="self-start" disabled={busy || !adult}>
          {t("submit")}
        </Button>
      </form>
    </section>
  );
}

function LeaveControls({ communityId, paused, act, busy, supabase }: Shared & { communityId: string; paused: boolean }) {
  const t = useTranslations("Partners.status");
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => void act(() => supabase().rpc("set_partner_paused", { p_community_id: communityId, p_paused: !paused }))}>
        {paused ? t("resume") : t("pause")}
      </Button>
      {confirming ? (
        <div role="group" aria-label={t("leaveConfirm")} className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t("leaveConfirm")}</span>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(() => supabase().rpc("leave_partner_program", { p_community_id: communityId }))}>
            {t("leaveYes")}
          </Button>
          <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirming(true)}>
          {t("leave")}
        </Button>
      )}
    </div>
  );
}

function PairCard({ pair, act, busy, supabase, communityId }: Shared & { pair: NonNullable<PartnerOverview["pair"]>; communityId: string }) {
  const t = useTranslations("Partners.pair");
  const [content, setContent] = useState("");
  const [note, setNote] = useState(pair.my_checkin?.note ?? "");
  const ended = pair.ended;

  async function addRequest(event: React.FormEvent) {
    event.preventDefault();
    if (await act(() => supabase().rpc("add_partner_request", { p_pair_id: pair.id, p_content: content }))) setContent("");
  }

  const statuses = ["good", "ok", "hard"] as const;

  return (
    <section aria-labelledby="pair-title" className="flex flex-col gap-5 rounded-3xl bg-background p-5 ring-1 ring-border">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pair-title" className="font-heading text-xl font-extrabold">
            {t("title", { name: pair.partner_name })}
          </h2>
          <p className="text-sm text-muted-foreground">{t("week", { date: pair.week_start })}</p>
        </div>
        {!ended ? <ModerationMenu target={{ type: "user", id: pair.partner_id }} author={{ id: pair.partner_id, name: pair.partner_name }} communityId={communityId} label={t("reportOrBlock")} /> : null}
      </header>

      {ended ? (
        <p role="status" className="rounded-2xl bg-surface px-4 py-3 text-sm" data-testid="pair-ended">
          {t("ended")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">{t("theirRequests", { name: pair.partner_name })}</h3>
        {pair.partner_requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTheirRequests")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pair.partner_requests.map((request) => (
              <li key={request.id} className="rounded-xl bg-surface px-4 py-3 text-sm">
                {request.content}
              </li>
            ))}
          </ul>
        )}
        {!ended ? (
          <Button
            size="sm"
            variant={pair.i_pray ? "primary" : "secondary"}
            className={cn("self-start", !pair.i_pray && "text-foreground")}
            aria-pressed={pair.i_pray}
            disabled={busy}
            onClick={() => void act(() => supabase().rpc("set_partner_praying", { p_pair_id: pair.id, p_on: !pair.i_pray }))}
          >
            <HandHeart className="size-4" aria-hidden="true" />
            {pair.i_pray ? t("iPrayOn") : t("iPray")}
          </Button>
        ) : null}
        {pair.partner_prays ? (
          <p role="status" className="text-sm font-semibold" data-testid="partner-prays">
            {t("partnerPrays", { name: pair.partner_name })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">{t("myRequests")}</h3>
        <p className="text-xs text-muted-foreground">{t("myRequestsHelp", { max: PARTNER_MAX_REQUESTS })}</p>
        <ul className="flex flex-col gap-2">
          {pair.my_requests.map((request) => (
            <li key={request.id} className="flex items-start justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-sm">
              <span className="min-w-0 break-words">{request.content}</span>
              {!ended ? (
                <Button size="sm" variant="secondary" className="shrink-0 text-foreground" aria-label={t("deleteRequest")} disabled={busy} onClick={() => void act(() => supabase().rpc("delete_partner_request", { p_request_id: request.id }))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!ended && pair.my_requests.length < PARTNER_MAX_REQUESTS ? (
          <form onSubmit={addRequest} className="flex flex-col gap-2">
            <label htmlFor="partner-request" className="text-sm font-semibold">
              {t("newRequest")}
            </label>
            <Textarea id="partner-request" rows={2} maxLength={PARTNER_REQUEST_MAX} value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="flex items-center justify-between gap-3">
              <Button type="submit" size="sm" disabled={busy || content.trim().length === 0}>
                {t("addRequest")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {content.length}/{PARTNER_REQUEST_MAX}
              </span>
            </div>
          </form>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">{t("checkinTitle")}</h3>
        <div role="group" aria-label={t("checkinTitle")} className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={pair.my_checkin?.status === status ? "primary" : "secondary"}
              className={cn(pair.my_checkin?.status !== status && "text-foreground")}
              aria-pressed={pair.my_checkin?.status === status}
              disabled={busy || ended}
              onClick={() => void act(() => supabase().rpc("submit_partner_checkin", { p_pair_id: pair.id, p_status: status, p_note: note as string }))}
            >
              {t(`checkin.${status}`)}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="partner-note" className="text-xs font-semibold text-muted-foreground">
            {t("note")}
          </label>
          <Input id="partner-note" value={note} maxLength={PARTNER_NOTE_MAX} onChange={(e) => setNote(e.target.value)} disabled={ended} />
        </div>
        {pair.partner_checkin ? (
          <p className="text-sm" data-testid="partner-checkin">
            {t("partnerCheckin", { name: pair.partner_name, status: t(`checkin.${pair.partner_checkin.status}`) })}
            {pair.partner_checkin.note ? ` — ${pair.partner_checkin.note}` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}
