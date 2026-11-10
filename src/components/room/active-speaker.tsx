"use client";

import { useTranslations } from "next-intl";
import type { Presence } from "@/features/audio/use-live-audio";
import type { RoomMember } from "@/features/rooms/types";
import { Avatar } from "./avatar";

/**
 * Orador activo: quien está hablando ahora, grande y con el anillo pulsante de la pantalla 3
 * del diseño. Si hablan varias personas a la vez se muestra la primera (la más reciente en
 * LiveKit). Sin audio conectado no se muestra.
 */
export function ActiveSpeaker({
  presence,
  members,
  meId,
}: {
  presence: ReadonlyMap<string, Presence>;
  members: RoomMember[];
  meId: string;
}) {
  const t = useTranslations("Audio.speaker");
  const speakerId = [...presence].find(([, state]) => state.speaking)?.[0];
  const speaker = speakerId ? members.find((m) => m.user_id === speakerId) : undefined;

  return (
    <div aria-live="polite" className="flex min-h-36 flex-col items-center justify-center text-center">
      {speaker ? (
        <>
          <div className="relative grid size-28 place-items-center">
            <span aria-hidden="true" className="absolute inset-0 animate-[ring-pulse_2.4s_infinite] rounded-full border-2 border-brand-violet-400/70" />
            <span aria-hidden="true" className="absolute inset-0 animate-[ring-pulse_2.4s_1.2s_infinite] rounded-full border-2 border-brand-violet-400/70" />
            <Avatar userId={speaker.user_id} name={speaker.display_name} className="size-20 text-2xl" />
          </div>
          <p className="mt-2 font-heading text-base font-bold">{speaker.user_id === meId ? t("you") : speaker.display_name}</p>
          {speaker.user_id === meId ? null : (
            <p className="mt-0.5 flex items-center gap-2 text-xs text-brand-cyan">
              <span aria-hidden="true" className="flex h-3 items-end gap-0.5">
                {[0.4, 1, 0.65].map((height, index) => (
                  <i
                    key={index}
                    className="w-[3px] origin-bottom animate-[eq_1s_infinite_ease-in-out] rounded-sm bg-brand-cyan"
                    style={{ height: `${height * 12}px`, animationDelay: `${index * 0.2}s` }}
                  />
                ))}
              </span>
              {t("speaking")}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("nobody")}</p>
      )}
    </div>
  );
}
