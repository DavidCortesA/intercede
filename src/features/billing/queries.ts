import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { entitlementsSchema, type Entitlements } from "./schemas";

const planLimitsSchema = entitlementsSchema.omit({ plan: true });

export interface CatalogPlan {
  code: string;
  monthlyPrice: number;
  annualPrice: number;
  trialDays: number;
  limits: Omit<Entitlements, "plan">;
}

export interface CatalogProduct {
  code: string;
  kind: "pass" | "addon";
  price: number;
  orgPrice: number | null;
  isMonthly: boolean;
}

/** Catálogo (planes y productos) tal como está en la base: los precios nunca viven en los componentes. */
export async function getCatalog(): Promise<{ plans: CatalogPlan[]; products: CatalogProduct[] }> {
  const supabase = await createClient();
  const [plansRes, productsRes] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("products").select("*").order("sort_order"),
  ]);
  return {
    plans: (plansRes.data ?? []).flatMap((row) => {
      const limits = planLimitsSchema.safeParse(row.limits);
      return limits.success
        ? [{ code: row.code, monthlyPrice: row.monthly_price_mxn, annualPrice: row.annual_price_mxn, trialDays: row.trial_days, limits: limits.data }]
        : [];
    }),
    products: (productsRes.data ?? []).map((row) => ({
      code: row.code,
      kind: row.kind as "pass" | "addon",
      price: row.price_mxn,
      orgPrice: row.org_price_mxn,
      isMonthly: row.is_monthly,
    })),
  };
}

const billingSummarySchema = z.object({
  plan: z.string(),
  limits: entitlementsSchema,
  subscription: z
    .object({
      status: z.string(),
      billing_period: z.string(),
      provider: z.string(),
      current_period_end: z.string(),
      cancel_at_period_end: z.boolean(),
      is_current: z.boolean(),
    })
    .nullable(),
  members: z.number().int(),
  usage: z.object({
    period: z.string(),
    person_minutes: z.number(),
    included_minutes: z.number().nullable(),
    pack_minutes_available: z.number(),
  }),
  addons: z.array(z.object({ kind: z.string(), quantity: z.number(), expires_at: z.string() })),
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;

/** Resumen de facturación de una comunidad (solo administración; la base lo exige). */
export async function getCommunityBilling(communityId: string): Promise<BillingSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_billing", { p_community_id: communityId });
  if (error) return null;
  const parsed = billingSummarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export interface OrderRow {
  id: string;
  kind: string;
  item_code: string;
  billing_period: string | null;
  quantity: number;
  amount_mxn: number;
  status: string;
  checkout_url: string | null;
  created_at: string;
  paid_at: string | null;
}

const ORDER_COLUMNS = "id, kind, item_code, billing_period, quantity, amount_mxn, status, checkout_url, created_at, paid_at";

/** Pagos recientes: los propios (personal) o los de la comunidad (administración). RLS decide qué se ve. */
export async function getOrders(scope: { communityId: string } | { personal: true; userId: string }, limit = 10): Promise<OrderRow[]> {
  const supabase = await createClient();
  const query = supabase.from("orders").select(ORDER_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  const { data } = "communityId" in scope ? await query.eq("community_id", scope.communityId) : await query.eq("buyer_id", scope.userId).is("community_id", null);
  return data ?? [];
}

export async function getOrder(orderId: string): Promise<OrderRow | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  return data;
}

export interface PassRow {
  id: string;
  product_code: string;
  status: string;
  community_id: string | null;
  expires_at: string;
  created_at: string;
}

/** Pases de la persona (personales). Los de una comunidad los administra su administración. */
export async function getMyPasses(userId: string): Promise<PassRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("passes")
    .select("id, product_code, status, community_id, expires_at, created_at")
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  return data ?? [];
}
