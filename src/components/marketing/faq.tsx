import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { FAQ_KEYS } from "@/config/faq";
import { Container, SectionHeading } from "./section-heading";

export async function Faq() {
  const t = await getTranslations("Faq");

  return (
    <section id="preguntas" className="light scroll-mt-4 bg-surface-warm text-foreground">
      <Container className="grid gap-12 py-24 md:grid-cols-12 md:py-32">
        <div className="md:col-span-4">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        </div>
        <div className="md:col-span-8">
          {FAQ_KEYS.map((key) => (
            <details key={key} className="group reveal border-b border-border py-5 first:border-t">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-heading text-lg font-bold [&::-webkit-details-marker]:hidden">
                {t(`items.${key}.q`)}
                <Plus
                  className="size-5 shrink-0 text-primary-text transition-transform duration-200 group-open:rotate-45"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{t(`items.${key}.a`)}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
