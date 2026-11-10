import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Invitación a crear cuenta para quien ora como invitado (diario, historial). */
export async function GuestInvite({ kind }: { kind: "journal" | "history" }) {
  const t = await getTranslations("GuestInvite");

  return (
    <section className="flex flex-col items-start gap-4 rounded-3xl bg-background p-7 shadow-sm ring-1 ring-border">
      <h1 className="font-heading text-2xl font-extrabold text-balance">{t(`${kind}.title`)}</h1>
      <p className="leading-relaxed text-muted-foreground">{t(`${kind}.body`)}</p>
      <Link href="/registro" className={buttonVariants({ size: "md" })}>
        {t("cta")}
      </Link>
    </section>
  );
}
