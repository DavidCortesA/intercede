"use client";

import { LogOut, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PrayerRequest, Room, RoomMember } from "@/features/rooms/types";
import { useRoomLive } from "@/features/rooms/use-room-live";
import { Link, useRouter } from "@/i18n/navigation";
import { ConnectionBanner } from "./connection-banner";
import { HostControls } from "./host-controls";
import { Participants } from "./participants";
import { RequestComposer } from "./request-composer";
import { RequestList } from "./request-list";
import { ShareButton } from "./share-button";

interface Props {
  room: Room;
  meId: string;
  members: RoomMember[];
  requests: PrayerRequest[];
}

/**
 * Sala de oración (Fase 3, sin audio): quién está, peticiones en vivo y controles del anfitrión.
 * Pantalla completa, oscura y sobria (CLAUDE.md §8.7). El audio con LiveKit llega en la Fase 4.
 */
export function RoomScreen(props: Props) {
  const t = useTranslations("Room");
  const router = useRouter();
  const { room, members, requests, connection, online, error, actions } = useRoomLive({
    room: props.room,
    members: props.members,
    requests: props.requests,
  });

  const meId = props.meId;
  const isHost = room.host_id === meId;
  const presentCount = members.filter((m) => m.left_at === null).length;

  if (room.status === "closed") {
    return (
      <main id="contenido" className="dark flex min-h-dvh flex-col items-center justify-center gap-6 bg-brand-dusk px-6 text-center text-foreground">
        <Wordmark className="h-8" />
        <h1 className="font-heading text-3xl font-extrabold">{t("states.closedLive.title")}</h1>
        <p className="max-w-sm text-lg text-brand-cream/85">{t("states.closedLive.body")}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/orar" className={buttonVariants({ size: "md" })}>
            {t("states.newRoom")}
          </Link>
          <Link href="/" className={buttonVariants({ variant: "secondary", size: "md" })}>
            {t("states.home")}
          </Link>
        </div>
      </main>
    );
  }

  async function leave() {
    if (await actions.leave()) router.push("/");
  }

  return (
    <div className="dark flex h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate font-heading text-lg font-extrabold">{room.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton roomName={room.name} />
            <Button variant="secondary" size="sm" onClick={leave} aria-label={t("header.leave")}>
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("header.leave")}</span>
            </Button>
          </div>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${connection === "live" ? "bg-[#16c47f] shadow-[0_0_0_3px_rgba(22,196,127,0.2)]" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          <span>{t("header.live")}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden="true" />
            {t("header.participants", { count: presentCount })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("header.code")}:{" "}
            <span className="font-mono font-bold uppercase tracking-wider text-foreground">{room.code}</span>
          </span>
        </p>
      </header>

      <ConnectionBanner online={online} connection={connection} />

      <main id="contenido" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <Participants members={members} meId={meId} />
        {isHost ? <HostControls isLocked={room.is_locked} onSetLocked={actions.setLocked} onClose={actions.closeRoom} /> : null}

        <section aria-labelledby="requests-title" className="flex flex-col gap-3">
          <h2 id="requests-title" className="font-heading text-base font-bold">
            {t("requests.title")}
          </h2>
          <RequestList
            requests={requests}
            members={members}
            meId={meId}
            isHost={isHost}
            onSetAnswered={actions.setAnswered}
            onRemove={actions.removeRequest}
          />
        </section>
      </main>

      <footer className="border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto w-full max-w-2xl">
          {error ? (
            <p role="alert" className="mb-2 rounded-xl bg-destructive/15 px-4 py-2 text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <RequestComposer onSubmit={actions.postRequest} />
        </div>
      </footer>
    </div>
  );
}
