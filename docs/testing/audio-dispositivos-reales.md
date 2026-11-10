# Audio: lista de verificación en dispositivos reales

Las pruebas automáticas usan Chromium de escritorio con micrófonos simulados. Esto es lo que **no**
cubren y debe probarse a mano antes del lanzamiento (CLAUDE.md §6). Marca cada punto y anota el
dispositivo y la versión.

Preparación: dos dispositivos (uno puede ser una computadora), una sala creada por uno y el enlace
abierto en el otro. Usa la app instalada en la pantalla de inicio **y** el navegador normal.

## iPhone / iPad (Safari, iOS 16.4+)
- [ ] "Orar con micrófono": aparece el aviso de permiso **solo** al tocar el botón (no al cargar).
- [ ] Se oye la otra persona sin tocar nada más ("Activar el sonido" solo si Safari lo bloquea).
- [ ] "Solo escuchar" no pide ningún permiso.
- [ ] Bloquear la pantalla 30 s: ¿se oye / se corta el audio? Anota el comportamiento. La pantalla no debe apagarse sola mientras la sala está abierta (Wake Lock).
- [ ] Cambiar a otra app y volver: el audio se recupera y la sala se actualiza.
- [ ] Cambiar de WiFi a datos móviles: aparece "Reconectando…" y vuelve sin recargar.
- [ ] Permiso del micrófono denegado: el mensaje explica cómo activarlo y la sala sigue funcionando.
- [ ] Con auriculares Bluetooth: entra y sale el audio sin eco.

## Android (Chrome)
- [ ] Los mismos puntos de arriba.
- [ ] Notificación de "micrófono en uso" visible mientras se habla.
- [ ] Llamada telefónica entrante durante la sala: al terminar, ¿se recupera el micrófono?
- [ ] Modo ahorro de batería activado: ¿la pantalla se mantiene encendida?

## Computadora (Chrome, Edge, Firefox, Safari)
- [ ] Sin micrófono conectado: mensaje claro, la sala sigue.
- [ ] Micrófono ocupado por otra app (p. ej. otra videollamada): mensaje "Otra aplicación está usando tu micrófono".
- [ ] Abrir la sala en una segunda pestaña con la misma persona: la primera avisa que entró desde otro dispositivo.

## Anfitrión
- [ ] Silenciar a una persona: su micrófono se apaga y ve el estado "silenciado".
- [ ] Silenciar a todos: el anfitrión sigue hablando.
- [ ] Sacar a alguien: queda fuera del audio y de la sala, y no puede volver con el enlace.
- [ ] Cerrar la sala: todas las personas quedan fuera del audio y ven "La sala se cerró".
- [ ] Sala con 20 personas: calidad de audio aceptable y sin cortes.
