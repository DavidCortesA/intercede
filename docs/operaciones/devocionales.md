# Cargar devocionales

INTERCEDE **no trae contenido bíblico ni devocionales**: quien administra la plataforma los carga. Antes de cargar, decide
la **versión bíblica y su licencia** (una de dominio público, como Reina-Valera 1909, o una licenciada) y el origen de las
reflexiones. El campo `bible_version` se muestra tal cual en la pantalla.

## Formato del archivo

Un arreglo JSON con un objeto por día. `date` es el día en que se publica (AAAA-MM-DD): cada persona ve el de **su** fecha
local (según su zona horaria del perfil).

```json
[
  {
    "date": "2027-01-01",
    "passage_reference": "Libro 1:1-3",
    "passage_text": "Texto del pasaje (hasta 2000 caracteres).",
    "bible_version": "Nombre de la versión",
    "reflection": "Reflexión breve (hasta 4000 caracteres).",
    "question": "Pregunta de aplicación (hasta 500 caracteres).",
    "suggested_prayer": "Oración sugerida (opcional, hasta 1000 caracteres)."
  }
]
```

Reglas: todos los campos de texto son obligatorios salvo `suggested_prayer`; no puede haber fechas repetidas en el archivo;
máximo 1000 devocionales por carga.

## Cargar

```bash
npm run devotionals:import -- devocionales.json --dry-run
```

Solo valida el archivo (no toca ninguna base). Luego:

```bash
npm run devotionals:import -- devocionales.json
```

Carga en el Supabase **local**. Para el proyecto **remoto** (usa `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de
`.env.local`; compruébalo dos veces antes):

```bash
npm run devotionals:import -- devocionales.json --remote
```

Si ya existe un devocional general para una fecha, **se actualiza**; si no, se crea. Requiere Node ≥ 22.18 (el script
importa el esquema en TypeScript con la eliminación de tipos de Node; en Node 24 funciona sin banderas).

## Recordatorio diario

Quien lo active en *Perfil → Avisos y recordatorios* recibe un aviso a la hora que elija (en **su** zona horaria) si ese día
hay devocional y aún no lo ha leído.
