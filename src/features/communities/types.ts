import type { Tables } from "@/types/database";
import type { CommunityRole } from "./schemas";

export type Community = Tables<"communities">;
export type CommunityMember = Pick<Tables<"community_members">, "user_id" | "role" | "display_name" | "avatar_url" | "joined_at">;

/** Una comunidad vista por quien la consulta: con su rol ahí. */
export interface CommunityContext {
  community: Community;
  role: CommunityRole;
  userId: string;
  timezone: string;
  isLeader: boolean;
  isAdmin: boolean;
}
