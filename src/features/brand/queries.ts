import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { HEX_PATTERN } from "./contrast";

const brandSchema = z.object({
  name: z.string(),
  accent: z.string().regex(HEX_PATTERN),
  logo_url: z.string().nullable(),
});
export type CommunityBrand = z.infer<typeof brandSchema>;

/**
 * La marca que SE APLICA hoy en una comunidad (nombre visible, color de acento y logo), o null si no tiene marca o su plan ya no es
 * Pro. La lee quien es de la comunidad (la base lo decide) y el color ya pasó la regla de contraste al guardarse.
 */
export async function getCommunityBrand(communityId: string): Promise<CommunityBrand | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_brand", { p_community_id: communityId });
  if (error || !data) return null;
  const parsed = brandSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
