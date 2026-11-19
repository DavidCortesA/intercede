"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  assignmentSchema,
  breakoutSchema,
  groupSchema,
  type Breakout,
  type BreakoutAssignment,
  type BreakoutGroup,
} from "./logic";

export interface BreakoutState {
  breakout: Breakout | null;
  groups: BreakoutGroup[];
  /** Lo que esta persona puede ver: el suyo y quienes comparten su grupo (la anfitriona, todos). */
  assignments: BreakoutAssignment[];
}

const EMPTY: BreakoutState = { breakout: null, groups: [], assignments: [] };

/**
 * El reparto en grupos pequeños de la sala, siempre al día. Cualquier cambio (inicio, aviso, fin) dispara una relectura:
 * son pocas filas y así nunca quedan a medias (el reparto y sus grupos se escriben juntos). Las políticas de la base
 * deciden qué llega a cada persona; Realtime las respeta.
 */
export function useBreakout(roomId: string): BreakoutState {
  const [state, setState] = useState<BreakoutState>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    async function resync() {
      const supabase = createClient();
      const { data: row } = await supabase
        .from("room_breakouts")
        .select("*")
        .eq("room_id", roomId)
        .eq("status", "active")
        .maybeSingle();
      const breakout = breakoutSchema.safeParse(row);
      if (!breakout.success) return setState(EMPTY);
      const [groupsRes, assignmentsRes] = await Promise.all([
        supabase
          .from("breakout_groups")
          .select("*")
          .eq("breakout_id", breakout.data.id)
          .order("position"),
        supabase
          .from("breakout_assignments")
          .select("*")
          .eq("breakout_id", breakout.data.id),
      ]);
      setState({
        breakout: breakout.data,
        groups: z
          .array(groupSchema)
          .catch([])
          .parse(groupsRes.data ?? []),
        assignments: z
          .array(assignmentSchema)
          .catch([])
          .parse(assignmentsRes.data ?? []),
      });
    }

    // Varios eventos seguidos (reparto + grupos + asignaciones) se juntan en una sola relectura
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!cancelled) void resync();
      }, 150);
    };

    const channel = supabase
      .channel(`breakout:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_breakouts",
          filter: `room_id=eq.${roomId}`,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "breakout_groups" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "breakout_assignments" },
        schedule,
      )
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
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", onBack);
      document.removeEventListener("visibilitychange", onBack);
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  return state;
}
