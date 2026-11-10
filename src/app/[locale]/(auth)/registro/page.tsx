import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GoogleButton } from "@/components/account/google-button";
import { SignUpForm } from "@/components/account/sign-up-form";
import { getCurrentSession } from "@/features/auth/queries";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/registro">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/registro", title: t("signUpTitle"), description: t("description"), noindex: true });
}

export default async function SignUpPage({ params }: PageProps<"/[locale]/registro">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const session = await getCurrentSession();

  // Ya tiene cuenta: no hay nada que crear
  if (session && !session.isAnonymous) redirect({ href: "/perfil", locale });
  const isGuest = Boolean(session?.isAnonymous);

  return (
    <>
      <h1 className="font-heading text-3xl font-extrabold text-balance">{isGuest ? t("signUp.titleGuest") : t("signUp.title")}</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">{t("signUp.subtitle")}</p>
      {isGuest ? (
        <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed">{t("signUp.guestNote")}</p>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">
        <GoogleButton />
        <SignUpForm isGuest={isGuest} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("signUp.haveAccount")}{" "}
        <Link href="/entrar" className="font-bold text-primary-text underline-offset-4 hover:underline">
          {t("signUp.signIn")}
        </Link>
      </p>
    </>
  );
}
