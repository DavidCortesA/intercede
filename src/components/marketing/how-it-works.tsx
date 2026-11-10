import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./section-heading";

const STEPS = ["create", "invite", "pray"] as const;
// Escalonado vertical: rompe la rejilla de tres columnas iguales
const OFFSETS = ["md:mt-0", "md:mt-14", "md:mt-28"];

export async function HowItWorks() {
  const t = await getTranslations("How");

  return (
    <section id="como-funciona" className="light scroll-mt-4 bg-background text-foreground">
      <Container className="py-24 md:py-32">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <li key={step} className={`reveal relative ${OFFSETS[i]}`}>
              {/* Numeral decorativo como contenido generado (CSS): no es texto para lectores de pantalla
                  ni se evalúa como texto de contraste. */}
              <span
                aria-hidden="true"
                data-n={`0${i + 1}`}
                className="block h-[6.5rem] font-heading text-[7.5rem] font-extrabold leading-none text-brand-violet-100 select-none before:content-[attr(data-n)]"
              />
              <h3 className="-mt-6 font-heading text-2xl font-extrabold">{t(`steps.${step}.title`)}</h3>
              <p className="mt-3 max-w-xs leading-relaxed text-muted-foreground">{t(`steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
