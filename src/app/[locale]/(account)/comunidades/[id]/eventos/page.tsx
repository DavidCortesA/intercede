import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { EventsScreen } from "@/components/events/events-screen";
import { getCommunityContext } from "@/features/communities/queries";
import { todayIn } from "@/features/devotionals/dates";
import type { EventView, RsvpStatus } from "@/features/events/types";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/eventos">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/eventos`, title: t("communityTitle"), description: t("description"), noindex: true });
}

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export default async function CommunityEventsPage({ params }: PageProps<"/[locale]/comunidades/[id]/eventos">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);

  const supabase = await createClient();
  const columns = "id, title, description, starts_at, ends_at, timezone, opens_room, room_id, reminder_minutes";
  const nowIso = new Date().toISOString();
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase.from("events").select(columns).eq("community_id", id).gt("ends_at", nowIso).order("starts_at"),
    supabase.from("events").select(columns).eq("community_id", id).lte("ends_at", nowIso).order("starts_at", { ascending: false }).limit(10),
  ]);
  const events = [...(upcoming ?? []), ...(past ?? [])];
  const eventIds = events.map((event) => event.id);
  const roomIds = events.flatMap((event) => (event.room_id ? [event.room_id] : []));

  const [{ data: rsvps }, { data: rooms }] = await Promise.all([
    eventIds.length ? supabase.from("event_rsvps").select("event_id, user_id, status").in("event_id", eventIds) : { data: [] },
    roomIds.length ? supabase.from("rooms").select("id, code, status").in("id", roomIds) : { data: [] },
  ]);
  const openRoom = new Map((rooms ?? []).filter((room) => room.status === "open").map((room) => [room.id, room.code]));

  const view = (event: (typeof events)[number]): EventView => {
    const mine = (rsvps ?? []).filter((r) => r.event_id === event.id);
    return {
      ...event,
      going: mine.filter((r) => r.status === "going").length,
      maybe: mine.filter((r) => r.status === "maybe").length,
      myStatus: (mine.find((r) => r.user_id === ctx.userId)?.status as RsvpStatus | undefined) ?? null,
      roomCode: event.room_id ? (openRoom.get(event.room_id) ?? null) : null,
    };
  };

  return (
    <EventsScreen
      communityId={id}
      isLeader={ctx.isLeader}
      upcoming={(upcoming ?? []).map(view)}
      past={(past ?? []).map(view)}
      timezones={timeZones()}
      defaultTimezone={ctx.timezone}
      today={todayIn(ctx.timezone)}
    />
  );
}
