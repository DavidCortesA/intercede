import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Container } from "./section-heading";

export interface LegalSection {
  id: string;
  title: string;
  body: string;
}

export async function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  const t = await getTranslations("Legal");

  return (
    <article className="light bg-background text-foreground">
      <Container className="max-w-3xl py-16 md:py-24">
        <p className="inline-block rounded-full bg-answered-surface px-4 py-1.5 text-xs font-bold text-answered-foreground">
          {t("draft")}
        </p>
        <h1 className="mt-6 font-heading text-4xl font-extrabold sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("updated")}</p>
        <p className="mt-8 text-lg leading-relaxed">{intro}</p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.id}>
              <h2 className="font-heading text-xl font-extrabold">{section.title}</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
        <Link href="/" className="mt-14 inline-block font-heading font-bold text-primary-text underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </Container>
    </article>
  );
}
