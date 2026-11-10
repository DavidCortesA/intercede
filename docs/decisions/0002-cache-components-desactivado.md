# 0002 — Cache Components y Partial Prefetching desactivados

- Estado: aceptada (2026-11-10)

## Contexto
`create-next-app@16.4.6` genera `cacheComponents: true` y `partialPrefetching: true`. Con `cacheComponents`, Next usa `<Activity>` para conservar rutas ocultas al navegar: se mantiene el estado pero los **efectos se limpian al ocultar la ruta y se recrean al mostrarla** (docs de `cacheComponents`).

## Decisión
Desactivarlos. INTERCEDE depende de efectos de larga vida (conexión LiveKit, suscripciones Realtime, Wake Lock) y de rutas totalmente dinámicas por sesión; el beneficio de PPR no compensa el riesgo. La landing sigue siendo estática (SSG con `generateStaticParams`).

## Consecuencias
Se puede reactivar más adelante evaluando por ruta (p. ej. solo marketing) cuando exista un caso medible. Hay que revisar la decisión antes de la Fase 4.
