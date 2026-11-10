"use client";

import { Mic, MicOff, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Presence } from "@/features/audio/use-live-audio";
import type { RoomMember } from "@/features/rooms/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";

interface Props {
  members: RoomMember[];
  meId: string;
  /** Estado de audio por persona; solo existe cuando yo estoy conectado al audio. */
  presence: ReadonlyMap<string, Presence>;
  audioActive: boolean;
  isHost: boolean;
  onMute: (userId: string) => void;
  onRemove: (userId: string) => void;
}

/** Quiénes están ahora en la sala (left_at nulo), con su estado de audio y las acciones del anfitrión. */
export function Participants({ members, meId, presence, audioActive, isHost, onMute, onRemove }: Props) {
  const t = useTranslations("Room");
  const audio = useTranslations("Audio");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pendingRemoval, setPendingRemoval] = useState<RoomMember | null>(null);

  const present = members
    .filter((m) => m.left_at === null)
    .sort((a, b) => Number(b.role === "host") - Number(a.role === "host") || a.joined_at.localeCompare(b.joined_at));

  return (
    <section aria-label={t("participants.title")}>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {present.map((member) => {
          const state = presence.get(member.user_id);
          const inAudio = audioActive && state !== undefined;
          const name = member.user_id === meId ? t("header.you") : member.display_name;
          const canModerate = isHost && member.user_id !== meId && member.role !== "host";

          return (
            <li key={member.user_id} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
              <div className="relative">
                <Avatar
                  userId={member.user_id}
                  name={member.display_name}
                  className={cn("size-12", state?.speaking && "ring-2 ring-brand-cyan ring-offset-2 ring-offset-background")}
                />
                {inAudio ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-border",
                      state.micOn ? "bg-brand-cyan text-brand-navy-900" : "bg-surface text-muted-foreground",
                    )}
                  >
                    {state.micOn ? <Mic className="size-3" /> : <MicOff className="size-3" />}
                  </span>
                ) : null}
              </div>
              <span className="w-full truncate text-xs font-semibold">{name}</span>
              {member.role === "host" ? (
                <span className="text-[10px] uppercase tracking-wider text-brand-gold">{t("header.host")}</span>
              ) : null}
              {audioActive ? (
                <span className="sr-only">
                  {state?.speaking
                    ? audio("participant.speaking")
                    : state
                      ? state.micOn
                        ? audio("participant.micOn")
                        : audio("participant.micOff")
                      : audio("participant.noAudio")}
                </span>
              ) : null}

              {canModerate ? (
                <div className="flex gap-1">
                  {inAudio && state.micOn ? (
                    <button
                      type="button"
                      onClick={() => onMute(member.user_id)}
                      aria-label={audio("host.mute", { name: member.display_name })}
                      className="grid size-8 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
                    >
                      <MicOff className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRemoval(member);
                      dialogRef.current?.showModal();
                    }}
                    aria-label={audio("host.remove", { name: member.display_name })}
                    className="grid size-8 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground hover:text-destructive"
                  >
                    <UserX className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialogRef}
        aria-labelledby="remove-member-title"
        onClose={() => setPendingRemoval(null)}
        className="dark m-auto w-[min(92vw,26rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <form method="dialog" className="flex flex-col gap-5 p-6">
          <div>
            <h2 id="remove-member-title" className="font-heading text-xl font-extrabold">
              {audio("host.removeTitle", { name: pendingRemoval?.display_name ?? "" })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{audio("host.removeBody")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="submit"
              size="md"
              variant="danger"
              onClick={() => pendingRemoval && onRemove(pendingRemoval.user_id)}
            >
              {audio("host.removeConfirm")}
            </Button>
            <Button type="submit" size="md" variant="secondary">
              {audio("host.cancel")}
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
