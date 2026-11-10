# 0009 — Cuentas, diario, "estoy orando por esto" y perfil (Fase 5)

- Estado: aceptada (2026-11-10)

## Cuentas
- **Un invitado se convierte en cuenta, no se crea otro usuario.** `signUpAction` detecta la sesión anónima y llama a `updateUser({ email, password })`: Supabase envía el correo de confirmación y, al confirmarlo, el **mismo `id`** pasa a ser permanente. Por eso el historial de salas se conserva. Se verificó de punta a punta (sala como invitada → cuenta → la sala sigue en "Mis salas", también tras salir y volver a entrar).
- Entrar a una cuenta que ya existe **no une** lo hecho como invitado (los ids son distintos); la pantalla de entrar lo avisa.
- **Enlaces de correo:** `/auth/confirm` acepta `token_hash` + `type` (plantillas propias en `supabase/templates`, verificación en el servidor: funciona aunque se abra el correo en otro dispositivo) y, como respaldo, `code` (flujo PKCE de las plantillas por defecto, solo en el mismo navegador). `?next=` solo admite rutas internas (`safeNextPath`: nada de dominios, `//` ni esquemas) y hay pruebas contra *open redirect*. El proxy excluye `/auth/*` para que el middleware de idiomas no los reescriba.
- **Recuperar contraseña:** la respuesta no revela si el correo tiene cuenta. El enlace abre una sesión de recuperación y `/restablecer` pide la nueva contraseña (8–72 caracteres, límite de bcrypt).
- **Google:** botón "Continuar con Google" (inicia sesión o, si es invitado, `linkIdentity` sobre el mismo usuario; requiere `enable_manual_linking`, ya aplicado). Solo se muestra con `NEXT_PUBLIC_GOOGLE_AUTH=1` para no ofrecer un botón que no funcione. Se verificó que el proveedor remoto redirige a `accounts.google.com` con el `client_id` y la URI de redirección de Supabase; **el inicio de sesión completo con una cuenta de Google no se probó** (requiere consentimiento interactivo). Fase 6: la bandera `NEXT_PUBLIC_GOOGLE_AUTH=1` ya está activa en `.env.local` (poner también en Vercel al desplegar) y el botón respeta `?next=`.
- Navegación progresiva (CLAUDE.md §8.4): invitados ven *Orar* y *Perfil*; con cuenta aparecen *Diario* y *Salas*.

## Diario de oración (`prayer_journal_entries`)
- **Privado y solo para cuentas permanentes, forzado en la base**: la política de inserción exige `is_permanent_user()` (claim `is_anonymous` del JWT). Un invitado recibe `42501` aunque use la API directamente.
- Categorías simples (familia, salud, trabajo, finanzas, fe, otro), estado *en oración / respondida*, testimonio, edición y borrado con confirmación, filtros. Una petición de la sala se puede **guardar en el diario** (`source_request_id`, único por persona; solo si la persona puede leerla con RLS); si la petición se borra, la entrada se conserva.
- Tope de 1000 entradas por persona.

## "Estoy orando por esto" (`prayer_support`)
- Una fila por persona y petición (PK compuesta). Solo en peticiones **ajenas** y solo quien **está en la sala**; el conteo lo ve únicamente la sala. `room_id` lo completa un trigger desde la petición y se guarda en la fila para poder filtrar en Realtime y evaluar RLS sin joins. Los DELETE de Realtime no se pueden filtrar, pero traen la clave primaria completa (petición + persona), suficiente para quitar el apoyo.
- Quien escribió la petición ve cuántas personas oran por ella ("N personas oran por esto").

## Perfil y avatares
- Nombre y zona horaria (se validan contra `Intl`/`pg_timezone_names`; botón "usar la de mi dispositivo", porque los perfiles nuevos parten de UTC). **El selector de idioma no se muestra todavía**: solo existe español.
- **Avatares en Storage** (`avatars`, público, 1 MB, solo WEBP/PNG/JPEG): la foto se recorta a 256 px en el navegador y se sube a `avatars/<id>/…`. Las políticas solo dejan escribir en la carpeta propia y solo a cuentas. **`profiles.avatar_url` solo puede apuntar a la carpeta propia del almacenamiento** (CHECK): si no, alguien podría poner una URL externa y rastrear a quien ve su foto en una sala. El avatar se **copia a `room_members.avatar_url`** al crear o entrar a una sala (`profiles` sigue siendo privado).
- Historial de salas (`/salas`): salas en las que la persona participó (RLS), con "volver a entrar" si siguen abiertas.

## Límites y pendientes
- **Correo en el proyecto remoto.** El plan gratuito con el SMTP por defecto de Supabase **no permite plantillas propias** (`config push` responde 400) y, además, limita el envío (pocos correos por hora y solo a miembros del equipo). Para registrarse de verdad en producción hay que configurar un **SMTP propio** (Resend con un dominio verificado; hay `RESEND_API_KEY`) y entonces subir las plantillas. Mientras tanto el remoto usa las plantillas por defecto en inglés y `/auth/confirm` acepta su enlace (`?code=`). En local y en el CI las plantillas en español funcionan y se prueban con Mailpit.
- **Eliminar cuenta y datos** sigue en la Fase 8 (todo cae en cascada al borrar `auth.users`).
- Unir un invitado con una cuenta existente (fusión de historiales) no está soportado.
- Compartir una entrada del diario en una sala y "salas favoritas" quedan fuera de esta fase.

## Pruebas
- DB (16): diario (privado, invitados denegados, validaciones, testimonio, columnas protegidas, guardar desde sala), "orando por esto" (reglas, conteo, cascada), avatares (URL propia, copia a la sala, Storage por carpeta, tipo y tamaño).
- Unitarias: `safeNextPath`, errores de Auth y validaciones.
- E2E con Mailpit (10): crear cuenta con correo, convertir invitado conservando historial, recuperar contraseña, enlaces inválidos y redirecciones seguras, rutas protegidas con `?next=`, diario completo y privacidad, apoyo en vivo + guardar en el diario, perfil con foto visible en la sala y axe (claro/oscuro) de las pantallas de cuenta. `/entrar`, `/registro`, `/recuperar` y `/restablecer` pasan axe.
