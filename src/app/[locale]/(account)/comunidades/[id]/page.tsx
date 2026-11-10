import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WallScreen } from "@/components/communities/wall-screen";
import { getCommunityContext } from "@/features/communities/queries";
import type { WallAuthor } from "@/features/communities/wall";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}`, title: t("communityTitle"), description: t("description"), noindex: true });
}

/** Muro de oración: la sección principal de la comunidad. */
export default async function CommunityWallPage({ params }: PageProps<"/[locale]/comunidades/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);

  const supabase = await createClient();
  // RLS: cada persona solo recibe las peticiones que puede ver (las del liderazgo, solo si lo es o las escribió)
  const { data: requests } = await supabase
    .from("community_requests")
    .select("id, author_id, content, visibility, is_answered, testimony, created_at")
    .eq("community_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  const list = requests ?? [];
  const ids = list.map((r) => r.id);

  const [{ data: support }, { data: members }] = await Promise.all([
    ids.length ? supabase.from("community_request_support").select("request_id, user_id").in("request_id", ids) : { data: [] },
    supabase.from("community_members").select("user_id, display_name, avatar_url").eq("community_id", id),
  ]);
  const authors: Record<string, WallAuthor> = Object.fromEntries((members ?? []).map((m) => [m.user_id, { display_name: m.display_name, avatar_url: m.avatar_url }]));

  return (
    <WallScreen communityId={id} meId={ctx.userId} isLeader={ctx.isLeader} initialRequests={list} initialSupport={support ?? []} authors={authors} />
  );
}
