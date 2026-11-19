-- Fase 11 — Marca de la iglesia (CLAUDE.md §16 B6, plan Pro). SIN subdominio: la decisión del propietario fue dejarlo para después
-- (sesiones y cookies entre subdominios sin resolver), así que aquí solo hay nombre visible y color de acento.
--
-- Principios:
--   * La marca vive en su PROPIA tabla y solo se escribe por RPC: la administración actualiza `communities` directamente (ajustes), y
--     una columna ahí se saltaría el plan y las reglas de contraste.
--   * El color de acento debe tener contraste AA (4.5:1) contra el crema del fondo claro (y por tanto contra blanco): la base lo
--     comprueba con la MISMA fórmula que la interfaz (WCAG). Si no pasa, se rechaza; la interfaz lo oscurece antes de enviarlo.
--   * El nombre visible no puede suplantar a INTERCEDE ni a otra comunidad (se compara sin acentos, mayúsculas ni signos).
--   * Si el plan Pro termina, la marca deja de aplicarse (queda guardada para cuando vuelva).

-- ───────────────────────── Contraste (WCAG) ─────────────────────────

-- Luminancia relativa de un color #rrggbb
create function public.hex_luminance(p_hex text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  v double precision[3];
  i int;
  c double precision;
begin
  for i in 0 .. 2 loop
    c := (('x' || pg_catalog.substr(p_hex, 2 + i * 2, 2))::bit(8)::int)::double precision / 255.0;
    v[i + 1] := case when c <= 0.03928 then c / 12.92 else pg_catalog.power((c + 0.055) / 1.055, 2.4) end;
  end loop;
  return 0.2126 * v[1] + 0.7152 * v[2] + 0.0722 * v[3];
end;
$$;

-- ¿Pasa AA contra el crema del fondo claro (#FBF5EA)? Es la más exigente de las dos bases (crema y blanco).
create function public.accent_contrast_ok(p_hex text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_hex ~ '^#[0-9a-f]{6}$'
    and (public.hex_luminance('#fbf5ea') + 0.05) / (public.hex_luminance(p_hex) + 0.05) >= 4.5;
$$;

-- Nombre sin acentos, mayúsculas ni signos (para comparar y evitar suplantaciones)
create function public.normalize_brand_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(coalesce(p_name, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'), '[^a-z0-9]', '', 'g');
$$;

-- ───────────────────────── Tabla ─────────────────────────

create table public.community_brands (
  community_id uuid primary key references public.communities (id) on delete cascade,
  -- Nombre que se muestra en las páginas y salas de la comunidad (nulo = el nombre de la comunidad)
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  accent       text not null check (accent ~ '^#[0-9a-f]{6}$' and public.accent_contrast_ok(accent)),
  updated_at   timestamptz not null default now()
);

-- Dos comunidades no pueden mostrar el mismo nombre
create unique index community_brands_name_unique on public.community_brands (public.normalize_brand_name(display_name)) where display_name is not null;

comment on table public.community_brands is 'Marca de una comunidad con plan Pro (nombre visible y color de acento). Solo se escribe con set_community_brand / clear_community_brand.';

-- ───────────────────────── Funciones ─────────────────────────
-- Códigos: not_authenticated, not_admin, plan_required, invalid_name, reserved_name, name_taken, invalid_accent, low_contrast

create function public.set_community_brand(p_community_id uuid, p_display_name text, p_accent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := nullif(pg_catalog.btrim(coalesce(p_display_name, '')), '');
  v_accent text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_accent, '')));
  v_norm   text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_admin(p_community_id) then raise exception 'not_admin' using errcode = 'P0001'; end if;
  if not coalesce((public.entitlements_for(p_community_id) ->> 'branding')::boolean, false) then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_accent !~ '^#[0-9a-f]{6}$' then raise exception 'invalid_accent' using errcode = 'P0001'; end if;
  if not public.accent_contrast_ok(v_accent) then raise exception 'low_contrast' using errcode = 'P0001'; end if;

  if v_name is not null then
    if pg_catalog.char_length(v_name) > 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
    v_norm := public.normalize_brand_name(v_name);
    if v_norm = '' then raise exception 'invalid_name' using errcode = 'P0001'; end if;
    -- Nadie se hace pasar por la plataforma
    if v_norm like '%intercede%' then raise exception 'reserved_name' using errcode = 'P0001'; end if;
    -- Ni por otra comunidad (nombre propio o nombre visible de otra)
    if exists (select 1 from public.communities c where c.id <> p_community_id and public.normalize_brand_name(c.name) = v_norm)
       or exists (select 1 from public.community_brands b where b.community_id <> p_community_id and public.normalize_brand_name(b.display_name) = v_norm) then
      raise exception 'name_taken' using errcode = 'P0001';
    end if;
  end if;

  insert into public.community_brands (community_id, display_name, accent) values (p_community_id, v_name, v_accent)
  on conflict (community_id) do update set display_name = excluded.display_name, accent = excluded.accent, updated_at = pg_catalog.now();
end;
$$;

create function public.clear_community_brand(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_admin(p_community_id) then raise exception 'not_admin' using errcode = 'P0001'; end if;
  delete from public.community_brands b where b.community_id = p_community_id;
end;
$$;

-- La marca que se APLICA hoy (solo para quienes son de la comunidad): nula si no hay marca o el plan ya no es Pro
create function public.community_brand(p_community_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'name', coalesce(b.display_name, c.name),
    'accent', b.accent,
    'logo_url', c.logo_url
  )
  from public.community_brands b
  join public.communities c on c.id = b.community_id
  where b.community_id = p_community_id
    and public.is_community_member(p_community_id)
    and coalesce((public.entitlements_for(p_community_id) ->> 'branding')::boolean, false);
$$;

-- ───────────────────────── RLS y permisos ─────────────────────────

alter table public.community_brands enable row level security;

-- Las personas de la comunidad ven su marca (la administración la edita con la función)
create policy "community_brands_select_members" on public.community_brands for select to authenticated
  using (public.is_community_member(community_id));

revoke all on public.community_brands from anon, authenticated;
grant select on public.community_brands to authenticated;

revoke all on function
  public.hex_luminance(text), public.accent_contrast_ok(text), public.normalize_brand_name(text),
  public.set_community_brand(uuid, text, text), public.clear_community_brand(uuid), public.community_brand(uuid)
from public, anon, authenticated;

grant execute on function public.hex_luminance(text), public.accent_contrast_ok(text), public.normalize_brand_name(text) to authenticated, service_role;
grant execute on function public.set_community_brand(uuid, text, text), public.clear_community_brand(uuid), public.community_brand(uuid) to authenticated;
