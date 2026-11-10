import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./section-heading";

export async function Problem() {
  const t = await getTranslations("Problem");
  const points = ["audio", "requests", "calm"] as const;

  return (
    <section className="light bg-surface-warm text-foreground">
      <Container className="grid gap-12 py-24 md:grid-cols-12 md:py-32">
        <div className="md:col-span-7">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
          <p className="reveal mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">{t("body")}</p>
        </div>

        <aside className="dark reveal rounded-[2rem] bg-brand-navy-900 p-8 text-foreground shadow-xl md:col-span-5 md:mt-28 md:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-brand-cyan">{t("solutionEyebrow")}</p>
          <h3 className="mt-4 font-heading text-3xl font-extrabold leading-tight">{t("solutionTitle")}</h3>
          <p className="mt-4 leading-relaxed text-muted-foreground">{t("solutionBody")}</p>
          <ul className="mt-6 space-y-3">
            {points.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <Check className="mt-0.5 size-5 shrink-0 text-brand-cyan" aria-hidden="true" />
                <span>{t(`points.${key}`)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </Container>
    </section>
  );
}
