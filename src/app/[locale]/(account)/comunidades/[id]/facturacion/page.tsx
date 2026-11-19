import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BuyButton } from "@/components/billing/buy-button";
import { LimitsList, OrderNotice, OrdersList, ProductCard } from "@/components/billing/billing-parts";
import { getCatalog, getCommunityBilling, getOrder, getOrders } from "@/features/billing/queries";
import { formatMxn } from "@/features/billing/schemas";
import { getCommunityContext } from "@/features/communities/queries";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/comunidades/[id]/facturacion">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Billing.community" });
  return pageMetadata({ locale, path: `/comunidades/${id}/facturacion`, title: t("metaTitle"), description: t("metaTitle"), noindex: true });
}

const PASS_CODES = ["sala_larga", "vigilia", "vigilia_grande"] as const;
const EXTRA_CODES = ["members_50", "rooms_5", "hours_100"] as const;

/** Facturación de la comunidad: plan, límites, uso del mes (solo agregados), compras y pagos. Solo administración. */
export default async function CommunityBillingPage({ params, searchParams }: PageProps<"/[locale]/comunidades/[id]/facturacion">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await getCommunityContext(id);
  if (!ctx.isAdmin) notFound();

  const query = await searchParams;
  const orderParam = typeof query.orden === "string" ? query.orden : null;
  const [t, format, summary, catalog, orders, returned] = await Promise.all([
    getTranslations("Billing"),
    getFormatter(),
    getCommunityBilling(id),
    getCatalog(),
    getOrders({ communityId: id }),
    orderParam ? getOrder(orderParam) : Promise.resolve(null),
  ]);
  if (!summary) notFound();

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });
  const isPaidPlan = summary.plan === "plus" || summary.plan === "pro";
  const sub = summary.subscription;
  const planName = t(`plans.${summary.plan as "comunidad" | "plus" | "pro"}.name`);

  let planStatus: string;
  if (sub?.is_current && sub.status === "trialing") planStatus = t("community.trialUntil", { date: date(sub.current_period_end) });
  else if (sub?.is_current && isPaidPlan) planStatus = t("community.activeUntil", { date: date(sub.current_period_end) });
  else if (sub && !sub.is_current && sub.provider === "conekta") planStatus = t("community.expired");
  else planStatus = t("community.free");

  const usedHours = Math.round(summary.usage.person_minutes / 60);
  const includedMinutes = summary.usage.included_minutes;
  const overLimit = includedMinutes !== null && summary.usage.person_minutes > includedMinutes + summary.usage.pack_minutes_available;
  const percent = includedMinutes ? Math.min(100, Math.round((summary.usage.person_minutes / includedMinutes) * 100)) : 0;

  const paidPlans = catalog.plans.filter((plan) => plan.monthlyPrice > 0);
  const product = (code: string) => catalog.products.find((item) => item.code === code);

  return (
    <div className="flex flex-col gap-8">
      {returned ? <OrderNotice order={returned} /> : null}

      <section aria-labelledby="plan-title" className="flex flex-col gap-4 rounded-3xl bg-background p-6 ring-1 ring-border">
        <div>
          <h2 id="plan-title" className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t("community.planTitle")}
          </h2>
          <p className="mt-1 font-heading text-3xl font-extrabold">{planName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{planStatus}</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold">{t("community.limitsTitle")}</h3>
          <LimitsList limits={summary.limits} />
          <p className="mt-2 text-xs text-muted-foreground">
            {summary.members} / {summary.limits.max_members}
          </p>
        </div>
      </section>

      <section aria-labelledby="usage-title" className="flex flex-col gap-3 rounded-3xl bg-background p-6 ring-1 ring-border">
        <h2 id="usage-title" className="font-heading text-lg font-bold">
          {t("community.usageTitle")}
        </h2>
        {includedMinutes === null ? (
          <p className="text-sm text-muted-foreground">{t("community.usageNone")}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">
              {t("community.usageBody", { used: usedHours, included: Math.round(includedMinutes / 60) })}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t("community.usageTitle")}
              className="h-3 overflow-hidden rounded-full bg-surface"
            >
              <div className={overLimit ? "h-full bg-destructive" : "h-full bg-brand-gradient"} style={{ width: `${percent}%` }} />
            </div>
            {summary.usage.pack_minutes_available > 0 ? (
              <p className="text-sm text-muted-foreground">{t("community.usagePacks", { hours: Math.floor(summary.usage.pack_minutes_available / 60) })}</p>
            ) : null}
            {overLimit ? <p className="text-sm text-destructive">{t("community.usageOver")}</p> : null}
          </>
        )}
        <p className="text-xs text-muted-foreground">{t("community.usagePrivacy")}</p>
      </section>

      <section aria-labelledby="upgrade-title" className="flex flex-col gap-4">
        <div>
          <h2 id="upgrade-title" className="font-heading text-lg font-bold">
            {t("community.upgradeTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("community.upgradeHelp")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("payMethods")}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {paidPlans.map((plan) => {
            const code = plan.code as "plus" | "pro";
            return (
              <li key={plan.code} className="flex flex-col gap-3 rounded-2xl bg-background p-5 ring-1 ring-border">
                <h3 className="font-heading text-xl font-extrabold">{t(`plans.${code}.name`)}</h3>
                <LimitsList limits={plan.limits} className="sm:grid-cols-1" />
                <div className="flex flex-col gap-2">
                  <BuyButton
                    purchase={{ kind: "plan", code, period: "monthly", communityId: id }}
                    label={`${t("period.monthly")} · ${formatMxn(plan.monthlyPrice)}`}
                    variant="secondary"
                  />
                  <BuyButton
                    purchase={{ kind: "plan", code, period: "annual", communityId: id }}
                    label={`${t("period.annual")} · ${formatMxn(plan.annualPrice)}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="extras-title" className="flex flex-col gap-4">
        <h2 id="extras-title" className="font-heading text-lg font-bold">
          {t("community.extrasTitle")}
        </h2>
        {isPaidPlan ? (
          <ul className="grid gap-4 sm:grid-cols-3">
            {EXTRA_CODES.map((code) => {
              const item = product(code);
              if (!item) return null;
              return (
                <ProductCard key={code} code={code} price={item.price} priceNote={item.isMonthly ? t("perMonth") : t("oneTime")}>
                  <BuyButton purchase={{ kind: "addon", code, quantity: 1, communityId: id }} label={t("pay")} variant="secondary" />
                </ProductCard>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("community.extrasLocked")}</p>
        )}
        {summary.addons.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-bold">{t("community.activeExtras")}</h3>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {summary.addons.map((addon, index) => (
                <li key={`${addon.kind}-${index}`}>
                  {t(`products.${addon.kind as "members_50"}.name`)} — {t("community.extraUntil", { quantity: addon.quantity, date: date(addon.expires_at) })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="passes-title" className="flex flex-col gap-4">
        <div>
          <h2 id="passes-title" className="font-heading text-lg font-bold">
            {t("community.passesTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("community.passesHelp")}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {PASS_CODES.map((code) => {
            const item = product(code);
            if (!item) return null;
            const price = isPaidPlan && item.orgPrice ? item.orgPrice : item.price;
            return (
              <ProductCard key={code} code={code} price={price} priceNote={t("oneTime")}>
                <BuyButton purchase={{ kind: "pass", code, communityId: id }} label={t("pay")} variant="secondary" />
              </ProductCard>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="orders-title" className="flex flex-col gap-3">
        <h2 id="orders-title" className="font-heading text-lg font-bold">
          {t("community.ordersTitle")}
        </h2>
        <OrdersList orders={orders} empty={t("community.noOrders")} />
      </section>
    </div>
  );
}
