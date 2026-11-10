import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { Container } from "./section-heading";

export async function FinalCta() {
  const t = await getTranslations("FinalCta");

  return (
    <section className="bg-brand-gradient text-white">
      <Container className="flex flex-col items-start gap-8 py-20 md:flex-row md:items-center md:justify-between md:py-24">
        <div className="reveal max-w-2xl">
          <h2 className="font-heading text-[clamp(2rem,4.5vw,3.5rem)] font-extrabold leading-[1.05] text-balance">
            {t("title")}
          </h2>
          <p className="mt-4 text-lg text-white/90">{t("body")}</p>
        </div>
        <Link href="/orar" className={buttonVariants({ variant: "light", size: "lg" })}>
          {t("cta")}
        </Link>
      </Container>
    </section>
  );
}
