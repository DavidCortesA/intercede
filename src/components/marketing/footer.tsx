import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Container } from "./section-heading";
import { Wordmark } from "./wordmark";

export async function Footer() {
  const t = await getTranslations("Footer");
  const brand = await getTranslations("Brand");
  // Correo de contacto real: solo se muestra si se configura (no se inventan datos de contacto).
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <footer className="dark bg-brand-navy-950 text-foreground">
      <Container className="flex flex-col gap-8 py-12 pb-28 md:flex-row md:items-end md:justify-between md:pb-12">
        <div>
          <Wordmark />
          <p className="mt-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">{brand("taglineSpaced")}</p>
          <p className="mt-6 text-sm text-muted-foreground">
            © {new Date().getFullYear()} {t("rights")}
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
          <Link href="/privacidad" className="hover:text-white hover:underline underline-offset-4">
            {t("privacy")}
          </Link>
          <Link href="/terminos" className="hover:text-white hover:underline underline-offset-4">
            {t("terms")}
          </Link>
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className="hover:text-white hover:underline underline-offset-4">
              {t("contact")}
            </a>
          ) : null}
        </nav>
      </Container>
    </footer>
  );
}
