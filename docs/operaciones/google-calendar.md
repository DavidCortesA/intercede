# Google Calendar: configuración y operación

Sincronización automática INTERCEDE → Google (CLAUDE.md §16.3, C6 nivel 2). Diseño y razones: [ADR 0018](../decisions/0018-google-calendar-sincronizacion.md). Mientras `NEXT_PUBLIC_GOOGLE_CALENDAR` no valga `1`, la opción **no se muestra** en el perfil; el botón "Agregar a Google Calendar" (nivel 1) funciona siempre.

## 1. Google Cloud (lo haces tú)
Se reutiliza el mismo proyecto y cliente OAuth del inicio de sesión (`NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
1. **APIs y servicios → Biblioteca → Google Calendar API → Habilitar.**
2. **Pantalla de consentimiento OAuth → Acceso a los datos → Agregar o quitar permisos:** añade `.../auth/calendar.app.created` (es el único que se pide).
3. **Credenciales → tu ID de cliente OAuth → URI de redirección autorizados:** añade `https://<tu-dominio>/api/calendar/google/callback` (hoy `https://intercede-six.vercel.app/api/calendar/google/callback`). Es independiente de la URI de Supabase.
4. Mientras la app esté en **modo de pruebas**: agrega las cuentas que probarán como **usuarios de prueba** (los tokens de actualización de apps en pruebas **caducan a los 7 días**: es normal, la persona verá "se desconectó" y vuelve a conectar).
5. Para abrirlo a cualquier persona hay que **publicar la app y, por ser un permiso sensible, pasar la verificación de Google** (política de privacidad pública —ya existe en `/privacidad`—, dominio verificado, video de demostración). Decide cuándo iniciarla; puede tardar semanas.

## 2. Variables de entorno (Vercel, solo servidor salvo la bandera)
| Variable | Valor |
|---|---|
| `CALENDAR_ENCRYPTION_KEY` | 32 bytes en base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Guárdala bien**: sin ella no se pueden descifrar las conexiones. |
| `CALENDAR_SYNC_SECRET` | Texto aleatorio largo (el mismo que en Vault). |
| `NEXT_PUBLIC_GOOGLE_CALENDAR` | `1` cuando todo lo demás esté listo (necesita un redeploy: es de compilación). |

## 3. Supabase
Aplica la migración `20261121200000_google_calendar_sync.sql` (`npx supabase db push --linked`). Después, en el SQL editor (o `db query --remote`), los secretos de Vault que usa el cron `calendar-sync` (cada minuto):
```sql
select vault.create_secret('https://<tu-dominio>/api/calendar/sync', 'calendar_sync_url');
select vault.create_secret('<el mismo CALENDAR_SYNC_SECRET>', 'calendar_sync_secret');
```
Sin ellos el cron no llama a nada (la cola se acumula y se procesa al configurarlos).

## 4. Prueba real (hazla antes de abrirlo)
1. Con una cuenta de prueba: Perfil → **Conectar Google Calendar** → acepta el permiso. Debe volver con "Listo: conectamos tu Google Calendar".
2. Confirma asistencia a un evento de una comunidad → en 1–2 minutos aparece en el calendario **INTERCEDE** de Google con enlace y recordatorio de 10 min.
3. Cambia la fecha del evento → se actualiza. Cancela la asistencia → desaparece.
4. Borra el evento en Google y cambia algo del evento en INTERCEDE → **no** reaparece.
5. **Desconectar** → en myaccount.google.com/permissions desaparece INTERCEDE.

## Operación
- Estado de la cola: `select status, count(*) from calendar_connections group by 1;` y `select * from calendar_sync_jobs order by run_after;` (con la service role). Un trabajo con muchos intentos se descarta a los 6.
- `calendar_connections.last_error` guarda el último problema (sin datos personales).
- Una persona sin conexión válida no recibe nada; sus trabajos pendientes se descartan.
- **No** se registran en ningún log los tokens ni el contenido de los eventos.
