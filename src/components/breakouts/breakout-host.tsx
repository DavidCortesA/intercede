"use client";

import { Megaphone, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendHostCommand } from "@/features/audio/api";
import { breakoutRemainingMs } from "@/features/breakouts/logic";
import type { BreakoutState } from "@/features/breakouts/use-breakout";
import { formatCountdown } from "@/features/guides/timer";
import type { PrayerRequest, RoomMember } from "@/features/rooms/types";
import { createClient } from "@/lib/supabase/client";
import { BreakoutStart } from "./breakout-start";

interface Props {
  roomId: string;
  communityId: string | null;
  hostId: string;
  members: RoomMember[];
  requests: PrayerRequest[];
  state: BreakoutState;
  serverNowMs: number;
  /** Grupo que la anfitriona está visitando (su audio está en esa sala), si hay. */
  visitGroupId: string | null;
  onVisit: (groupId: string | null) => void;
  /** ¿Ya está conectada al audio? Para visitar un grupo hay que estar en el audio. */
  audioConnected: boolean;
}

/** Controles de la anfitriona para los grupos pequeños: dividir, ver los grupos, avisar a todos y volver a la sala principal. */
export function BreakoutHost({ roomId, communityId, hostId, members, requests, state, serverNowMs, visitGroupId, onVisit, audioConnected }: Props) {
  const t = useTranslations("Breakouts.host");
  const errors = useTranslations("Breakouts.errors");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"generic" | "invalid_message" | null>(null);
  const [sent, setSent] = useState(false);

  const { breakout, groups, assignments } = state;

  if (!breakout || breakout.status !== "active") {
    return <BreakoutStart roomId={roomId} communityId={communityId} hostId={hostId} members={members} requests={requests} />;
  }

  const names = new Map(members.map((member) => [member.user_id, member.display_name]));
  const remaining = breakoutRemainingMs(breakout.ends_at, serverNowMs);

  async function announce(event: React.FormEvent) {
    event.preventDefault();
    setFailed(null);
    setSent(false);
    setBusy(true);
    const { error } = await createClient().rpc("announce_breakout", { p_room_id: roomId, p_message: message });
    setBusy(false);
    if (error) return setFailed(error.message === "invalid_message" ? "invalid_message" : "generic");
    setMessage("");
    setSent(true);
  }

  async function end() {
    setBusy(true);
    setFailed(null);
    onVisit(null);
    const result = await sendHostCommand({ action: "end_breakout", roomId });
    setBusy(false);
    if (!result.ok) setFailed("generic");
  }

  return (
    <section aria-labelledby="breakout-host-title" className="flex w-full flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="breakout-host-title" className="font-heading text-base font-bold">
          {t("title")}
        </h3>
        <p className="font-mono text-xl font-bold tabular-nums" aria-label={t("remaining", { time: formatCountdown(remaining) })}>
          {remaining > 0 ? formatCountdown(remaining) : t("ending")}
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {groups.map((group) => {
          const inGroup = assignments.filter((assignment) => assignment.group_id === group.id).map((assignment) => names.get(assignment.user_id) ?? "—");
          const visiting = visitGroupId === group.id;
          return (
            <li key={group.id} className="flex flex-col gap-2 rounded-xl bg-background p-3" data-testid={`breakout-group-${group.position}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{group.name}</p>
                <span className="text-xs text-muted-foreground">{t("people", { count: inGroup.length })}</span>
              </div>
              <p className="text-sm text-muted-foreground">{inGroup.length > 0 ? inGroup.join(", ") : t("empty")}</p>
              <Button size="sm" variant={visiting ? "primary" : "secondary"} aria-pressed={visiting} onClick={() => onVisit(visiting ? null : group.id)}>
                {visiting ? t("leaveGroup") : t("visit")}
              </Button>
            </li>
          );
        })}
      </ul>

      {visitGroupId && !audioConnected ? (
        <p role="status" className="rounded-xl bg-brand-gold/20 px-3 py-2 text-sm">
          {t("visitHint")}
        </p>
      ) : null}

      <form onSubmit={announce} className="flex flex-col gap-2">
        <label htmlFor="breakout-message" className="text-sm font-semibold">
          {t("announceLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="breakout-message"
            value={message}
            maxLength={140}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("announcePlaceholder")}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3"
          />
          <Button type="submit" size="sm" disabled={busy || message.trim().length === 0}>
            <Megaphone className="size-4" aria-hidden="true" />
            {t("announce")}
          </Button>
        </div>
        {sent ? (
          <p role="status" className="text-xs font-semibold text-success">
            {t("sent")}
          </p>
        ) : null}
      </form>

      {failed ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors(failed === "invalid_message" ? "invalid_message" : "generic")}
        </p>
      ) : null}

      <Button variant="secondary" size="md" disabled={busy} onClick={() => void end()}>
        <Undo2 className="size-4" aria-hidden="true" />
        {t("end")}
      </Button>
    </section>
  );
}
