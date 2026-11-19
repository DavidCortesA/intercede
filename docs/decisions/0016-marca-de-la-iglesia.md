# 0016 — Marca de la iglesia, sin subdominio (Fase 11, B6)

- Estado: aceptada (2026-11-20)
- Alcance: CLAUDE.md §16 **B6**, plan **Pro**. **Decisión del propietario:** *marca sin subdominio por ahora*. Quedan **fuera** el subdominio `nombre.intercede.app`, su resolución por middleware, la lista de nombres reservados para subdominios y el aislamiento de sesiones/cookies entre subdominios (la decisión técnica que §16.5 deja abierta). Cuando se retome hará falta un dominio propio con DNS comodín en Vercel y una decisión de cookies (separadas por subdominio vs. compartidas).

## Qué incluye
- **Nombre visible** (opcional, hasta 40 letras) y **color de acento** de la comunidad, en sus **páginas** (encabezado y pestañas) y en sus **salas** (franja con logo y nombre en el encabezado), con **"Con tecnología de INTERCEDE" siempre visible**. El logo es el que ya sube la administración.
- **La app instalable sigue siendo la de INTERCEDE** (manifiesto y íconos no cambian; prueba e2e).
- Se configura en *Ajustes → Marca de tu comunidad* (administración). En planes que no son Pro la sección solo explica el plan.

## Modelo y seguridad
- **Tabla propia `community_brands`, solo escritura por RPC** (`set_community_brand`, `clear_community_brand`). Una columna en `communities` se habría saltado el plan y las reglas, porque la administración actualiza esa tabla directamente desde los ajustes.
- **Plan:** `set_community_brand` exige `plans.limits.branding` (Pro). **Si el plan termina, la marca deja de aplicarse** (`community_brand` devuelve nulo) pero queda guardada y reaparece al volver; quitarla siempre se puede.
- **Contraste AA (4.5:1), regla de la base.** El acento se compara contra el **crema del fondo claro (#FBF5EA)**, la base más exigente (si pasa contra el crema, pasa contra el blanco de los botones). La fórmula (luminancia relativa WCAG) está en `accent_contrast_ok` y en `src/features/brand/contrast.ts`; **una prueba compara ambas con 40 colores**. Un color que no pasa se **rechaza en la base** (`low_contrast`, y además una restricción CHECK de la tabla que ni la service role se salta). La interfaz **lo oscurece de a poco** conservando el tono y lo muestra en una vista previa antes de guardar ("Lo oscurecimos a #…"): así lo que se envía ya pasa. El dorado y el cian de la marca INTERCEDE, por ejemplo, no pasan sobre blanco (CLAUDE.md §8.2) y se oscurecen.
- **Anti-suplantación del nombre:** se compara sin acentos, mayúsculas ni signos. Se rechaza cualquier nombre que **contenga "intercede"** (`reserved_name`) y el que **coincida con el nombre de otra comunidad o con el nombre visible de otra** (`name_taken`; índice único + comprobación). *Compromiso:* el rechazo `name_taken` revela que existe una comunidad con ese nombre (las comunidades son privadas, pero sus nombres no son secretos); es necesario para el objetivo.
- **Quién la ve:** solo las personas de la comunidad (`community_brand` y RLS de la tabla); quien no es de ella no recibe nada. El color llega a la página como una variable CSS ya validada (`#rrggbb`), nunca como texto libre.

## Cómo se aplica el color
- Un contenedor `data-brand` define `--brand-accent`; una regla de `globals.css` hace que, dentro, `bg-brand-gradient` (botones primarios y pestañas activas, siempre con texto blanco) use el acento en vez del degradado violeta-azul. En pantallas **claras** también reemplaza el color de los **enlaces** (`--primary-text`); en la sala **oscura** no se toca el color del texto (el acento podría no leerse sobre azul marino): ahí solo hay botones y una franja.

## No incluido / límites
- Sin subdominio ni dominio propio; sin marca en las pantallas de invitación (`/c/<enlace>`, para quien aún no es de la comunidad) ni en la pantalla de entrada a la sala (solo quienes ya son de la comunidad ven la marca, que es lo que la base permite).
- Un solo color de acento (sin paleta secundaria ni tipografías propias). El logo se sube en Ajustes como siempre.

## Pruebas
- Base de datos (9): fórmula igual a la de la interfaz, plan y administración, color (formato y contraste, normalización), escritura directa bloqueada (incluida la service role), nombres reservados y repetidos (sin importar acentos), visibilidad por comunidad, fin del plan Pro, quitar la marca y borrado en cascada.
- Unitarias (5): luminancia y contraste conocidos, colores de la marca, normalización y ajuste de colores claros (conservando el tono).
- E2E (6): sin Pro no hay formulario; un color claro se oscurece y la vista previa pasa AA; las páginas y las salas llevan nombre, acento y "Con tecnología de INTERCEDE"; una comunidad sin marca y una sala personal no cambian; el manifiesto sigue siendo INTERCEDE; nombre suplantador y color ilegible rechazados; fin del plan y quitar la marca.
