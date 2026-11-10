import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { Container } from "./section-heading";
import { Wordmark } from "./wordmark";

const NAV = [
  { key: "how", href: "/#como-funciona" },
  { key: "features", href: "/#funciones" },
  { key: "churches", href: "/#iglesias" },
  { key: "trust", href: "/#confianza" },
  { key: "faq", href: "/#preguntas" },
] as const;

export async function Header() {
  const t = await getTranslations("Nav");
  const a11y = await getTranslations("A11y");

  return (
    <header className="dark relative z-30 bg-brand-navy-900 text-foreground">
      <Container className="flex items-center justify-between py-4">
        <Link href="/" aria-label={a11y("home")} className="rounded-lg">
          <Wordmark className="h-7 sm:h-8" />
        </Link>
        <nav aria-label={a11y("mainNav")} className="hidden items-center gap-7 text-sm lg:flex">
          {NAV.map(({ key, href }) => (
            <Link key={key} href={href} className="text-brand-cream/80 transition-colors hover:text-white">
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/entrar" className="hidden px-2 text-sm font-semibold text-brand-cream/85 transition-colors hover:text-white sm:inline">
            {t("signIn")}
          </Link>
          <Link href="/orar" className={buttonVariants({ size: "sm", variant: "light" })}>
            {t("cta")}
          </Link>
        </div>
      </Container>
    </header>
  );
}
