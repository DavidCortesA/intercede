import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BuyButton } from "@/components/billing/buy-button";
import { OrderNotice, OrdersList, ProductCard } from "@/components/billing/billing-parts";
import { buttonVariants } from "@/components/ui/button";
import { getCatalog, getMyPasses, getOrder, getOrders } from "@/features/billing/queries";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/facturacion">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Billing.personal" });
  return pageMetadata({ locale, path: "/facturacion", title: t("metaTitle"), description: t("subtitle"), noindex: true });
}

const PASS_CODES = ["sala_larga", "vigilia", "vigilia_grande"] as const;

/** Pases y pagos personales. Las comunidades tienen su propia facturación (administración). */
export default async function PersonalBillingPage({ params, searchParams }: PageProps<"/[locale]/facturacion">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireSession(locale, "/facturacion");
  const t = await getTranslations("Billing");

  if (session.isAnonymous) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-3xl bg-background p-7 shadow-sm ring-1 ring-border">
        <h1 className="font-heading text-2xl font-extrabold text-balance">{t("personal.guestTitle")}</h1>
        <p className="leading-relaxed text-muted-foreground">{t("personal.guestBody")}</p>
        <Link href="/registro" className={buttonVariants({ size: "md" })}>
          {t("personal.guestTitle")}
        </Link>
      </section>
    );
  }

  const query = await searchParams;
  const orderParam = typeof query.orden === "string" ? query.orden : null;
  const [format, catalog, passes, orders, returned] = await Promise.all([
    getFormatter(),
    getCatalog(),
    getMyPasses(session.userId),
    getOrders({ personal: true, userId: session.userId }),
    orderParam ? getOrder(orderParam) : Promise.resolve(null),
  ]);
  const personalPasses = passes.filter((pass) => pass.community_id === null);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-3xl font-extrabold">{t("personal.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("personal.subtitle")}</p>
      </header>

      {returned ? <OrderNotice order={returned} /> : null}

      <section aria-labelledby="passes-title" className="flex flex-col gap-3">
        <h2 id="passes-title" className="font-heading text-lg font-bold">
          {t("personal.available")}
        </h2>
        {personalPasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("personal.noPasses")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 rounded-2xl bg-background ring-1 ring-border">
            {personalPasses.map((pass) => (
              <li key={pass.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="font-semibold">{t(`products.${pass.product_code as "vigilia"}.name`)}</span>
                <span className="text-muted-foreground">
                  {pass.status === "available"
                    ? t("personal.passStatus.available", { date: format.dateTime(new Date(pass.expires_at), { dateStyle: "medium" }) })
                    : t(`personal.passStatus.${pass.status as "applied"}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="buy-title" className="flex flex-col gap-4">
        <div>
          <h2 id="buy-title" className="font-heading text-lg font-bold">
            {t("personal.buyTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("personal.buyHelp")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("payMethods")}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {PASS_CODES.map((code) => {
            const product = catalog.products.find((item) => item.code === code);
            if (!product) return null;
            return (
              <ProductCard key={code} code={code} price={product.price} priceNote={t("oneTime")}>
                <BuyButton purchase={{ kind: "pass", code }} label={t("pay")} />
              </ProductCard>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="orders-title" className="flex flex-col gap-3">
        <h2 id="orders-title" className="font-heading text-lg font-bold">
          {t("personal.ordersTitle")}
        </h2>
        <OrdersList orders={orders} empty={t("personal.noOrders")} />
      </section>
    </div>
  );
}
