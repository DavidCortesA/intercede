import type { Tables } from "@/types/database";

export type WallRequest = Pick<Tables<"community_requests">, "id" | "author_id" | "content" | "visibility" | "is_answered" | "testimony" | "created_at">;
export type WallSupport = Pick<Tables<"community_request_support">, "request_id" | "user_id">;
export type WallAuthor = { display_name: string; avatar_url: string | null };
