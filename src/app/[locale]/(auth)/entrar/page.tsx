import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GoogleButton } from "@/components/account/google-button";
import { SignInForm } from "@/components/account/sign-in-form";
import { getCurrentSession } from "@/features/auth/queries";
import { safeNextPath } from "@/features/auth/errors";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/entrar">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/entrar", title: t("signInTitle"), description: t("description"), noindex: true });
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/entrar">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("Auth");
  const session = await getCurrentSession();
  const linkError = query.error === "link";
  const next = safeNextPath(typeof query.next === "string" ? query.next : null, "/orar");

  return (
    <>
      <h1 className="font-heading text-3xl font-extrabold">{t("signIn.title")}</h1>
      {linkError ? (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/15 px-4 py-3 text-sm text-destructive">
          {t("linkError")}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">
        <GoogleButton />
        <SignInForm next={next} showGuestWarning={Boolean(session?.isAnonymous)} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("signIn.noAccount")}{" "}
        <Link href="/registro" className="font-bold text-primary-text underline-offset-4 hover:underline">
          {t("signIn.createAccount")}
        </Link>
      </p>
      <p className="mt-3 text-center text-sm">
        <Link href="/orar" className="font-semibold text-muted-foreground underline-offset-4 hover:underline">
          {t("signIn.asGuest")}
        </Link>
      </p>
    </>
  );
}
