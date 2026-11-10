# Avisos en dispositivos reales (lista de verificación)

Las pruebas automáticas cubren la base de datos, la lógica de envío, la Edge Function (en el runtime de Supabase),
el service worker (push entregado por CDP) y las pantallas. **No pueden probar** el viaje por FCM/APNs hasta un
teléfono ni el correo real. Haz esta lista una vez con el proyecto remoto configurado (`docs/operaciones/avisos.md`).

Para cada dispositivo: cuenta con correo confirmado, y *Perfil → Avisos y recordatorios → Activar avisos*.

## Android (Chrome)
- [ ] Al tocar *Activar avisos* aparece el permiso del navegador (no antes) y queda "activados".
- [ ] Programa una sala para dentro de ~15 minutos con aviso previo de 10: llega el recordatorio y, a la hora, el aviso de inicio.
- [ ] Tocar la notificación abre la sala (`/es/r/…`) o *Mis programadas*, con la app cerrada y con ella abierta.
- [ ] Con la pantalla bloqueada el aviso se muestra.
- [ ] Desactivar los avisos en ese dispositivo y comprobar que ya no llegan.

## iPhone / iPad (Safari, iOS 16.4+)
- [ ] En Safari (sin instalar) la pantalla explica que hay que *Añadir a pantalla de inicio* y **no** ofrece activar.
- [ ] Instalada la app, abierta desde el icono, *Activar avisos* pide el permiso y se activa.
- [ ] Llegan el recordatorio y el aviso de inicio; tocar la notificación abre la sala.

## Escritorio (Chrome / Edge / Firefox)
- [ ] Igual que Android; además, con el navegador cerrado de fondo (si el sistema lo permite) llega el aviso.

## Cuentas y dispositivos
- [ ] Cerrar sesión y entrar con otra cuenta en el mismo navegador: los avisos de la cuenta anterior **ya no llegan** ahí
      (el dispositivo se reasigna a la nueva al activar).
- [ ] Revocar el permiso desde el navegador: la pantalla lo detecta ("Bloqueaste los avisos…") y el envío siguiente borra el dispositivo.

## Correo (cuando haya dominio verificado en Resend)
- [ ] Activar *Recibirlos también por correo* y recibir el aviso con el enlace correcto; el enlace de "cambiar tus avisos" abre la pantalla.
- [ ] Con `RESEND_FROM` sin configurar, el aviso queda con `email_state = 'skipped'` (no falla).

## Devocional
- [ ] Con un devocional cargado para hoy: el recordatorio llega a la hora elegida **en la zona horaria del perfil**, una sola vez,
      y no llega si ya lo leíste.

Anota los resultados (dispositivo, versión del sistema, navegador) en el PR o en este archivo.
