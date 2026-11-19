import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LimitsList, ProductCard } from "@/components/billing/billing-parts";
import { Container } from "@/components/marketing/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { getPublicCatalog } from "@/features/billing/public-catalog";
import { formatMxn } from "@/features/billing/schemas";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

// Los precios viven en la base: se renueva cada hora (no hay valores escritos a mano en la página)
export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/[locale]/precios">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Billing.pricing" });
  return pageMetadata({ locale, path: "/precios", title: t("metaTitle"), description: t("metaDescription") });
}

const PASS_CODES = ["sala_larga", "vigilia", "vigilia_grande", "extension"] as const;
const EXTRA_CODES = ["members_50", "rooms_5", "hours_100"] as const;

export default async function PricingPage({ params }: PageProps<"/[locale]/precios">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, billing, catalog] = await Promise.all([getTranslations("Billing.pricing"), getTranslations("Billing"), getPublicCatalog()]);

  return (
    <div className="bg-surface-warm text-foreground">
      <Container className="flex flex-col gap-14 py-16 md:py-24">
        <header className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary-text">{t("eyebrow")}</p>
          <h1 className="mt-4 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[1.05] text-balance">{t("title")}</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{t("subtitle")}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/orar" className={buttonVariants({ size: "md" })}>
              {t("cta")}
            </Link>
            <Link href="/registro" className={buttonVariants({ size: "md", variant: "secondary" })}>
              {t("ctaCommunity")}
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("guestsNote")}</p>
        </header>

        {!catalog ? (
          <p role="status" className="rounded-2xl bg-background px-5 py-4 text-sm ring-1 ring-border">
            {t("unavailable")}
          </p>
        ) : (
          <>
            <section aria-labelledby="plans-title" className="flex flex-col gap-6">
              <h2 id="plans-title" className="font-heading text-2xl font-extrabold">
                {t("plansTitle")}
              </h2>
              <ul className="grid gap-5 lg:grid-cols-3">
                {catalog.plans.map((plan) => {
                  const code = plan.code as "comunidad" | "plus" | "pro";
                  return (
                    <li key={plan.code} className="flex flex-col gap-4 rounded-3xl bg-background p-6 ring-1 ring-border">
                      <div>
                        <h3 className="font-heading text-2xl font-extrabold">{billing(`plans.${code}.name`)}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{billing(`plans.${code}.tagline`)}</p>
                      </div>
                      <p className="font-heading text-3xl font-extrabold tabular-nums">
                        {plan.monthlyPrice === 0 ? billing("free") : formatMxn(plan.monthlyPrice)}
                        {plan.monthlyPrice > 0 ? <span className="ml-2 text-sm font-semibold text-muted-foreground">{billing("perMonth")}</span> : null}
                      </p>
                      {plan.annualPrice > 0 ? (
                        <p className="-mt-2 text-sm text-muted-foreground">
                          {billing("period.annual")}: {formatMxn(plan.annualPrice)}
                        </p>
                      ) : null}
                      <LimitsList limits={plan.limits} className="sm:grid-cols-1" />
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-muted-foreground">{t("plansNote")}</p>
              <p className="text-sm text-muted-foreground">{t("quote")}</p>
            </section>

            <section aria-labelledby="passes-title" className="flex flex-col gap-6">
              <div>
                <h2 id="passes-title" className="font-heading text-2xl font-extrabold">
                  {t("passesTitle")}
                </h2>
                <p className="mt-2 text-muted-foreground">{t("passesSubtitle")}</p>
              </div>
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {PASS_CODES.map((code) => {
                  const product = catalog.products.find((item) => item.code === code);
                  if (!product) return null;
                  return (
                    <ProductCard
                      key={code}
                      code={code}
                      price={product.price}
                      priceNote={billing("oneTime")}
                    >
                      {product.orgPrice ? <p className="text-sm text-muted-foreground">{t("orgPrice", { price: formatMxn(product.orgPrice) })}</p> : null}
                    </ProductCard>
                  );
                })}
              </ul>
            </section>

            <section aria-labelledby="extras-title" className="flex flex-col gap-6">
              <h2 id="extras-title" className="font-heading text-2xl font-extrabold">
                {t("extrasTitle")}
              </h2>
              <ul className="grid gap-5 sm:grid-cols-3">
                {EXTRA_CODES.map((code) => {
                  const product = catalog.products.find((item) => item.code === code);
                  if (!product) return null;
                  return <ProductCard key={code} code={code} price={product.price} priceNote={product.isMonthly ? billing("perMonth") : billing("oneTime")} />;
                })}
              </ul>
            </section>
          </>
        )}
      </Container>
    </div>
  );
}
