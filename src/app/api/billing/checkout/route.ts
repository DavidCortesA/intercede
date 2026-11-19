import { checkoutSchema, toBillingError } from "@/features/billing/schemas";
import { createHostedOrder } from "@/lib/conekta/client";
import { apiError, apiOk, parseJson, type ApiErrorCode } from "@/lib/livekit/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Inicia un pago: crea la orden en la base COMO la persona (la base valida permisos y calcula el precio; el cliente
 * nunca manda un monto) y luego pide a Conekta una página de pago. La compra se activa solo cuando llega el webhook
 * verificado (`/api/billing/webhook`), nunca por volver del pago.
 */
export async function POST(request: Request) {
  const body = await parseJson(request, checkoutSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return apiError("unauthenticated", 401);
  if (user.is_anonymous || !user.email) return apiError("account_required", 403);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl || !process.env.CONEKTA_API_SECRET) return apiError("payment_unavailable", 503);

  const { data, error } = await supabase.rpc("create_order", {
    p_kind: input.kind,
    p_code: input.code,
    p_period: input.kind === "plan" ? input.period : undefined,
    p_quantity: input.kind === "addon" ? input.quantity : 1,
    p_community_id: input.communityId,
    p_room_id: input.kind === "pass" ? input.roomId : undefined,
  });
  const order = data?.[0];
  if (error || !order) {
    const code = toBillingError(error?.message);
    return apiError(code === "generic" ? "unexpected" : (code as ApiErrorCode), code === "generic" ? 500 : 400);
  }

  // Vuelta del pago: la pantalla de facturación correspondiente (muestra el estado real, que viene de la base)
  // Si se compró desde una sala en curso, se vuelve a ella (el pase ya se aplicó cuando llega el pago)
  let returnUrl: string;
  const roomId = input.kind === "pass" ? input.roomId : undefined;
  const { data: room } = roomId ? await supabase.from("rooms").select("code").eq("id", roomId).maybeSingle() : { data: null };
  if (room) returnUrl = `${siteUrl}/es/r/${room.code}`;
  else {
    const returnPath = input.communityId ? `/es/comunidades/${input.communityId}/facturacion` : "/es/facturacion";
    returnUrl = `${siteUrl}${returnPath}?orden=${order.order_id}`;
  }
  const admin = createAdminClient();

  try {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    const hosted = await createHostedOrder({
      orderId: order.order_id,
      itemName: order.item_name,
      amountMxn: order.amount_mxn,
      buyer: { name: profile?.display_name?.trim() || user.email.split("@")[0] || "Cliente", email: user.email },
      successUrl: returnUrl,
      failureUrl: returnUrl,
      expiresAt: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
    });
    await admin.rpc("attach_order_checkout", {
      p_order_id: order.order_id,
      p_provider_order_id: hosted.providerOrderId,
      p_checkout_url: hosted.checkoutUrl,
      p_expires_at: new Date((hosted.expiresAt ?? Math.floor(Date.now() / 1000) + 3 * 24 * 3600) * 1000).toISOString(),
    });
    return apiOk({ url: hosted.checkoutUrl, orderId: order.order_id });
  } catch {
    // La orden no llegó a existir en la pasarela: se cierra para que no quede pendiente
    await admin.rpc("fail_order", { p_order_id: order.order_id, p_status: "failed" });
    return apiError("payment_unavailable", 502);
  }
}
