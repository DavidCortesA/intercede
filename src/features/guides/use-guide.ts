"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clockOffset, guideRunSchema, type GuideRun } from "./timer";

/**
 * Hora del servidor estimada en este dispositivo. Mide la diferencia con `get_server_time` (descontando la mitad del
 * tiempo de ida y vuelta, y quedándose con la medición más rápida) y la repite cada 5 minutos y al volver a la pestaña.
 * Devuelve una función: `serverNow()` ≈ hora del servidor en ms.
 */
export function useServerClock(): () => number {
  const offset = useRef(0);
  const bestRtt = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function measure() {
      const start = Date.now();
      const { data } = await supabase.rpc("get_server_time");
      const end = Date.now();
      if (cancelled || !data) return;
      const rtt = end - start;
      // Una medición con menos latencia es más fiable; cada cierto tiempo se vuelve a empezar para seguir el reloj real
      if (rtt <= bestRtt.current * 1.5) {
        offset.current = clockOffset(new Date(data).getTime(), start, end);
        bestRtt.current = Math.min(bestRtt.current, rtt);
      }
    }

    void measure();
    const again = setInterval(() => {
      bestRtt.current = Number.POSITIVE_INFINITY;
      void measure();
    }, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void measure();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return useCallback(() => Date.now() + offset.current, []);
}

/** La guía en curso de la sala, siempre al día por Realtime (solo llegan las filas que las políticas dejan leer). */
export function useGuideRun(roomId: string): GuideRun | null {
  const [run, setRun] = useState<GuideRun | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const apply = (row: unknown) => {
      const parsed = guideRunSchema.safeParse(row);
      if (!cancelled) setRun(parsed.success ? parsed.data : null);
    };
    const resync = async () => {
      const { data } = await supabase.from("room_guide_runs").select("*").eq("room_id", roomId).maybeSingle();
      apply(data);
    };

    const channel = supabase
      .channel(`guide:${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_guide_runs", filter: `room_id=eq.${roomId}` }, (payload) => apply(payload.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_guide_runs", filter: `room_id=eq.${roomId}` }, (payload) => apply(payload.new))
      // Los DELETE llegan sin filtro y solo con la llave primaria (límite de Realtime con RLS)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "room_guide_runs" }, (payload) => {
        if ((payload.old as { room_id?: string }).room_id === roomId && !cancelled) setRun(null);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void resync();
      });

    // Al volver la red o la pestaña se vuelve a leer: Realtime no reenvía lo perdido sin conexión
    const onBack = () => void resync();
    window.addEventListener("online", onBack);
    document.addEventListener("visibilitychange", onBack);
    void resync();

    return () => {
      cancelled = true;
      window.removeEventListener("online", onBack);
      document.removeEventListener("visibilitychange", onBack);
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  return run;
}
