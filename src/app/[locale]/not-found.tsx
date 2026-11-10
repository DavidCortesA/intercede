import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("NotFound");

  return (
    <main id="contenido" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <Link
        href="/"
        className="bg-brand-gradient rounded-full px-6 py-3 font-heading font-bold text-primary-foreground"
      >
        {t("home")}
      </Link>
    </main>
  );
}
