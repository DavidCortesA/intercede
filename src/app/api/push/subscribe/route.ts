import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/features/notifications/schemas";
import { apiError, apiOk, parseJson } from "@/lib/livekit/route-auth";
import { createClient } from "@/lib/supabase/server";

/** Errores de la base (P0001) que la pantalla sabe explicar. */
function mapDatabaseError(message: string) {
  if (message === "account_required") return apiError("account_required", 403);
  if (message === "too_many_devices") return apiError("too_many_devices", 409);
  if (message === "invalid_endpoint") return apiError("invalid_endpoint", 400);
  if (message === "not_authenticated") return apiError("unauthenticated", 401);
  return apiError("unexpected", 500);
}

/**
 * Registra este dispositivo para recibir avisos. La sesión y el permiso (cuenta permanente, tope de
 * dispositivos, solo servicios push de navegadores) los exige la base de datos, no esta ruta:
 * la ruta valida la forma de la petición y el origen (CSRF) y llama a la función como la persona.
 */
export async function POST(request: Request) {
  const body = await parseJson(request, pushSubscriptionSchema);
  if (!body.ok) return body.response;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return apiError("unauthenticated", 401);

  const { error } = await supabase.rpc("upsert_push_subscription", {
    p_endpoint: body.data.endpoint,
    p_p256dh: body.data.keys.p256dh,
    p_auth: body.data.keys.auth,
    p_user_agent: request.headers.get("user-agent") ?? undefined,
  });
  if (error) return mapDatabaseError(error.message);
  return apiOk({ ok: true });
}

/** Quita este dispositivo (RLS: solo se pueden quitar los propios). */
export async function DELETE(request: Request) {
  const body = await parseJson(request, pushUnsubscribeSchema);
  if (!body.ok) return body.response;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return apiError("unauthenticated", 401);

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", body.data.endpoint);
  if (error) return apiError("unexpected", 500);
  return apiOk({ ok: true });
}
