"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendHostCommand } from "@/features/audio/api";
import type { TablesInsert } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { toRoomError, type RoomErrorCode } from "./errors";
import type { PrayerRequest, PrayerSupport, Room, RoomMember } from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting";

interface Initial {
  room: Room;
  members: RoomMember[];
  requests: PrayerRequest[];
  support: PrayerSupport[];
}

const sameSupport = (a: Pick<PrayerSupport, "request_id" | "user_id">, b: Pick<PrayerSupport, "request_id" | "user_id">) =>
  a.request_id === b.request_id && a.user_id === b.user_id;

function addSupport(list: PrayerSupport[], next: PrayerSupport): PrayerSupport[] {
  return list.some((s) => sameSupport(s, next)) ? list : [...list, next];
}

const byNewest = (a: PrayerRequest, b: PrayerRequest) => b.created_at.localeCompare(a.created_at);

function upsertRequest(list: PrayerRequest[], next: PrayerRequest): PrayerRequest[] {
  return [...list.filter((r) => r.id !== next.id), next].sort(byNewest);
}

function upsertMember(list: RoomMember[], next: RoomMember): RoomMember[] {
  return [...list.filter((m) => m.user_id !== next.user_id), next];
}

/**
 * Estado en vivo de la sala. Parte de los datos que el servidor ya leyó y los mantiene al día
 * con Supabase Realtime (RLS aplica: solo llega lo que la persona puede leer).
 *
 * Cuidados de robustez:
 *  - Al quedar suscrita (y al volver la red o la pestaña) vuelve a leer todo: Realtime puede
 *    tardar un instante en registrar la suscripción y no reenvía lo perdido sin conexión.
 *  - Los DELETE llegan sin filtro y solo con la clave primaria (límite de Realtime con RLS).
 */
export function useRoomLive(initial: Initial) {
  const [supabase] = useState(() => createClient());
  const roomId = initial.room.id;

  const [room, setRoom] = useState(initial.room);
  const [members, setMembers] = useState(initial.members);
  const [requests, setRequests] = useState(initial.requests);
  const [support, setSupport] = useState(initial.support);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<RoomErrorCode | null>(null);

  // Ids borrados aquí o por Realtime: una relectura lenta no debe "resucitarlos".
  const deletedRef = useRef(new Set<string>());

  const resync = useCallback(async () => {
    // Una relectura puede resolverse DESPUÉS de que llegó un evento más nuevo. Por eso se fusiona
    // en vez de reemplazar: se conserva lo local que se creó mientras leíamos (margen de 15 s
    // por posibles diferencias de reloj) y las salas cerradas no se "reabren".
    const startedAt = new Date(Date.now() - 15_000).toISOString();
    const [roomRes, membersRes, requestsRes, supportRes] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase.from("room_members").select("*").eq("room_id", roomId),
      supabase.from("prayer_requests").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(200),
      supabase.from("prayer_support").select("*").eq("room_id", roomId),
    ]);
    // Al volver de un corte, "orando por esto" se reemplaza por lo leído (es un conjunto, sin orden)
    if (supportRes.data) setSupport(supportRes.data);
    const fetchedRoom = roomRes.data;
    if (fetchedRoom) setRoom((current) => (current.status === "closed" ? current : fetchedRoom));
    const fetchedMembers = membersRes.data;
    if (fetchedMembers) {
      setMembers((current) => {
        const ids = new Set(fetchedMembers.map((m) => m.user_id));
        return [...current.filter((m) => !ids.has(m.user_id)), ...fetchedMembers];
      });
    }
    const fetchedRequests = requestsRes.data;
    if (fetchedRequests) {
      setRequests((current) => {
        const ids = new Set(fetchedRequests.map((r) => r.id));
        const recentLocal = current.filter((r) => !ids.has(r.id) && r.created_at >= startedAt);
        return [...fetchedRequests, ...recentLocal].filter((r) => !deletedRef.current.has(r.id)).sort(byNewest);
      });
    }
  }, [supabase, roomId]);

  // Siempre la versión más reciente de resync dentro de los listeners
  const resyncRef = useRef(resync);
  useEffect(() => {
    resyncRef.current = resync;
  }, [resync]);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "prayer_requests", filter: `room_id=eq.${roomId}` },
        (payload) => setRequests((list) => upsertRequest(list, payload.new as PrayerRequest)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "prayer_requests", filter: `room_id=eq.${roomId}` },
        (payload) => setRequests((list) => upsertRequest(list, payload.new as PrayerRequest)),
      )
      // Sin filtro: Realtime no puede filtrar DELETE; solo traen el id, que ignoramos si no es nuestro.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "prayer_requests" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        deletedRef.current.add(id);
        setRequests((list) => list.filter((r) => r.id !== id));
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "prayer_support", filter: `room_id=eq.${roomId}` },
        (payload) => setSupport((list) => addSupport(list, payload.new as PrayerSupport)),
      )
      // Sin filtro (Realtime no filtra DELETE); la clave primaria (petición + persona) basta para quitarlo
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "prayer_support" }, (payload) => {
        const old = payload.old as Partial<PrayerSupport>;
        if (old.request_id && old.user_id) {
          const gone = { request_id: old.request_id, user_id: old.user_id };
          setSupport((list) => list.filter((s) => !sameSupport(s, gone)));
        }
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setMembers((list) => upsertMember(list, payload.new as RoomMember));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => setRoom(payload.new as Room),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("live");
          void resyncRef.current();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("reconnecting");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

  useEffect(() => {
    const syncOnline = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void resyncRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void resyncRef.current();
    };
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const run = useCallback(async <T>(task: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>) => {
    setError(null);
    try {
      const { data, error: failure } = await task();
      if (failure) {
        setError(toRoomError(failure));
        return null;
      }
      return data;
    } catch {
      setError("network");
      return null;
    }
  }, []);

  const actions = useMemo(
    () => ({
      async postRequest(content: string): Promise<boolean> {
        const row = await run(() => supabase.from("prayer_requests").insert({ room_id: roomId, content }).select().single());
        if (row) setRequests((list) => upsertRequest(list, row));
        return row !== null;
      },
      async setAnswered(id: string, isAnswered: boolean, testimony: string | null): Promise<boolean> {
        const row = await run(() =>
          supabase
            .from("prayer_requests")
            .update({ is_answered: isAnswered, testimony: isAnswered ? testimony || null : null })
            .eq("id", id)
            .select()
            .single(),
        );
        if (row) setRequests((list) => upsertRequest(list, row));
        return row !== null;
      },
      async removeRequest(id: string): Promise<boolean> {
        const rows = await run(() => supabase.from("prayer_requests").delete().eq("id", id).select("id"));
        if (rows && rows.length > 0) {
          deletedRef.current.add(id);
          setRequests((list) => list.filter((r) => r.id !== id));
        }
        return rows !== null;
      },
      /** "Estoy orando por esto": alterna el apoyo de la persona a una petición ajena. */
      async toggleSupport(requestId: string, meId: string, on: boolean): Promise<boolean> {
        if (on) {
          // room_id lo completa un trigger de la base a partir de la petición
          const row = await run(() =>
            supabase.from("prayer_support").insert({ request_id: requestId } as TablesInsert<"prayer_support">).select().single(),
          );
          if (row) setSupport((list) => addSupport(list, row));
          return row !== null;
        }
        const rows = await run(() => supabase.from("prayer_support").delete().eq("request_id", requestId).eq("user_id", meId).select("request_id"));
        if (rows) setSupport((list) => list.filter((s) => !(s.request_id === requestId && s.user_id === meId)));
        return rows !== null;
      },
      /** Copia una petición de la sala al diario (solo cuentas; una vez por petición). */
      async saveToJournal(request: PrayerRequest): Promise<boolean> {
        setError(null);
        const { error: failure } = await supabase
          .from("prayer_journal_entries")
          .insert({ content: request.content, source_request_id: request.id });
        // 23505: ya estaba guardada: para quien la guardó es lo mismo que haberlo logrado
        if (failure && failure.code !== "23505") {
          setError(toRoomError(failure));
          return false;
        }
        return true;
      },
      async setLocked(locked: boolean): Promise<boolean> {
        const res = await run(async () => ({ ...(await supabase.rpc("set_room_locked", { p_room_id: roomId, p_locked: locked })), data: true }));
        if (res) setRoom((r) => ({ ...r, is_locked: locked }));
        return res !== null;
      },
      async closeRoom(): Promise<boolean> {
        // Pasa por el servidor: además de cerrar la sala en la base, desconecta a todas las
        // personas del audio (un token vigente no se anula solo).
        setError(null);
        const res = await sendHostCommand({ action: "close", roomId });
        if (!res.ok) {
          setError(res.error === "network" ? "network" : res.error === "not_host" ? "not_host" : "generic");
          return false;
        }
        setRoom((r) => ({ ...r, status: "closed", closed_at: new Date().toISOString() }));
        return true;
      },
      async leave(): Promise<boolean> {
        const res = await run(async () => ({ ...(await supabase.rpc("leave_room", { p_room_id: roomId })), data: true }));
        return res !== null;
      },
      clearError: () => setError(null),
    }),
    [supabase, roomId, run],
  );

  return { room, members, requests, support, connection, online, error, actions };
}
