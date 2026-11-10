"use client";

import { useTranslations } from "next-intl";
import type { RoomMember } from "@/features/rooms/types";
import { Avatar } from "./avatar";

/** Quiénes están ahora en la sala (miembros con left_at nulo). */
export function Participants({ members, meId }: { members: RoomMember[]; meId: string }) {
  const t = useTranslations("Room");
  const present = members
    .filter((m) => m.left_at === null)
    .sort((a, b) => Number(b.role === "host") - Number(a.role === "host") || a.joined_at.localeCompare(b.joined_at));

  return (
    <section aria-label={t("participants.title")}>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {present.map((member) => (
          <li key={member.user_id} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
            <Avatar userId={member.user_id} name={member.display_name} className="size-12" />
            <span className="w-full truncate text-xs font-semibold">
              {member.user_id === meId ? t("header.you") : member.display_name}
            </span>
            {member.role === "host" ? (
              <span className="text-[10px] uppercase tracking-wider text-brand-gold">{t("header.host")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
