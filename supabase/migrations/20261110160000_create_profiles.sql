-- Fase 2 — Perfiles de usuario (invitados y cuentas permanentes)
--
-- Un "invitado" es un usuario de Supabase Auth con is_anonymous = true: tiene id y rol
-- `authenticated`, por lo que la seguridad se basa siempre en auth.uid() y RLS.
-- Al convertirlo en cuenta (updateUser/linkIdentity) conserva el mismo id y su perfil.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  avatar_url   text check (avatar_url is null or char_length(avatar_url) <= 2048),
  locale       text not null default 'es' check (locale in ('es', 'en', 'pt')),
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil público-mínimo de cada usuario de auth.users (invitado o cuenta). Se crea por trigger.';
comment on column public.profiles.display_name is
  'Nombre que ve el resto de la sala. Nulo hasta que la persona lo elige.';

-- ───────────────────────── Validación y updated_at ─────────────────────────

create function public.profiles_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- La zona horaria debe existir (un CHECK no puede consultar pg_timezone_names).
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria no válida: %', new.timezone using errcode = '22023';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

-- ───────────────────────── Alta automática del perfil ─────────────────────────

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
begin
  -- Nombre elegido al entrar (options.data.display_name) o, con Google, su nombre público.
  raw_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );

  insert into public.profiles (id, display_name)
  values (new.id, nullif(pg_catalog.btrim(pg_catalog.left(coalesce(raw_name, ''), 40)), ''));

  return new;
end;
$$;

-- Solo la ejecuta el trigger; nadie la invoca por la API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Privilegios y RLS ─────────────────────────

alter table public.profiles enable row level security;

-- Parte de cero: ni `anon` ni `authenticated` reciben nada por defecto.
revoke all on public.profiles from anon, authenticated;

-- Las personas leen su perfil y editan solo estos campos. Insertar lo hace el trigger y
-- borrar ocurre en cascada al eliminar la cuenta (no hay política de INSERT ni DELETE).
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, locale, timezone) on public.profiles to authenticated;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
