"use client";

import { LogOut, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button, buttonVariants } from "@/components/ui/button";
import { sendHostCommand, type HostCommand } from "@/features/audio/api";
import { BreakoutBanner } from "@/components/breakouts/breakout-banner";
import { BrandScope, PoweredBy } from "@/components/brand/brand-scope";
import type { CommunityBrand } from "@/features/brand/queries";
import { BreakoutHost } from "@/components/breakouts/breakout-host";
import { useLiveAudio } from "@/features/audio/use-live-audio";
import { activeGroupId } from "@/features/breakouts/logic";
import { useBreakout } from "@/features/breakouts/use-breakout";
import { useServerNow } from "@/features/breakouts/use-server-now";
import { useWakeLock } from "@/features/audio/use-wake-lock";
import type { PrayerRequest, PrayerSupport, Room, RoomMember } from "@/features/rooms/types";
import { useRoomLive } from "@/features/rooms/use-room-live";
import { Link, useRouter } from "@/i18n/navigation";
import { ActiveSpeaker } from "./active-speaker";
import { AudioPanel } from "./audio-panel";
import { ConnectionBanner } from "./connection-banner";
import { ModerationMenu } from "@/components/moderation/moderation-menu";
import { GuidePanel } from "@/components/guides/guide-panel";
import { HostControls } from "./host-controls";
import { RoomLimit } from "./room-limit";
import { Participants } from "./participants";
import { RequestComposer } from "./request-composer";
import { RequestList } from "./request-list";
import { ShareButton } from "./share-button";

interface Props {
  room: Room;
  meId: string;
  isAnonymous: boolean;
  members: RoomMember[];
  requests: PrayerRequest[];
  support: PrayerSupport[];
  /** Marca de la comunidad (plan Pro), si la sala es de una comunidad que la tiene. */
  brand?: CommunityBrand | null;
}

/** Pantalla final cuando la sala se cerró o el anfitrión sacó a la persona. */
function EndedScreen({ kind }: { kind: "closedLive" | "removed" }) {
  const t = useTranslations("Room.states");
  return (
    <main id="contenido" className="dark flex min-h-dvh flex-col items-center justify-center gap-6 bg-brand-dusk px-6 text-center text-foreground">
      <Wordmark className="h-8" />
      <h1 className="font-heading text-3xl font-extrabold">{t(`${kind}.title`)}</h1>
      <p className="max-w-sm text-lg text-brand-cream/85">{t(`${kind}.body`)}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/orar" className={buttonVariants({ size: "md" })}>
          {t("newRoom")}
        </Link>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {t("home")}
        </Link>
      </div>
    </main>
  );
}

/**
 * Sala de oración: audio en vivo (LiveKit), quién habla, participantes, peticiones en vivo y
 * controles del anfitrión. Pantalla completa, oscura y sobria (CLAUDE.md §8.7).
 */
export function RoomScreen(props: Props) {
  const t = useTranslations("Room");
  const audioText = useTranslations("Audio");
  const brandText = useTranslations("Brand");
  const moderation = useTranslations("Moderation");
  const router = useRouter();
  const { room, members, requests, support, connection, online, error, actions } = useRoomLive({
    room: props.room,
    members: props.members,
    requests: props.requests,
    support: props.support,
  });
  const breakoutState = useBreakout(props.room.id);
  const serverNowMs = useServerNow();
  const [visitedGroup, setVisitedGroup] = useState<string | null>(null);
  const myGroup = breakoutState.assignments.find((assignment) => assignment.user_id === props.meId)?.group_id ?? null;
  // La anfitriona visita un grupo mientras el reparto siga activo; el resto vuelve sola a la sala principal al terminar el tiempo
  const visiting = breakoutState.breakout?.status === "active" ? visitedGroup : null;
  const audioGroup = visiting ?? activeGroupId(breakoutState.breakout, myGroup, serverNowMs);
  const audio = useLiveAudio(props.room.id, audioGroup);
  const [hostError, setHostError] = useState(false);

  const meId = props.meId;
  const isHost = room.host_id === meId;
  const presentCount = members.filter((m) => m.left_at === null).length;
  const groupMates = audioGroup ? new Set(breakoutState.assignments.filter((assignment) => assignment.group_id === audioGroup).map((assignment) => assignment.user_id)) : null;
  const roomMembers = groupMates ? members.filter((m) => groupMates.has(m.user_id) || m.user_id === room.host_id) : members;
  const removed = Boolean(members.find((m) => m.user_id === meId)?.removed_at);
  const ended = room.status === "closed" || removed;

  // La pantalla se mantiene encendida durante la sala (Wake Lock) y el audio se corta al terminar
  useWakeLock(!ended);
  const { leave: leaveAudio } = audio;
  useEffect(() => {
    if (ended) void leaveAudio();
  }, [ended, leaveAudio]);

  if (ended) return <EndedScreen kind={removed ? "removed" : "closedLive"} />;

  async function leave() {
    await audio.leave();
    if (await actions.leave()) router.push("/");
  }

  async function hostCommand(command: HostCommand) {
    setHostError(false);
    const result = await sendHostCommand(command);
    // "No está conectada al audio" no es un error para quien modera
    if (!result.ok && result.error !== "participant_not_connected") setHostError(true);
  }

  const audioActive = audio.status === "connected" || audio.status === "reconnecting";

  return (
    <BrandScope accent={props.brand?.accent ?? null} mode="dark" className="dark flex h-dvh flex-col bg-background text-foreground">
      {props.brand ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2" style={{ boxShadow: "inset 0 -3px 0 var(--brand-accent)" }}>
          {props.brand.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- el logo ya viene optimizado (WebP cuadrado) desde nuestro almacenamiento
            <img src={props.brand.logo_url} alt="" className="size-6 rounded-md object-cover" />
          ) : null}
          <p className="min-w-0 truncate text-sm font-bold" data-testid="room-brand-name">
            {props.brand.name}
          </p>
        </div>
      ) : null}
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

      <RoomLimit room={room} isHost={isHost} isAnonymous={props.isAnonymous} />
      <BreakoutBanner state={breakoutState} meId={meId} isHost={isHost} members={members} requests={requests} serverNowMs={serverNowMs} />
      <ConnectionBanner online={online} connection={connection} />

      <main id="contenido" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <AudioPanel audio={audio} />
        {audioActive ? <ActiveSpeaker presence={audio.presence} members={roomMembers} meId={meId} /> : null}

        <GuidePanel roomId={room.id} isHost={isHost} />

        <Participants
          members={roomMembers}
          meId={meId}
          presence={audio.presence}
          audioActive={audioActive}
          isHost={isHost}
          onMute={(userId) => void hostCommand({ action: "mute", roomId: room.id, identity: userId })}
          onRemove={(userId) => void hostCommand({ action: "remove", roomId: room.id, identity: userId })}
        />

        {isHost ? null : <ModerationMenu className="self-start" target={{ type: "room", id: room.id }} label={moderation("room.report")} />}

        {isHost ? (
          <>
          <BreakoutHost
            roomId={room.id}
            communityId={room.community_id}
            hostId={room.host_id}
            members={members}
            requests={requests}
            state={breakoutState}
            serverNowMs={serverNowMs}
            visitGroupId={visiting}
            onVisit={setVisitedGroup}
            audioConnected={audioActive}
          />
          <HostControls
            isLocked={room.is_locked}
            onSetLocked={actions.setLocked}
            onClose={actions.closeRoom}
            onMuteAll={() => void hostCommand({ action: "mute_all", roomId: room.id })}
            roomId={room.id}
            roomCode={room.code}
          />
          </>
        ) : null}
        {hostError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {audioText("errors.host_action")}
          </p>
        ) : null}

        <section aria-labelledby="requests-title" className="flex flex-col gap-3">
          <h2 id="requests-title" className="font-heading text-base font-bold">
            {t("requests.title")}
          </h2>
          <RequestList
            requests={requests}
            members={members}
            meId={meId}
            isHost={isHost}
            support={support}
            canSaveToJournal={!props.isAnonymous}
            onSetAnswered={actions.setAnswered}
            onRemove={actions.removeRequest}
            onToggleSupport={(requestId, on) => actions.toggleSupport(requestId, meId, on)}
            onSaveToJournal={actions.saveToJournal}
            focusId={room.focus_request_id}
            onSetFocus={isHost ? actions.setFocus : null}
          />
        </section>
      </main>

      <footer className="border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto w-full max-w-2xl">
          {error ? (
            <p role="alert" className="mb-2 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <RequestComposer onSubmit={actions.postRequest} />
          {props.brand ? <PoweredBy label={brandText("poweredBy")} className="mt-2" /> : null}
        </div>
      </footer>
    </BrandScope>
  );
}
