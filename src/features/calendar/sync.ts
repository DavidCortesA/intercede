import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  calendarExists,
  createCalendar,
  deleteEvent,
  findEventByKey,
  GoogleApiError,
  insertEvent,
  patchEvent,
  refreshAccessToken,
  revokeToken,
  type GoogleConfig,
  type GoogleEventBody,
} from "@/lib/google/client";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { eventPayload, schedulePayload, sourceKey, type SourceType } from "./payload";

type Admin = SupabaseClient<Database>;
type Job = Database["public"]["Tables"]["calendar_sync_jobs"]["Row"];
type Connection = Database["public"]["Tables"]["calendar_connections"]["Row"];

export const CALENDAR_NAME = "INTERCEDE";

export interface SyncDeps {
  admin: Admin;
  config: GoogleConfig;
  siteUrl: string;
  /** Llave de cifrado de los tokens. */
  key: Buffer;
}

export interface SyncResult {
  processed: number;
  retried: number;
  dropped: number;
  disconnected: number;
}

/** Espera antes de reintentar: 30 s, 1 min, 2 min… hasta 1 hora. */
export const retryDelaySeconds = (attempts: number) => Math.min(30 * 2 ** attempts, 3600);

/** ¿Qué debe existir hoy en Google para este elemento de esta persona? `null` = nada (se borra si existe). */
async function desiredPayload(deps: SyncDeps, connection: Connection, job: Job): Promise<GoogleEventBody | null> {
  const { admin, siteUrl } = deps;
  if (job.source_type === "event") {
    if (!connection.sync_events) return null;
    const { data: rsvp } = await admin.from("event_rsvps").select("status").eq("event_id", job.source_id).eq("user_id", job.user_id).maybeSingle();
    if (!rsvp || (rsvp.status !== "going" && rsvp.status !== "maybe")) return null;
    const { data: event } = await admin.from("events").select("id, title, description, starts_at, ends_at, timezone, community_id").eq("id", job.source_id).maybeSingle();
    return event ? eventPayload(event, siteUrl) : null;
  }
  if (job.source_type === "schedule") {
    if (!connection.sync_schedules) return null;
    const { data: sub } = await admin.from("schedule_subscriptions").select("user_id").eq("schedule_id", job.source_id).eq("user_id", job.user_id).maybeSingle();
    if (!sub) return null;
    const { data: schedule } = await admin
      .from("room_schedules")
      .select("id, name, timezone, recurrence, weekdays, next_occurrence_at, is_active")
      .eq("id", job.source_id)
      .maybeSingle();
    if (!schedule || !schedule.is_active || !schedule.next_occurrence_at) return null;
    return schedulePayload({ ...schedule, recurrence: schedule.recurrence as "once" | "daily" | "weekly", weekdays: schedule.weekdays.map(Number), next_occurrence_at: schedule.next_occurrence_at }, siteUrl);
  }
  return null; // turnos de cadena (B1): todavía no existen
}

/** Crea el calendario secundario "INTERCEDE" de la persona y lo guarda. Los vínculos anteriores ya no sirven. */
async function ensureCalendar(deps: SyncDeps, connection: Connection, accessToken: string, forceNew = false): Promise<string> {
  if (connection.calendar_id && !forceNew) return connection.calendar_id;
  const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", connection.user_id).maybeSingle();
  const calendarId = await createCalendar(accessToken, CALENDAR_NAME, profile?.timezone ?? "UTC");
  await deps.admin.from("calendar_connections").update({ calendar_id: calendarId, updated_at: new Date().toISOString() }).eq("user_id", connection.user_id);
  await deps.admin.from("calendar_event_links").delete().eq("user_id", connection.user_id);
  connection.calendar_id = calendarId;
  return calendarId;
}

/**
 * Reconcilia UN elemento: compara lo que debe existir con lo que hay en Google. Idempotente (se puede repetir tras un fallo). Si la persona borró
 * el evento en Google, queda `user_deleted` y NO se vuelve a crear mientras siga debiendo existir.
 */
async function reconcile(deps: SyncDeps, connection: Connection, accessToken: string, job: Job): Promise<void> {
  const { admin } = deps;
  const desired = await desiredPayload(deps, connection, job);
  const { data: link } = await admin
    .from("calendar_event_links")
    .select("google_event_id, status")
    .eq("user_id", job.user_id)
    .eq("source_type", job.source_type)
    .eq("source_id", job.source_id)
    .maybeSingle();
  const linkKey = { user_id: job.user_id, source_type: job.source_type, source_id: job.source_id };

  if (!desired) {
    if (link?.status === "active" && connection.calendar_id) {
      await deleteEvent(accessToken, connection.calendar_id, link.google_event_id).catch((error: unknown) => {
        if (!(error instanceof GoogleApiError) || error.kind !== "not_found") throw error;
      });
    }
    if (link) await admin.from("calendar_event_links").delete().match(linkKey);
    return;
  }

  // La persona lo borró en Google: se respeta
  if (link?.status === "user_deleted") return;

  const calendarId = await ensureCalendar(deps, connection, accessToken);
  if (link?.status === "active") {
    try {
      await patchEvent(accessToken, calendarId, link.google_event_id, desired);
    } catch (error) {
      if (error instanceof GoogleApiError && error.kind === "not_found") {
        // 404: ¿borró la persona solo el evento, o el calendario completo? Si falta el calendario, se recrea (lo maneja quien llama)
        if (!(await calendarExists(accessToken, calendarId))) throw error;
        await admin.from("calendar_event_links").update({ status: "user_deleted", updated_at: new Date().toISOString() }).match(linkKey);
        return;
      }
      throw error;
    }
    await admin.from("calendar_event_links").update({ updated_at: new Date().toISOString() }).match(linkKey);
    return;
  }

  // Sin vínculo: primero se busca por si un intento anterior sí lo creó (idempotencia) y luego se crea
  const key = sourceKey(job.source_type as SourceType, job.source_id);
  const existing = await findEventByKey(accessToken, calendarId, key);
  const googleEventId = existing ?? (await insertEvent(accessToken, calendarId, desired));
  if (existing) await patchEvent(accessToken, calendarId, existing, desired);
  await admin.from("calendar_event_links").upsert({ ...linkKey, google_event_id: googleEventId, status: "active", updated_at: new Date().toISOString() });
}

/** Marca la conexión como desconectada (el permiso se revocó), descarta su cola y le avisa a la persona. */
async function markDisconnected(deps: SyncDeps, userId: string, reason: string): Promise<void> {
  const { admin } = deps;
  await admin.from("calendar_connections").update({ status: "disconnected", last_error: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("user_id", userId);
  await admin.from("calendar_sync_jobs").delete().eq("user_id", userId);
  await admin.from("notifications").upsert(
    {
      user_id: userId,
      kind: "calendar_disconnected",
      title: "Google Calendar se desconectó",
      body: "INTERCEDE ya no puede escribir en tu Google Calendar. Vuelve a conectarlo desde tu perfil.",
      url: "/perfil",
      dedupe_key: `calendar-disconnected:${new Date().toISOString().slice(0, 10)}`,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

/** Procesa trabajos vencidos de la cola. Llamado por pg_cron (cada minuto) a través de `/api/calendar/sync`. */
export async function processCalendarJobs(deps: SyncDeps, limit = 20): Promise<SyncResult> {
  const { admin } = deps;
  const result: SyncResult = { processed: 0, retried: 0, dropped: 0, disconnected: 0 };
  const { data: jobs } = await admin.rpc("claim_calendar_jobs", { p_limit: limit });

  const byUser = new Map<string, Job[]>();
  for (const job of jobs ?? []) byUser.set(job.user_id, [...(byUser.get(job.user_id) ?? []), job]);

  for (const [userId, userJobs] of byUser) {
    const { data: connection } = await admin.from("calendar_connections").select("*").eq("user_id", userId).maybeSingle();
    if (!connection || connection.status !== "connected") {
      for (const job of userJobs) await admin.rpc("finish_calendar_job", { p_id: job.id });
      result.dropped += userJobs.length;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(deps.config, decryptSecret(connection.refresh_token_encrypted, userId, deps.key));
    } catch (error) {
      if (error instanceof GoogleApiError && error.kind === "auth") {
        await markDisconnected(deps, userId, "La persona revocó el permiso en Google");
        result.disconnected += 1;
        continue;
      }
      // Pasajero (red, límite de uso, error de Google) o llave ilegible: se reintenta con espera
      for (const job of userJobs) await admin.rpc("retry_calendar_job", { p_id: job.id, p_error: "No se pudo renovar el acceso", p_delay_seconds: retryDelaySeconds(job.attempts) });
      result.retried += userJobs.length;
      continue;
    }

    let stop = false;
    for (const job of userJobs) {
      if (stop) {
        await admin.rpc("retry_calendar_job", { p_id: job.id, p_error: "Pendiente", p_delay_seconds: 60 });
        continue;
      }
      try {
        try {
          await reconcile(deps, connection, accessToken, job);
        } catch (error) {
          // El calendario "INTERCEDE" ya no existe (la persona lo borró): se crea de nuevo una vez y se repite
          if (error instanceof GoogleApiError && error.kind === "not_found" && connection.calendar_id) {
            await ensureCalendar(deps, connection, accessToken, true);
            await reconcile(deps, connection, accessToken, job);
          } else {
            throw error;
          }
        }
        await admin.rpc("finish_calendar_job", { p_id: job.id });
        result.processed += 1;
      } catch (error) {
        if (error instanceof GoogleApiError && error.kind === "auth") {
          await markDisconnected(deps, userId, "Google rechazó el permiso");
          result.disconnected += 1;
          stop = true;
        } else if (error instanceof GoogleApiError && (error.kind === "rate" || error.kind === "transient")) {
          await admin.rpc("retry_calendar_job", { p_id: job.id, p_error: error.message, p_delay_seconds: retryDelaySeconds(job.attempts) });
          result.retried += 1;
          if (error.kind === "rate") stop = true;
        } else {
          // Error que reintentar no arregla: se descarta y se deja constancia
          await admin.from("calendar_connections").update({ last_error: (error instanceof Error ? error.message : "Error").slice(0, 300) }).eq("user_id", userId);
          await admin.rpc("finish_calendar_job", { p_id: job.id });
          result.dropped += 1;
        }
      }
    }
  }
  return result;
}

/**
 * Desconectar: revoca el permiso en Google y BORRA todo lo guardado (conexión cifrada, vínculos y cola). Los eventos ya creados quedan en
 * el calendario "INTERCEDE" de la persona (puede borrarlo desde Google). Se usa también al eliminar la cuenta.
 */
export async function disconnectGoogleCalendar(deps: Pick<SyncDeps, "admin" | "key">, userId: string): Promise<void> {
  const { admin } = deps;
  const { data: connection } = await admin.from("calendar_connections").select("refresh_token_encrypted").eq("user_id", userId).maybeSingle();
  if (connection) {
    try {
      await revokeToken(decryptSecret(connection.refresh_token_encrypted, userId, deps.key));
    } catch {
      // Si Google no responde, igual se borra lo nuestro: sin el token guardado ya no podemos usar el permiso
    }
  }
  await admin.from("calendar_sync_jobs").delete().eq("user_id", userId);
  await admin.from("calendar_event_links").delete().eq("user_id", userId);
  await admin.from("calendar_connections").delete().eq("user_id", userId);
}
