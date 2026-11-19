"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCountdown } from "@/features/guides/timer";
import { breakoutRemainingMs } from "@/features/breakouts/logic";
import type { BreakoutState } from "@/features/breakouts/use-breakout";
import type { PrayerRequest, RoomMember } from "@/features/rooms/types";

interface Props {
  state: BreakoutState;
  meId: string;
  isHost: boolean;
  members: RoomMember[];
  requests: PrayerRequest[];
  serverNowMs: number;
}

/**
 * Lo que ve cada persona durante los grupos pequeños (CLAUDE.md §16 B2): en qué grupo está, quién está con ella, por quién
 * orar, cuánto falta para volver y el aviso de la anfitriona. El regreso es automático (ver `activeGroupId`).
 */
export function BreakoutBanner({ state, meId, isHost, members, requests, serverNowMs }: Props) {
  const t = useTranslations("Breakouts.banner");
  const { breakout, groups, assignments } = state;
  if (!breakout || breakout.status !== "active") return null;

  const mine = assignments.find((assignment) => assignment.user_id === meId);
  const group = mine ? groups.find((item) => item.id === mine.group_id) : null;
  const remaining = breakoutRemainingMs(breakout.ends_at, serverNowMs);
  const names = new Map(members.map((member) => [member.user_id, member.display_name]));
  const mates = group ? assignments.filter((assignment) => assignment.group_id === group.id && assignment.user_id !== meId).map((assignment) => names.get(assignment.user_id) ?? t("someone")) : [];
  const request = group?.request_id ? requests.find((item) => item.id === group.request_id) : null;

  return (
    <section aria-label={t("label")} className="border-b border-brand-lavender/40 bg-brand-violet/15 px-4 py-3 text-sm">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {group && !isHost ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-heading text-base font-extrabold">
                <Users className="size-4" aria-hidden="true" />
                {t("youAreIn", { name: group.name })}
              </p>
              <p className="font-mono text-lg font-bold tabular-nums" aria-label={t("remaining", { time: formatCountdown(remaining) })}>
                {remaining > 0 ? formatCountdown(remaining) : t("returning")}
              </p>
            </div>
            <p className="text-muted-foreground">{mates.length > 0 ? t("with", { names: mates.join(", ") }) : t("alone")}</p>
            {request ? (
              <p className="rounded-xl bg-background/60 px-3 py-2">
                <strong>{t("prayFor")}</strong> {request.content}
              </p>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 font-semibold">
            <Users className="size-4" aria-hidden="true" />
            {isHost ? t("hostActive") : t("stayMain")}
            {remaining > 0 ? <span className="font-mono tabular-nums">· {formatCountdown(remaining)}</span> : null}
          </p>
        )}
        {breakout.announcement ? (
          <p role="status" aria-live="polite" className="rounded-xl bg-brand-gold/20 px-3 py-2 font-semibold" data-testid="breakout-announcement">
            {t("announcement", { message: breakout.announcement })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
