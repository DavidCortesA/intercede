import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { deleteAccountSchema } from "@/features/moderation/schemas";
import { getSupabasePublicEnv } from "@/lib/env";
import { getRoomService } from "@/lib/livekit/server";
import { apiError, apiOk, parseJson } from "@/lib/livekit/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Borra los archivos de una carpeta de un bucket (best effort: la cuenta se borra aunque falle). */
async function removeFolder(admin: ReturnType<typeof createAdminClient>, bucket: string, folder: string) {
  const { data } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
  const paths = (data ?? []).map((file) => `${folder}/${file.name}`);
  if (paths.length > 0) await admin.storage.from(bucket).remove(paths);
}

/**
 * Eliminar la cuenta y TODOS sus datos (CLAUDE.md §5.4). Pasos, en este orden:
 *  1. Confirmación escrita y, si la cuenta tiene contraseña, la contraseña (una sesión robada no basta).
 *  2. `prepare_account_deletion`: la administración de las comunidades que quedarían sin admin pasa a otra
 *     persona (o la comunidad vacía se elimina).
 *  3. Se cierran las salas de audio abiertas de la persona y se borran sus archivos (foto y logos de las
 *     comunidades eliminadas): la base no borra Storage por sí sola.
 *  4. Se borra el usuario de Auth: todas las tablas caen en cascada.
 * Corre con la service role en el servidor; la identidad sale de la sesión, nunca del cuerpo.
 */
export async function POST(request: Request) {
  const body = await parseJson(request, deleteAccountSchema);
  if (!body.ok) return body.response;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return apiError("unauthenticated", 401);

  // Cuentas con contraseña: se vuelve a comprobar con un cliente aparte (no toca la sesión actual)
  const hasPassword = !user.is_anonymous && Boolean(user.email) && (user.app_metadata?.providers ?? []).includes("email");
  if (hasPassword) {
    const { url, publishableKey } = getSupabasePublicEnv();
    const probe = createSupabaseClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const check = body.data.password ? await probe.auth.signInWithPassword({ email: user.email!, password: body.data.password }) : null;
    if (!check || check.error || check.data.user?.id !== user.id) return apiError("invalid_password", 403);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return apiError("server_misconfigured", 500);
  }

  const { data: prepared, error: prepareError } = await admin.rpc("prepare_account_deletion", { p_user_id: user.id });
  if (prepareError) return apiError("deletion_failed", 500);
  const plan = prepared as { deleted_communities?: string[]; open_rooms?: string[] } | null;

  // Salas de audio abiertas: se cierran en LiveKit (si falla, la sala termina sola al vaciarse)
  await Promise.allSettled((plan?.open_rooms ?? []).map((roomId) => getRoomService().deleteRoom(roomId)));

  await Promise.allSettled([
    removeFolder(admin, "avatars", user.id),
    ...(plan?.deleted_communities ?? []).map((communityId) => removeFolder(admin, "community-logos", communityId)),
  ]);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return apiError("deletion_failed", 500);

  // Limpia las cookies de sesión de este navegador
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return apiOk({ ok: true });
}
