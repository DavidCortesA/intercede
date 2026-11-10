import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Las pruebas de integración corren contra el Supabase LOCAL (supabase start), nunca contra
 * el proyecto remoto. `npm run test:db` rellena estas variables desde `supabase status`.
 */
export const testEnv = {
  url: process.env.SUPABASE_TEST_URL,
  publishableKey: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
};

export const hasTestDb = Boolean(testEnv.url && testEnv.publishableKey && testEnv.serviceRoleKey);

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export type TestClient = SupabaseClient<Database>;

/** Cliente anónimo de API (rol `anon`, sin sesión). */
export function anonClient(): TestClient {
  return createClient<Database>(testEnv.url!, testEnv.publishableKey!, noPersist);
}

/** Cliente con privilegios totales, solo para preparar y limpiar datos de prueba. */
export function adminClient(): TestClient {
  return createClient<Database>(testEnv.url!, testEnv.serviceRoleKey!, noPersist);
}

/**
 * Usuario de prueba con contraseña, creado por la API de administración. Sirve para las pruebas
 * que necesitan muchas personas: las altas anónimas tienen un tope por hora y por IP, y el
 * comportamiento de RLS es idéntico (rol `authenticated`, auth.uid()).
 */
export async function signInTestUser(displayName: string): Promise<{ client: TestClient; user: User }> {
  const email = `prueba-${crypto.randomUUID()}@example.test`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`No se pudo iniciar sesión: ${signIn.error.message}`);
  return { client, user: data.user };
}

/** Usuario sin sesión (solo existe en la base): para llenar aforos desde el administrador. */
export async function createBareUser(): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email: `relleno-${crypto.randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de relleno: ${error?.message}`);
  return data.user.id;
}

/** Crea un invitado (usuario anónimo) y devuelve su cliente ya autenticado. */
export async function signInGuest(displayName?: string): Promise<{ client: TestClient; user: User }> {
  const client = anonClient();
  const { data, error } = await client.auth.signInAnonymously(
    displayName === undefined ? undefined : { options: { data: { display_name: displayName } } },
  );
  if (error || !data.user) throw new Error(`No se pudo crear el invitado de prueba: ${error?.message}`);
  return { client, user: data.user };
}
