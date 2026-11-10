"use client";

import { DoorOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ScheduleCard } from "@/components/schedules/schedules-screen";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import type { ScheduleView } from "@/features/schedules/types";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export interface CommunityScheduleItem {
  schedule: ScheduleView;
  /** Puede pausarla o eliminarla: quien la creó o la administración de la comunidad. */
  canManage: boolean;
  following: boolean;
}

/**
 * Salas de la comunidad: las abiertas ahora, abrir una (liderazgo) y las programadas, que cualquier persona
 * de la comunidad puede seguir para recibir avisos. Quién puede abrir o programar lo decide la base de datos.
 */
export function CommunityRooms({
  communityId,
  isLeader,
  openRooms,
  schedules,
  suggestedName,
  timezones,
  defaultTimezone,
  today,
}: {
  communityId: string;
  isLeader: boolean;
  openRooms: { id: string; code: string; name: string }[];
  schedules: CommunityScheduleItem[];
  suggestedName: string;
  timezones: string[];
  defaultTimezone: string;
  today: string;
}) {
  const t = useTranslations("Communities.rooms");
  const errors = useTranslations("Communities.errors");
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(suggestedName);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  async function openRoom(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !displayName.trim()) return;
    setOpening(true);
    setError(null);
    const { data, error: failure } = await supabase.rpc("create_community_room", {
      p_community_id: communityId,
      p_name: name.trim(),
      p_display_name: displayName.trim(),
    });
    const room = data?.[0];
    if (failure || !room) {
      setOpening(false);
      return setError(toCommunityError(failure));
    }
    router.push(`/r/${room.room_code}`);
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="open-rooms-title" className="flex flex-col gap-3">
        <h2 id="open-rooms-title" className="font-heading text-lg font-extrabold">
          {t("open.title")}
        </h2>
        {openRooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("open.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openRooms.map((room) => (
              <li key={room.id} className="flex items-center gap-3 rounded-2xl bg-background p-3 shadow-sm ring-1 ring-border">
                <DoorOpen className="size-5 shrink-0 text-primary-text" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-heading font-bold">{room.name}</span>
                <Link href={`/r/${room.code}`} className={buttonVariants({ size: "sm" })}>
                  {t("open.join")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLeader ? (
        <form onSubmit={openRoom} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
          <h2 className="font-heading text-lg font-extrabold">{t("openNow.title")}</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="community-room-name" className="text-sm font-semibold">
              {t("openNow.name")}
            </label>
            <Input id="community-room-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("openNow.namePlaceholder")} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="community-room-display" className="text-sm font-semibold">
              {t("openNow.yourName")}
            </label>
            <Input id="community-room-display" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errors(error)}
            </p>
          ) : null}
          <Button type="submit" size="md" className="self-start" disabled={opening || !name.trim() || !displayName.trim()} aria-busy={opening}>
            {opening ? t("openNow.submitting") : t("openNow.submit")}
          </Button>
        </form>
      ) : null}

      <section aria-labelledby="community-schedules-title" className="flex flex-col gap-3">
        <h2 id="community-schedules-title" className="font-heading text-lg font-extrabold">
          {t("schedules.title")}
        </h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("schedules.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {schedules.map(({ schedule, canManage, following }) => (
              <li key={schedule.id}>
                <ScheduleCard schedule={schedule} isOwner={canManage} community={{ following }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLeader ? (
        <section aria-label={t("schedules.new")}>
          <ScheduleForm timezones={timezones} defaultTimezone={defaultTimezone} today={today} communityId={communityId} />
        </section>
      ) : null}
    </div>
  );
}
