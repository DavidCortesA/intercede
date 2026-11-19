"use client";

import { Shuffle, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BREAKOUT_MINUTES, BREAKOUT_SIZES, countByGroup, groupCountForSize, groupSizes, randomAssignments } from "@/features/breakouts/logic";
import { entitlementsSchema } from "@/features/billing/schemas";
import type { PrayerRequest, RoomMember } from "@/features/rooms/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

const ERROR_KEYS = ["generic", "not_host", "plan_required", "breakout_active", "invalid_groups", "too_many_groups", "invalid_duration", "not_enough_people", "invalid_assignments", "request_not_found"] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];
const toErrorKey = (message: string | undefined): ErrorKey => ((ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as ErrorKey) : "generic");

interface Props {
  roomId: string;
  communityId: string | null;
  hostId: string;
  members: RoomMember[];
  requests: PrayerRequest[];
}

/**
 * Dividir la sala en grupos pequeños (CLAUDE.md §16 B2): por tamaño o por número de grupos, reparto aleatorio o manual,
 * duración y, si quieres, una petición para cada grupo. La base valida de nuevo el plan, el número de grupos y quién
 * está presente.
 */
export function BreakoutStart({ roomId, communityId, hostId, members, requests }: Props) {
  const t = useTranslations("Breakouts.start");
  const errors = useTranslations("Breakouts.errors");
  const dialogRef = useRef<HTMLDialogElement>(null);

  const people = useMemo(() => members.filter((member) => member.left_at === null && !member.removed_at && member.user_id !== hostId), [members, hostId]);
  const openRequests = useMemo(() => requests.filter((request) => !request.is_answered), [requests]);

  const [maxGroups, setMaxGroups] = useState<number | null>(null);
  const [by, setBy] = useState<"size" | "count">("size");
  const [size, setSize] = useState<number>(3);
  const [count, setCount] = useState(2);
  const [minutes, setMinutes] = useState<number>(10);
  const [manual, setManual] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [groupRequests, setGroupRequests] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  // El contenido del diálogo solo existe mientras está abierto (no duplica en la página lo que ya se ve en la sala)
  const [isOpen, setIsOpen] = useState(false);

  const limit = maxGroups ?? 2;
  const groups = by === "size" ? groupCountForSize(people.length, size, limit) : Math.max(2, Math.min(count, limit));
  const counts = manual ? countByGroup(assignments, groups) : groupSizes(people.length, groups);
  const blocked = maxGroups === 0;

  async function open() {
    setError(null);
    setIsOpen(true);
    dialogRef.current?.showModal();
    if (maxGroups !== null) return;
    const supabase = createClient();
    // Los grupos son de comunidades con plan Plus o Pro: una sala personal no los tiene
    if (!communityId) return setMaxGroups(0);
    const { data } = await supabase.rpc("get_entitlements", { p_community_id: communityId });
    const parsed = entitlementsSchema.safeParse(data);
    setMaxGroups(parsed.success ? parsed.data.breakout_groups : 0);
  }

  function shuffle() {
    setAssignments(randomAssignments(people.map((person) => person.user_id), groups));
  }

  function chooseManual(next: boolean) {
    setManual(next);
    if (next) shuffle();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (people.length < groups) return setError("not_enough_people");
    const requestList = Array.from({ length: groups }, (_, index) => groupRequests[index + 1] || null);
    setBusy(true);
    const { error: failure } = await createClient().rpc("start_breakout", {
      p_room_id: roomId,
      p_group_count: groups,
      p_minutes: minutes,
      // Reparto manual: solo quien tiene grupo; sin él, la base reparte al azar y parejo
      p_assignments: manual ? Object.fromEntries(Object.entries(assignments).filter(([userId, group]) => group >= 1 && group <= groups && people.some((person) => person.user_id === userId))) : (undefined as never),
      p_requests: requestList.some(Boolean) ? (requestList as string[]) : (undefined as never),
    });
    setBusy(false);
    if (failure) return setError(toErrorKey(failure.message));
    dialogRef.current?.close();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => void open()}>
        <Users className="size-4" aria-hidden="true" />
        {t("button")}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="breakout-start-title"
        onClose={() => setIsOpen(false)}
        className="dark m-auto w-[min(94vw,34rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        {isOpen ? (
        <form onSubmit={submit} className="flex max-h-[90dvh] flex-col gap-5 overflow-y-auto p-6">
          <div>
            <h2 id="breakout-start-title" className="font-heading text-xl font-extrabold">
              {t("title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("body", { count: people.length })}</p>
          </div>

          {blocked ? (
            <div className="flex flex-col items-start gap-3">
              <p role="status" className="rounded-2xl bg-surface px-4 py-3 text-sm">
                {t("planRequired")}
              </p>
              <Link href="/precios" className="text-sm font-semibold underline underline-offset-4">
                {t("seePlans")}
              </Link>
            </div>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">{t("howMany")}</legend>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                    <input type="radio" name="by" checked={by === "size"} onChange={() => setBy("size")} />
                    {t("bySize")}
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                    <input type="radio" name="by" checked={by === "count"} onChange={() => setBy("count")} />
                    {t("byCount")}
                  </label>
                </div>
                {by === "size" ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor="breakout-size" className="text-sm">
                      {t("sizeLabel")}
                    </label>
                    <select id="breakout-size" value={size} onChange={(e) => setSize(Number(e.target.value))} className="min-h-11 rounded-xl border border-border bg-surface px-3">
                      {BREAKOUT_SIZES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <label htmlFor="breakout-count" className="text-sm">
                      {t("countLabel", { max: limit })}
                    </label>
                    <input id="breakout-count" type="number" min={2} max={limit} value={count} onChange={(e) => setCount(Number(e.target.value))} className="min-h-11 w-24 rounded-xl border border-border bg-surface px-3" />
                  </div>
                )}
                <p className="text-sm text-muted-foreground" data-testid="breakout-summary">
                  {t("summary", { groups, sizes: counts.join(" · ") })}
                </p>
              </fieldset>

              <div className="flex items-center gap-2">
                <label htmlFor="breakout-minutes" className="text-sm font-semibold">
                  {t("duration")}
                </label>
                <select id="breakout-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="min-h-11 rounded-xl border border-border bg-surface px-3">
                  {BREAKOUT_MINUTES.map((value) => (
                    <option key={value} value={value}>
                      {t("minutes", { count: value })}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">{t("assign")}</legend>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                    <input type="radio" name="assign" checked={!manual} onChange={() => chooseManual(false)} />
                    {t("random")}
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                    <input type="radio" name="assign" checked={manual} onChange={() => chooseManual(true)} />
                    {t("manual")}
                  </label>
                </div>
                {manual ? (
                  <div className="flex flex-col gap-2">
                    <Button type="button" size="sm" variant="secondary" className="self-start" onClick={shuffle}>
                      <Shuffle className="size-4" aria-hidden="true" />
                      {t("reshuffle")}
                    </Button>
                    <ul className="flex flex-col gap-2">
                      {people.map((person) => (
                        <li key={person.user_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                          <label htmlFor={`assign-${person.user_id}`} className="min-w-0 truncate text-sm font-semibold">
                            {person.display_name}
                          </label>
                          <select
                            id={`assign-${person.user_id}`}
                            value={assignments[person.user_id] ?? 0}
                            onChange={(e) => setAssignments((current) => ({ ...current, [person.user_id]: Number(e.target.value) }))}
                            className="min-h-11 rounded-xl border border-border bg-background px-2"
                          >
                            <option value={0}>{t("stayMain")}</option>
                            {Array.from({ length: groups }, (_, index) => (
                              <option key={index} value={index + 1}>
                                {t("group", { number: index + 1 })}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </fieldset>

              {openRequests.length > 0 ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-semibold">{t("requestsTitle")}</legend>
                  <p className="text-xs text-muted-foreground">{t("requestsHelp")}</p>
                  {Array.from({ length: groups }, (_, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <label htmlFor={`request-${index}`} className="w-20 shrink-0 text-sm">
                        {t("group", { number: index + 1 })}
                      </label>
                      <select
                        id={`request-${index}`}
                        value={groupRequests[index + 1] ?? ""}
                        onChange={(e) => setGroupRequests((current) => ({ ...current, [index + 1]: e.target.value }))}
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-2"
                      >
                        <option value="">{t("noRequest")}</option>
                        {openRequests.map((request) => (
                          <option key={request.id} value={request.id}>
                            {request.content.length > 50 ? `${request.content.slice(0, 50)}…` : request.content}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </fieldset>
              ) : null}
            </>
          )}

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errors(error)}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            {!blocked ? (
              <Button type="submit" size="md" disabled={busy || maxGroups === null}>
                {busy ? t("starting") : t("start")}
              </Button>
            ) : null}
            <Button type="button" size="md" variant="secondary" onClick={() => dialogRef.current?.close()}>
              {t("cancel")}
            </Button>
          </div>
        </form>
        ) : null}
      </dialog>
    </>
  );
}
