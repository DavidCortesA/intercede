import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppTabs } from "@/components/account/app-tabs";
import { Wordmark } from "@/components/marketing/wordmark";
import { CreateRoomForm } from "@/components/room/create-room-form";
import { JoinByCodeForm } from "@/components/room/join-by-code-form";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/features/auth/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/orar">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({
    locale,
    path: "/orar",
    title: t("prayTitle"),
    description: t("prayDescription"),
    noindex: true,
  });
}

// Capa 1 (CLAUDE.md §1): orar sin cuenta. Un nombre y un toque crean la sala.
export default async function PrayPage({ params }: PageProps<"/[locale]/orar">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Pray");
  const session = await getCurrentSession();

  return (
    <>
      <main
        id="contenido"
        className="dark flex min-h-dvh flex-col items-center justify-center gap-8 bg-brand-dusk px-6 py-10 pb-28 text-foreground"
      >
        <Link href="/" className="rounded-lg">
          <Wordmark className="h-8" />
        </Link>

        <div className="w-full max-w-sm">
          <h1 className="text-center font-heading text-4xl font-extrabold text-balance">{t("title")}</h1>
          <p className="mt-3 text-center text-lg text-brand-cream/85">{t("subtitle")}</p>

          <div className="mt-8">
            <CreateRoomForm initialName={session?.profile?.display_name ?? ""} />
          </div>

          <section className="mt-10 border-t border-border pt-8" aria-labelledby="join-title">
            <h2 id="join-title" className="mb-4 text-center font-heading text-lg font-bold">
              {t("joinTitle")}
            </h2>
            <JoinByCodeForm />
          </section>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {t("back")}
            </Link>
            {session ? null : (
              <Link href="/entrar" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("signIn")}
              </Link>
            )}
          </div>
        </div>
      </main>
      {/* Quien ya tiene sesión ve su navegación (invitado: Orar y Perfil; con cuenta: también Diario y Salas) */}
      {session ? (
        <div className="dark">
          <AppTabs isGuest={session.isAnonymous} />
        </div>
      ) : null}
    </>
  );
}
