import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CommunityLogo } from "@/components/communities/community-logo";
import { JoinCommunityButton } from "@/components/communities/join-button";
import { RoomShell } from "@/components/room/room-shell";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/features/auth/queries";
import type { CommunityKind } from "@/features/communities/schemas";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

// El enlace es la llave de la invitación: nunca se indexa.
export async function generateMetadata({ params }: PageProps<"/[locale]/c/[token]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("communityInviteTitle"), robots: { index: false, follow: false } };
}

/**
 * Invitación a una comunidad. Cualquiera con el enlace ve de qué comunidad se trata (nombre, tipo, logo y
 * cuántas personas); para unirse hace falta una cuenta. Si ya es miembro, se le lleva a la comunidad.
 */
export default async function CommunityInvitePage({ params }: PageProps<"/[locale]/c/[token]">) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, communities] = await Promise.all([getTranslations("CommunityInvite"), getTranslations("Communities")]);

  const supabase = await createClient();
  const { data } = await supabase.rpc("peek_community", { p_token: token });
  const community = data?.[0];

  if (!community) {
    return (
      <RoomShell>
        <h1 className="font-heading text-3xl font-extrabold text-balance">{t("notFound.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("notFound.body")}</p>
        <Link href="/orar" className={buttonVariants({ size: "md" }) + " mt-8"}>
          {t("pray")}
        </Link>
      </RoomShell>
    );
  }

  const session = await getCurrentSession();
  const nextPath = encodeURIComponent(`/c/${token}`);

  return (
    <RoomShell>
      <p className="text-sm font-semibold tracking-widest text-brand-cyan uppercase">{t("title")}</p>
      <div className="mt-4 flex items-center gap-4">
        <CommunityLogo id={token} name={community.name} src={community.logo_url} />
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-extrabold text-balance">{community.name}</h1>
          <p className="text-sm text-muted-foreground">
            {communities(`kinds.${community.kind as CommunityKind}`)} · {t("members", { count: Number(community.members) })}
          </p>
        </div>
      </div>
      {community.description ? <p className="mt-4 text-muted-foreground">{community.description}</p> : null}

      <div className="mt-8">
        {session && !session.isAnonymous ? (
          <JoinCommunityButton token={token} />
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-muted-foreground">{t("needAccount")}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/registro?next=${nextPath}`} className={buttonVariants({ size: "md" })}>
                {t("createAccount")}
              </Link>
              <Link href={`/entrar?next=${nextPath}`} className={buttonVariants({ size: "md", variant: "secondary" })}>
                {t("signIn")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </RoomShell>
  );
}
