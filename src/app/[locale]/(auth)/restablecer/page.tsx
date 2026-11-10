import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PasswordForm } from "@/components/account/password-form";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/features/auth/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/restablecer">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/restablecer", title: t("resetTitle"), description: t("description"), noindex: true });
}

// A esta pantalla se llega desde el enlace del correo (/auth/confirm ya abrió la sesión de recuperación).
export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/restablecer">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const session = await getCurrentSession();

  if (!session || session.isAnonymous) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-heading text-3xl font-extrabold">{t("reset.expiredTitle")}</h1>
        <p className="leading-relaxed text-muted-foreground">{t("reset.expiredBody")}</p>
        <Link href="/recuperar" className={buttonVariants({ size: "md" })}>
          {t("reset.request")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-heading text-3xl font-extrabold">{t("reset.title")}</h1>
      <div className="mt-6">
        <PasswordForm variant="reset" />
      </div>
    </>
  );
}
