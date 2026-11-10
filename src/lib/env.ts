import { z } from "zod";

const supabasePublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

/**
 * Variables públicas de Supabase, validadas con Zod. Se leen con acceso literal
 * (`process.env.NEXT_PUBLIC_…`) porque Next solo las incrusta en el bundle del navegador así.
 * El error nombra las variables que faltan, nunca sus valores.
 */
export function getSupabasePublicEnv() {
  const parsed = supabasePublicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuración de Supabase incompleta o inválida (${invalid}). Revisa .env.local y .env.example.`);
  }

  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}
