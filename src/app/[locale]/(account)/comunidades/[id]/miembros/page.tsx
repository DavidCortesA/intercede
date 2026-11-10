import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MembersScreen } from "@/components/communities/members-screen";
import { getCommunityContext } from "@/features/communities/queries";
import type { CommunityMember } from "@/features/communities/types";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/miembros">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/miembros`, title: t("communityTitle"), description: t("description"), noindex: true });
}

export default async function MembersPage({ params }: PageProps<"/[locale]/comunidades/[id]/miembros">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);

  const supabase = await createClient();
  const [{ data: members }, inviteToken] = await Promise.all([
    supabase.from("community_members").select("user_id, role, display_name, avatar_url, joined_at").eq("community_id", id).order("joined_at"),
    ctx.isLeader ? supabase.rpc("get_community_invite", { p_community_id: id }).then((res) => res.data) : Promise.resolve(null),
  ]);

  // Administración primero, luego liderazgo y miembros
  const order = { admin: 0, leader: 1, member: 2 } as const;
  const sorted: CommunityMember[] = [...(members ?? [])].sort((a, b) => order[a.role as keyof typeof order] - order[b.role as keyof typeof order]);

  return <MembersScreen communityId={id} meId={ctx.userId} role={ctx.role} members={sorted} inviteToken={inviteToken ?? null} />;
}
