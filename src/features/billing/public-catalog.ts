import { entitlementsSchema } from "./schemas";
import type { CatalogPlan, CatalogProduct } from "./queries";
import { createAdminClient } from "@/lib/supabase/admin";

const planLimitsSchema = entitlementsSchema.omit({ plan: true });

/**
 * Catálogo para la página pública de precios. Se lee en el SERVIDOR con la service role (no hay sesión en una página
 * pública y las tablas no se abren al rol anónimo). Solo son precios y límites públicos. Devuelve `null` si no se
 * puede leer, para que la página lo diga en vez de mostrar números inventados.
 */
export async function getPublicCatalog(): Promise<{ plans: CatalogPlan[]; products: CatalogProduct[] } | null> {
  try {
    const admin = createAdminClient();
    const [plansRes, productsRes] = await Promise.all([
      admin.from("plans").select("*").order("sort_order"),
      admin.from("products").select("*").order("sort_order"),
    ]);
    if (plansRes.error || productsRes.error || !plansRes.data?.length) return null;
    return {
      plans: plansRes.data.flatMap((row) => {
        const limits = planLimitsSchema.safeParse(row.limits);
        return limits.success
          ? [{ code: row.code, monthlyPrice: row.monthly_price_mxn, annualPrice: row.annual_price_mxn, trialDays: row.trial_days, limits: limits.data }]
          : [];
      }),
      products: productsRes.data.map((row) => ({
        code: row.code,
        kind: row.kind as "pass" | "addon",
        price: row.price_mxn,
        orgPrice: row.org_price_mxn,
        isMonthly: row.is_monthly,
      })),
    };
  } catch {
    return null;
  }
}
