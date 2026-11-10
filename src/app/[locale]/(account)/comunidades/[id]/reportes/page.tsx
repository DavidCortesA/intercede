import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ReportsScreen, type ReportView } from "@/components/communities/reports-screen";
import { getCommunityContext } from "@/features/communities/queries";
import type { ReportReason, ReportTarget } from "@/features/moderation/schemas";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/reportes">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: `/comunidades/${id}/reportes`, title: t("communityTitle"), description: t("description"), noindex: true });
}

/** Reportes de la comunidad: solo administración y liderazgo (la base ya los filtra; aquí se evita una pantalla vacía). */
export default async function CommunityReportsPage({ params }: PageProps<"/[locale]/comunidades/[id]/reportes">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  if (!ctx.isLeader) notFound();

  const supabase = await createClient();
  // Nota: no se pide reporter_id. Quien reportó no se muestra a nadie de la comunidad.
  const { data: rows } = await supabase
    .from("reports")
    .select("id, target_type, target_id, target_user_id, reason, details, status, created_at")
    .eq("community_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  const reports = rows ?? [];

  const userIds = [...new Set(reports.flatMap((report) => (report.target_user_id ? [report.target_user_id] : [])))];
  const postIds = reports.filter((report) => report.target_type === "community_request").map((report) => report.target_id);
  const [{ data: members }, { data: posts }] = await Promise.all([
    userIds.length ? supabase.from("community_members").select("user_id, display_name").eq("community_id", id).in("user_id", userIds) : { data: [] },
    postIds.length ? supabase.from("community_requests").select("id, content").in("id", postIds) : { data: [] },
  ]);
  const names = new Map((members ?? []).map((member) => [member.user_id, member.display_name]));
  const contents = new Map((posts ?? []).map((post) => [post.id, post.content]));

  const views: ReportView[] = reports.map((report) => ({
    id: report.id,
    type: report.target_type as ReportTarget,
    targetId: report.target_id,
    reason: report.reason as ReportReason,
    details: report.details,
    status: report.status as ReportView["status"],
    createdAt: report.created_at,
    targetName: report.target_user_id ? (names.get(report.target_user_id) ?? null) : null,
    preview: contents.get(report.target_id) ?? null,
  }));

  return <ReportsScreen open={views.filter((view) => view.status === "open")} closed={views.filter((view) => view.status !== "open")} />;
}
