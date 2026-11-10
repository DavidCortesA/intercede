import { Bell, BookOpen, CalendarDays, Heart, Mic, Users, type LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section-heading";

type FeatureKey = "rooms" | "requests" | "reminders" | "devotionals" | "events" | "communities";

// Bento: tamaños distintos en lugar de tres columnas idénticas
const FEATURES: { key: FeatureKey; icon: LucideIcon; span: string; featured?: boolean }[] = [
  { key: "rooms", icon: Mic, span: "md:col-span-4", featured: true },
  { key: "requests", icon: Heart, span: "md:col-span-2" },
  { key: "reminders", icon: Bell, span: "md:col-span-2" },
  { key: "devotionals", icon: BookOpen, span: "md:col-span-2" },
  { key: "events", icon: CalendarDays, span: "md:col-span-2" },
  { key: "communities", icon: Users, span: "md:col-span-6" },
];

export async function Features() {
  const t = await getTranslations("Features");

  return (
    <section id="funciones" className="dark scroll-mt-4 bg-background text-foreground">
      <Container className="py-24 md:py-32">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} />
        <ul className="mt-14 grid gap-4 md:grid-cols-6">
          {FEATURES.map(({ key, icon: Icon, span, featured }) => (
            <li
              key={key}
              className={cn(
                "reveal group rounded-3xl border border-border p-7 transition-colors duration-300 hover:border-brand-violet-400/60",
                featured ? "bg-brand-gradient border-transparent text-white" : "bg-surface",
                span,
              )}
            >
              <span
                className={cn(
                  "grid size-12 place-items-center rounded-2xl",
                  featured ? "bg-white/15 text-white" : "bg-brand-violet/25 text-brand-lavender",
                )}
              >
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-heading text-xl font-extrabold">{t(`items.${key}.title`)}</h3>
              <p className={cn("mt-2 max-w-xl leading-relaxed", featured ? "text-white/90" : "text-muted-foreground")}>
                {t(`items.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
