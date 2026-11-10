import { CalendarDays, Repeat, ShieldCheck, UsersRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./section-heading";

const POINTS = [
  { key: "rooms", icon: Repeat },
  { key: "wall", icon: ShieldCheck },
  { key: "roles", icon: UsersRound },
  { key: "events", icon: CalendarDays },
] as const;

export async function Churches() {
  const t = await getTranslations("Churches");

  return (
    <section id="iglesias" className="light scroll-mt-4 bg-brand-violet-50 text-foreground">
      <Container className="grid gap-14 py-24 md:grid-cols-12 md:py-32">
        <div className="md:col-span-5">
          <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
          <p className="reveal mt-6 leading-relaxed text-muted-foreground">{t("body")}</p>
          <p className="reveal mt-6 border-l-[3px] border-brand-violet pl-4 text-sm leading-relaxed text-muted-foreground">
            {t("note")}
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 md:col-span-7 md:pt-10">
          {POINTS.map(({ key, icon: Icon }, i) => (
            <li
              key={key}
              className={`reveal rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border ${i % 2 === 1 ? "sm:translate-y-8" : ""}`}
            >
              <span className="grid size-11 place-items-center rounded-2xl bg-brand-violet-100 text-brand-violet-700">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 font-heading text-lg font-bold leading-snug">{t(`points.${key}`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
