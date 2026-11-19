"use client";

import { useEffect, useState } from "react";
import { useServerClock } from "@/features/guides/use-guide";

/** Hora del servidor estimada, refrescada cada `intervalMs` (por defecto 1 s). Sirve para decidir cuándo vuelven los grupos. */
export function useServerNow(intervalMs = 1000): number {
  const serverNow = useServerClock();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [serverNow, intervalMs]);
  return now;
}
