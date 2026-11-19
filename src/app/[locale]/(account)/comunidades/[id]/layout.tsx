import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CommunityLogo } from "@/components/communities/community-logo";
import { CommunityNav } from "@/components/communities/community-nav";
import { BrandScope, PoweredBy } from "@/components/brand/brand-scope";
import { getCommunityBrand } from "@/features/brand/queries";
import { getCommunityContext } from "@/features/communities/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";

/** Cabecera común de una comunidad (logo, nombre, tu rol) y sus secciones. Solo para miembros (404 si no). */
export default async function CommunityLayout({ children, params }: LayoutProps<"/[locale]/comunidades/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireSession(locale, `/comunidades/${id}`);
  const [ctx, t, brand, brandText] = await Promise.all([getCommunityContext(id), getTranslations("Communities"), getCommunityBrand(id), getTranslations("Brand")]);
  const { community } = ctx;

  return (
    <BrandScope accent={brand?.accent ?? null} mode="light" className="flex flex-col gap-5">
      <Link href="/comunidades" className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:underline">
        ← {t("nav.back")}
      </Link>
      <header className="flex items-center gap-4">
        <CommunityLogo id={community.id} name={community.name} src={community.logo_url} />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-2xl font-extrabold">{brand?.name ?? community.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t(`kinds.${community.kind as "church" | "ministry" | "group"}`)} · {t(`roles.${ctx.role}`)}
          </p>
        </div>
      </header>
      {community.description ? <p className="text-muted-foreground">{community.description}</p> : null}
      <CommunityNav communityId={community.id} isAdmin={ctx.isAdmin} isLeader={ctx.isLeader} />
      <div>{children}</div>
      {brand ? <PoweredBy label={brandText("poweredBy")} className="pt-4" /> : null}
    </BrandScope>
  );
}
