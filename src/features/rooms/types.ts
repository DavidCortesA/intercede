import type { Tables } from "@/types/database";

export type Room = Tables<"rooms">;
export type RoomMember = Tables<"room_members">;
export type PrayerRequest = Tables<"prayer_requests">;
