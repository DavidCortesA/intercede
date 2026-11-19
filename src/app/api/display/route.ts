import { NextResponse } from "next/server";
import { z } from "zod";
import { roomCodeSchema } from "@/features/rooms/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

const querySchema = z.object({
  code: roomCodeSchema,
  t: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

/**
 * Estado que se proyecta en la pantalla de una sala (CLAUDE.md §16 B4). Sin sesión: la entrada es el enlace secreto
 * que genera quien anfitriona (revocable). La base valida el enlace y devuelve SOLO lo proyectable: la petición en foco, las que
 * siguen y la guía en curso; ningún nombre ni autor. Un enlace inválido o revocado y una sala inexistente responden igual
 * (404), para no confirmar qué códigos existen.
 */
export async function GET(request: Request) {
  const params = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return NextResponse.json({ error: "invalid_link" }, { status: 404, headers });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500, headers });
  }

  const { data, error } = await admin.rpc("display_state", { p_code: params.data.code, p_token: params.data.t });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 502, headers });
  if (!data) return NextResponse.json({ error: "invalid_link" }, { status: 404, headers });
  return NextResponse.json(data, { headers });
}
