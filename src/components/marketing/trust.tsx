import { ArrowRight, EyeOff, HeartHandshake, Lock, Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Container, SectionHeading } from "./section-heading";

const ITEMS = [
  { key: "noRecording", icon: EyeOff },
  { key: "privateDefault", icon: Lock },
  { key: "delete", icon: Trash2 },
  { key: "safe", icon: HeartHandshake },
] as const;

export async function Trust() {
  const t = await getTranslations("Trust");

  return (
    <section id="confianza" className="dark scroll-mt-4 bg-brand-navy-800 text-foreground">
      <Container className="py-24 md:py-32">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        <p className="reveal mt-6 max-w-xl text-lg text-muted-foreground">{t("body")}</p>

        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {ITEMS.map(({ key, icon: Icon }) => (
            <li key={key} className="reveal flex gap-5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-violet/25 text-brand-lavender">
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-extrabold">{t(`items.${key}.title`)}</h3>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{t(`items.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>

        <Link
          href="/privacidad"
          className="reveal mt-12 inline-flex items-center gap-2 font-heading font-bold text-primary-text underline-offset-4 hover:underline"
        >
          {t("link")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Container>
    </section>
  );
}
