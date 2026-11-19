import { z } from "zod";

/** Límites efectivos que calcula la base (`entitlements_for`). Una sola fuente: ningún componente decide por su cuenta. */
export const entitlementsSchema = z.object({
  plan: z.string(),
  max_members: z.number().int(),
  max_concurrent_rooms: z.number().int(),
  max_room_minutes: z.number().int(),
  max_room_participants: z.number().int(),
  included_person_hours: z.number().int().nullable(),
  max_cameras: z.number().int(),
  camera_quality: z.string(),
  urgent_per_day: z.number().int(),
  breakout_groups: z.number().int(),
  own_guides: z.boolean(),
  stats: z.enum(["none", "last_30_days", "history"]),
  branding: z.boolean(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const PLAN_CODES = ["comunidad", "plus", "pro"] as const;
export const PASS_CODES = ["sala_larga", "vigilia", "vigilia_grande", "extension"] as const;
export const ADDON_CODES = ["members_50", "rooms_5", "hours_100"] as const;
export type PassCode = (typeof PASS_CODES)[number];
export type AddonCode = (typeof ADDON_CODES)[number];

const uuid = z.uuid();

/** Cuerpo de `POST /api/billing/checkout`. El monto NUNCA viaja desde el cliente: lo calcula la base. */
export const checkoutSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    code: z.enum(["plus", "pro"]),
    period: z.enum(["monthly", "annual"]),
    communityId: uuid,
  }),
  z.object({
    kind: z.literal("pass"),
    code: z.enum(PASS_CODES),
    communityId: uuid.optional(),
    roomId: uuid.optional(),
  }),
  z.object({
    kind: z.literal("addon"),
    code: z.enum(ADDON_CODES),
    quantity: z.number().int().min(1).max(10).default(1),
    communityId: uuid,
  }),
]);
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Códigos de error de facturación (los textos viven en messages → Billing.errors). */
export const BILLING_ERROR_KEYS = [
  "generic",
  "account_required",
  "invalid_item",
  "not_admin",
  "not_host",
  "plan_required",
  "invalid_quantity",
  "too_many_pending",
  "payment_unavailable",
  "pass_unavailable",
  "pass_not_found",
  "pass_wrong_community",
  "room_closed",
] as const;
export type BillingErrorKey = (typeof BILLING_ERROR_KEYS)[number];

export function toBillingError(message: string | undefined): BillingErrorKey {
  return (BILLING_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as BillingErrorKey) : "generic";
}

export function formatMxn(amount: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(amount);
}
