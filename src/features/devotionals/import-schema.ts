import { z } from "zod";

/**
 * Formato del archivo que carga devocionales con `npm run devotionals:import -- archivo.json`.
 *
 * Este archivo solo depende de Zod (sin alias `@/`) para que lo use tanto la app/pruebas como el
 * script de Node (que lo ejecuta con la eliminación de tipos de Node ≥ 22.18).
 *
 * El contenido (pasaje, versión bíblica, reflexión) lo aporta quien administra la plataforma: no se
 * incluye ninguno de fábrica (ver docs/decisions/0010).
 */
const text = (max: number) => z.string().trim().min(1).max(max);

export const devotionalImportItemSchema = z.object({
  /** Día en que se publica, AAAA-MM-DD (la fecha local de cada persona decide cuál ve). */
  date: z.iso.date(),
  passage_reference: text(120),
  passage_text: text(2000),
  bible_version: text(60),
  reflection: text(4000),
  question: text(500),
  suggested_prayer: text(1000).optional(),
});

export const devotionalImportSchema = z
  .array(devotionalImportItemSchema)
  .min(1)
  .max(1000)
  .refine((items) => new Set(items.map((i) => i.date)).size === items.length, { message: "Hay fechas repetidas en el archivo." });

export type DevotionalImportItem = z.infer<typeof devotionalImportItemSchema>;

/** Convierte un elemento del archivo en la fila de `public.devotionals`. */
export function toDevotionalRow(item: DevotionalImportItem) {
  return {
    devotional_date: item.date,
    passage_reference: item.passage_reference,
    passage_text: item.passage_text,
    bible_version: item.bible_version,
    reflection: item.reflection,
    question: item.question,
    suggested_prayer: item.suggested_prayer ?? null,
  };
}
