import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuestInvite } from "@/components/account/guest-invite";
import { CommunityForms } from "@/components/communities/community-forms";
import { CommunityLogo } from "@/components/communities/community-logo";
import type { CommunityKind, CommunityRole } from "@/features/communities/schemas";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/comunidades", title: t("communitiesTitle"), description: t("description"), noindex: true });
}

export default async function CommunitiesPage({ params }: PageProps<"/[locale]/comunidades">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/comunidades");
  if (session.isAnonymous) return <GuestInvite kind="communities" />;

  const t = await getTranslations("Communities");
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("community_members")
    .select("role, joined_at, communities(id, name, kind, logo_url)")
    .eq("user_id", session.userId)
    .order("joined_at", { ascending: false });
  const mine = (memberships ?? []).flatMap((row) => (row.communities ? [{ ...row.communities, role: row.role as CommunityRole }] : []));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-6 text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((community) => (
            <li key={community.id}>
              <Link
                href={`/comunidades/${community.id}`}
                className="flex items-center gap-4 rounded-3xl bg-background p-4 shadow-sm ring-1 ring-border transition-colors hover:ring-ring"
              >
                <CommunityLogo id={community.id} name={community.name} src={community.logo_url} />
                <span className="min-w-0">
                  <span className="block truncate font-heading font-bold">{community.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`kinds.${community.kind as CommunityKind}`)} · {t(`roles.${community.role}`)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CommunityForms />
    </div>
  );
}
