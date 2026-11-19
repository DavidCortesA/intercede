import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCalendarDeps } from "@/features/calendar/config";
import { processCalendarJobs } from "@/features/calendar/sync";

function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Procesa la cola de sincronización con Google Calendar. La llama pg_cron cada minuto mediante pg_net con un secreto compartido
 * (`CALENDAR_SYNC_SECRET` aquí, `calendar_sync_secret` en Vault). Sin sesión ni cookies: solo ese secreto.
 */
export async function POST(request: Request) {
  const secret = process.env.CALENDAR_SYNC_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  if (!sameSecret(request.headers.get("x-calendar-secret"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deps = getCalendarDeps();
  if (!deps) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  const result = await processCalendarJobs(deps);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
