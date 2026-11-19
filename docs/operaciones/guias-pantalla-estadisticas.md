# Guías, pantalla y estadísticas: operación

> Decisiones: `docs/decisions/0014-guias-pantalla-estadisticas-y-compartir.md`.

## 1. Migración
`npx supabase db push --remote` (previa aprobación) aplica `20261119200000_guides_display_and_stats.sql`. Después: `node scripts/security-audit.mjs --remote` debe salir sin hallazgos.
Crea las 4 guías del sistema (siempre disponibles, sin plan) y agrega `room_guide_runs` a la publicación de Realtime.

## 2. Guías de oración
- **En la sala** (anfitriona): *Iniciar una guía* → elegir → *Comenzar*. Pausar, siguiente, +1 minuto y terminar. Todos ven la cuenta regresiva; la campana es opcional y local.
- **Guías propias** (liderazgo, plan Plus/Pro): *Comunidades → Guías*. Para cambiar una, se borra y se crea otra.
- Quitar o editar una guía no afecta una sala que ya la está usando (la sesión guarda una copia).
- Para dar guías propias a una comunidad sin plan: poner `own_guides` en `true` en el plan o dar una suscripción (ver `docs/operaciones/facturacion.md`).

## 3. Pantalla de proyección
- *Pantalla* en los controles de la anfitriona → *Crear enlace de pantalla* → abrirlo en el equipo del proyector (navegador en pantalla completa).
- El enlace es **secreto**: quien lo tenga ve la petición en foco y las siguientes (sin nombres). *Crear uno nuevo* o *Desactivar* lo invalida.
- Se actualiza solo cada ~2,5 s y mantiene la pantalla encendida. Si pierde la conexión muestra "Reconectando…" y sigue.
- Para soporte, ver enlaces vigentes: `select r.code, d.created_at from room_display_links d join rooms r on r.id = d.room_id;` (el token no es necesario para soporte; no lo compartas).

## 4. Estadísticas
- *Comunidades → Estadísticas* (liderazgo, plan Plus/Pro). Descargar CSV: mismos agregados (lo oculto sale vacío).
- **Horas y participación en cero:** falta registrar el webhook de LiveKit (`/api/livekit/webhook`, ver `docs/operaciones/facturacion.md` §3).
- "Oculto" no es un error: hay menos de 5 personas ese periodo.

## 5. Compartir y calendario
- Compartir: no requiere configuración. El mensaje por WhatsApp es editable y nunca lleva peticiones.
- Google Calendar: es un enlace de plantilla (sin permisos). No hay nada que configurar en Google Cloud para este nivel.
