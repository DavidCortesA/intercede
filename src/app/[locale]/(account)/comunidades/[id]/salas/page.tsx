import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CommunityRooms, type CommunityScheduleItem } from "@/components/communities/community-rooms";
import { getCommunityContext } from "@/features/communities/queries";
import { todayIn } from "@/features/devotionals/dates";
import { getCurrentSession } from "@/features/auth/queries";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/salas">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/salas`, title: t("communityTitle"), description: t("description"), noindex: true });
}

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export default async function CommunityRoomsPage({ params }: PageProps<"/[locale]/comunidades/[id]/salas">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  const session = await getCurrentSession();

  const supabase = await createClient();
  // RLS: las personas de la comunidad ven sus salas abiertas y sus programaciones
  const [{ data: rooms }, { data: schedules }, { data: mySubs }] = await Promise.all([
    supabase.from("rooms").select("id, code, name").eq("community_id", id).eq("status", "open").order("created_at", { ascending: false }),
    supabase
      .from("room_schedules")
      .select("id, owner_id, name, timezone, recurrence, local_time, start_date, weekdays, reminder_minutes, is_active, next_occurrence_at, last_room_id, created_at")
      .eq("community_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("schedule_subscriptions").select("schedule_id").eq("user_id", ctx.userId),
  ]);

  const rows = schedules ?? [];
  const ids = rows.map((row) => row.id);
  const { data: subs } = ids.length ? await supabase.from("schedule_subscriptions").select("schedule_id, user_id").in("schedule_id", ids) : { data: [] };
  const followers = new Map<string, number>();
  const ownerOf = new Map(rows.map((row) => [row.id, row.owner_id]));
  for (const sub of subs ?? []) {
    if (sub.user_id === ownerOf.get(sub.schedule_id)) continue;
    followers.set(sub.schedule_id, (followers.get(sub.schedule_id) ?? 0) + 1);
  }
  const followed = new Set((mySubs ?? []).map((sub) => sub.schedule_id));
  const openByRoomId = new Map((rooms ?? []).map((room) => [room.id, room.code]));

  const items: CommunityScheduleItem[] = rows.map((row) => ({
    schedule: {
      id: row.id,
      owner_id: row.owner_id,
      name: row.name,
      timezone: row.timezone,
      recurrence: row.recurrence,
      local_time: row.local_time,
      start_date: row.start_date,
      weekdays: row.weekdays,
      reminder_minutes: row.reminder_minutes,
      is_active: row.is_active,
      next_occurrence_at: row.next_occurrence_at,
      last_room_id: row.last_room_id,
      inviteToken: null,
      followers: followers.get(row.id) ?? 0,
      openRoomCode: row.last_room_id ? (openByRoomId.get(row.last_room_id) ?? null) : null,
    },
    canManage: row.owner_id === ctx.userId || ctx.isAdmin,
    following: followed.has(row.id),
  }));

  return (
    <CommunityRooms
      communityId={id}
      isLeader={ctx.isLeader}
      openRooms={rooms ?? []}
      schedules={items}
      suggestedName={session?.profile?.display_name ?? ""}
      timezones={timeZones()}
      defaultTimezone={ctx.timezone}
      today={todayIn(ctx.timezone)}
    />
  );
}
