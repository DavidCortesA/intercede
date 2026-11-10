import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { SchedulesScreen } from "@/components/schedules/schedules-screen";
import { todayIn } from "@/features/devotionals/dates";
import type { ScheduleView } from "@/features/schedules/types";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/programadas">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/programadas", title: t("schedulesTitle"), description: t("description"), noindex: true });
}

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export default async function SchedulesPage({ params }: PageProps<"/[locale]/programadas">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/programadas");
  if (session.isAnonymous) return <GuestInvite kind="schedules" />;

  const supabase = await createClient();

  // RLS: solo las que la persona creó o sigue
  const { data: schedules } = await supabase
    .from("room_schedules")
    .select(
      "id, owner_id, name, timezone, recurrence, local_time, start_date, weekdays, reminder_minutes, is_active, next_occurrence_at, last_room_id, created_at, community_id",
    )
    .order("created_at", { ascending: false });
  // La base también deja ver las programaciones de tus comunidades; aquí solo las que sigues (o creaste, si no son de
  // una comunidad: esas se administran dentro de la comunidad)
  const { data: mySubs } = await supabase.from("schedule_subscriptions").select("schedule_id").eq("user_id", session.userId);
  const followed = new Set((mySubs ?? []).map((sub) => sub.schedule_id));
  const rows = (schedules ?? []).filter((row) => (row.owner_id === session.userId ? row.community_id === null : followed.has(row.id)));
  const ids = rows.map((row) => row.id);
  const roomIds = rows.flatMap((row) => (row.last_room_id ? [row.last_room_id] : []));

  const [{ data: invites }, { data: subscriptions }, { data: rooms }] = await Promise.all([
    ids.length ? supabase.from("schedule_invites").select("schedule_id, token").in("schedule_id", ids) : { data: [] },
    ids.length ? supabase.from("schedule_subscriptions").select("schedule_id, user_id").in("schedule_id", ids) : { data: [] },
    roomIds.length ? supabase.from("rooms").select("id, code, status").in("id", roomIds) : { data: [] },
  ]);

  const tokenOf = new Map((invites ?? []).map((invite) => [invite.schedule_id, invite.token]));
  const followersOf = new Map<string, number>();
  const ownerOf = new Map(rows.map((row) => [row.id, row.owner_id]));
  for (const subscription of subscriptions ?? []) {
    // Quien la creó siempre está suscrito: no cuenta como "seguidor"
    if (subscription.user_id === ownerOf.get(subscription.schedule_id)) continue;
    followersOf.set(subscription.schedule_id, (followersOf.get(subscription.schedule_id) ?? 0) + 1);
  }
  const openRoom = new Map((rooms ?? []).filter((room) => room.status === "open").map((room) => [room.id, room.code]));

  const views: ScheduleView[] = rows.map((row) => ({
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
    inviteToken: tokenOf.get(row.id) ?? null,
    followers: followersOf.get(row.id) ?? 0,
    openRoomCode: row.last_room_id ? (openRoom.get(row.last_room_id) ?? null) : null,
  }));

  const timezone = session.profile?.timezone ?? "UTC";
  return (
    <SchedulesScreen
      mine={views.filter((view) => view.owner_id === session.userId)}
      following={views.filter((view) => view.owner_id !== session.userId)}
      timezones={timeZones()}
      defaultTimezone={timezone}
      today={todayIn(timezone)}
    />
  );
}
