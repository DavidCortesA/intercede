"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * Error inesperado en una pantalla: se avisa a Sentry (sin datos personales) y se ofrece reintentar. Para
 * quien está orando, lo importante es poder volver: la sala se recupera con el mismo enlace.
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("ErrorPage");

  useEffect(() => {
    // Se carga solo si hay un error: el SDK no pesa en la carga normal de las páginas
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <h1 className="font-heading text-3xl font-extrabold text-balance">{t("title")}</h1>
      <p className="leading-relaxed text-muted-foreground">{t("body")}</p>
      <div className="flex flex-wrap gap-3">
        <Button size="md" onClick={reset}>
          {t("retry")}
        </Button>
        <Link href="/" className={buttonVariants({ size: "md", variant: "secondary" })}>
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
