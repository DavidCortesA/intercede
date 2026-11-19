import { z } from "zod";

/** Lo que devuelve `partner_overview`: todo lo que la pantalla del compañero de oración necesita, en una llamada. */
const checkinSchema = z.object({ status: z.enum(["good", "ok", "hard"]), note: z.string().nullable() });
const requestSchema = z.object({ id: z.string(), content: z.string() });

export const overviewSchema = z.object({
  program: z.object({ active: z.boolean(), mode: z.enum(["random", "group"]), labels: z.array(z.string()) }).nullable(),
  adult_confirmed: z.boolean(),
  is_leader: z.boolean(),
  /** Solo para el liderazgo y solo agregados: nunca quiénes. */
  stats: z.object({ signups: z.number().int(), paused: z.number().int(), pairs_this_week: z.number().int() }).nullable(),
  signup: z.object({ group_label: z.string().nullable(), paused: z.boolean() }).nullable(),
  pair: z
    .object({
      id: z.string(),
      week_start: z.string(),
      ended: z.boolean(),
      partner_id: z.string(),
      partner_name: z.string(),
      my_requests: z.array(requestSchema),
      partner_requests: z.array(requestSchema),
      i_pray: z.boolean(),
      partner_prays: z.boolean(),
      my_checkin: checkinSchema.nullable(),
      partner_checkin: checkinSchema.nullable(),
    })
    .nullable(),
});
export type PartnerOverview = z.infer<typeof overviewSchema>;

export const PARTNER_MAX_REQUESTS = 3;
export const PARTNER_REQUEST_MAX = 200;
export const PARTNER_NOTE_MAX = 140;

/** Códigos de error que devuelve la base (textos en messages → Partners.errors). */
export const PARTNER_ERROR_KEYS = [
  "generic",
  "not_leader",
  "not_member",
  "account_required",
  "adult_required",
  "program_inactive",
  "invalid_label",
  "invalid_mode",
  "invalid_labels",
  "labels_required",
  "not_in_pair",
  "pair_ended",
  "invalid_request",
  "too_many_requests",
  "request_not_found",
  "invalid_status",
] as const;
export type PartnerErrorKey = (typeof PARTNER_ERROR_KEYS)[number];

export function toPartnerError(message: string | undefined): PartnerErrorKey {
  return (PARTNER_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as PartnerErrorKey) : "generic";
}

/** "Norte, Sur\nJóvenes" → ["Norte", "Sur", "Jóvenes"] (sin vacíos ni repetidos; la base valida de nuevo). */
export function parseLabels(input: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const piece of input.split(/[\n,]/)) {
    const label = piece.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}
