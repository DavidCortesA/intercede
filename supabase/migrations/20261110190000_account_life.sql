-- Fase 5 — Mi vida de oración (capa 2): diario, "estoy orando por esto" y avatares.
--
-- Modelo de seguridad:
--   * El diario es PRIVADO y solo para cuentas permanentes (un invitado puede perder su sesión);
--     la regla vive en la base (RLS), no solo en la interfaz.
--   * "Estoy orando por esto": solo quien está en la sala, en peticiones ajenas; se cuenta por
--     persona (una vez) y se ve solo dentro de la sala.
--   * Avatares: archivos en una carpeta propia (avatars/<user_id>/…) y la URL del perfil solo puede
--     apuntar a esa carpeta (evita rastrear a quien ve el avatar con una URL externa).

-- ───────────────────────── Cuenta permanente ─────────────────────────

create function public.is_permanent_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false;
$$;

grant execute on function public.is_permanent_user() to authenticated;

-- ───────────────────────── Diario de oración ─────────────────────────

create table public.prayer_journal_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content           text not null check (char_length(btrim(content)) between 1 and 2000),
  category          text not null default 'other' check (category in ('family', 'health', 'work', 'finances', 'faith', 'other')),
  status            text not null default 'praying' check (status in ('praying', 'answered')),
  testimony         text check (testimony is null or char_length(btrim(testimony)) between 1 and 1000),
  answered_at       timestamptz,
  -- Si la entrada se guardó desde una petición de una sala (la petición puede borrarse después)
  source_request_id uuid references public.prayer_requests (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint prayer_journal_answer_consistency check (status = 'answered' or (testimony is null and answered_at is null))
);

create index prayer_journal_user_idx on public.prayer_journal_entries (user_id, created_at desc);

-- Una petición de la sala se guarda una sola vez en el diario de cada persona
create unique index prayer_journal_source_unique
  on public.prayer_journal_entries (user_id, source_request_id)
  where source_request_id is not null;

comment on table public.prayer_journal_entries is 'Diario personal de oración. Privado; solo cuentas permanentes.';

create function public.prayer_journal_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (
    select pg_catalog.count(*) from public.prayer_journal_entries e where e.user_id = new.user_id
  ) >= 1000 then
    raise exception 'too_many_entries' using errcode = 'P0001';
  end if;

  new.updated_at := pg_catalog.now();
  if new.status = 'answered' then
    if tg_op = 'INSERT' or old.status <> 'answered' then new.answered_at := pg_catalog.now(); end if;
  else
    new.answered_at := null;
    new.testimony := null;
  end if;
  return new;
end;
$$;

create trigger prayer_journal_before_write
  before insert or update on public.prayer_journal_entries
  for each row execute function public.prayer_journal_before_write();

alter table public.prayer_journal_entries enable row level security;
revoke all on public.prayer_journal_entries from anon, authenticated;
grant select, delete on public.prayer_journal_entries to authenticated;
grant insert (content, category, source_request_id) on public.prayer_journal_entries to authenticated;
grant update (content, category, status, testimony) on public.prayer_journal_entries to authenticated;

create policy "journal_select_own"
  on public.prayer_journal_entries for select to authenticated
  using (user_id = (select auth.uid()));

create policy "journal_insert_own_permanent"
  on public.prayer_journal_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_permanent_user()
    -- Solo se puede guardar una petición que la persona puede leer (RLS de prayer_requests)
    and (source_request_id is null or exists (select 1 from public.prayer_requests pr where pr.id = source_request_id))
  );

create policy "journal_update_own"
  on public.prayer_journal_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "journal_delete_own"
  on public.prayer_journal_entries for delete to authenticated
  using (user_id = (select auth.uid()));

-- ───────────────────────── "Estoy orando por esto" ─────────────────────────

create table public.prayer_support (
  request_id uuid not null references public.prayer_requests (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Denormalizado para poder filtrar en Realtime y evaluar RLS sin joins
  room_id    uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index prayer_support_room_idx on public.prayer_support (room_id);

comment on table public.prayer_support is 'Quién está orando por qué petición (una vez por persona). Visible solo para quienes están en la sala.';

create function public.prayer_support_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- room_id sale de la petición (la lee la persona con RLS: si no la ve, no existe para ella)
  select pr.room_id into new.room_id from public.prayer_requests pr where pr.id = new.request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create trigger prayer_support_before_insert
  before insert on public.prayer_support
  for each row execute function public.prayer_support_before_insert();

alter table public.prayer_support enable row level security;
revoke all on public.prayer_support from anon, authenticated;
grant select, delete on public.prayer_support to authenticated;
grant insert (request_id) on public.prayer_support to authenticated;

create policy "prayer_support_select_room"
  on public.prayer_support for select to authenticated
  using (public.is_room_member(room_id));

create policy "prayer_support_insert_others"
  on public.prayer_support for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.prayer_requests pr
      where pr.id = request_id and pr.author_id <> (select auth.uid())
    )
  );

create policy "prayer_support_delete_own"
  on public.prayer_support for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.prayer_support;

-- ───────────────────────── Avatares ─────────────────────────

-- La URL del avatar solo puede apuntar a la carpeta de la propia persona en nuestro almacenamiento
alter table public.profiles
  add constraint profiles_avatar_in_own_folder
  check (avatar_url is null or avatar_url like ('%/storage/v1/object/public/avatars/' || id::text || '/%'));

alter table public.room_members add column avatar_url text;
comment on column public.room_members.avatar_url is 'Copia del avatar del perfil al entrar a la sala (profiles es privado).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "avatars_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_permanent_user()
  );

create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Las salas copian el avatar del perfil al crearla o entrar a ella
create or replace function public.create_room(p_name text, p_display_name text)
returns table (room_id uuid, room_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_name    text := pg_catalog.btrim(coalesce(p_name, ''));
  v_display text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_code    text;
  v_room    uuid;
  attempts  int := 0;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_display) not between 1 and 40 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_room_name' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from public.rooms r where r.host_id = uid and r.status = 'open') >= 5 then
    raise exception 'too_many_rooms' using errcode = 'P0001';
  end if;

  loop
    attempts := attempts + 1;
    v_code := public.generate_room_code();
    begin
      insert into public.rooms (code, name, host_id) values (v_code, v_name, uid) returning id into v_room;
      exit;
    exception when unique_violation then
      if attempts >= 10 then raise exception 'code_unavailable' using errcode = 'P0001'; end if;
    end;
  end loop;

  insert into public.room_members (room_id, user_id, role, display_name, avatar_url)
  values (v_room, uid, 'host', v_display, (select p.avatar_url from public.profiles p where p.id = uid));

  return query select v_room, v_code;
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := (select auth.uid());
  v_display    text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_avatar     text := (select p.avatar_url from public.profiles p where p.id = (select auth.uid()));
  v_room       public.rooms;
  v_member     public.room_members;
  active_count int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_display) not between 1 and 40 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  -- FOR UPDATE serializa las entradas simultáneas para que el aforo sea exacto
  select * into v_room from public.rooms r
  where r.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, ''))) for update;

  if not found then raise exception 'room_not_found' using errcode = 'P0001'; end if;
  if v_room.status <> 'open' then raise exception 'room_closed' using errcode = 'P0001'; end if;

  select * into v_member from public.room_members rm where rm.room_id = v_room.id and rm.user_id = uid;

  -- Expulsado por el anfitrión: no vuelve a entrar
  if found and v_member.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;

  if found and v_member.left_at is null then
    -- Ya está dentro: solo actualiza el nombre y el avatar (idempotente)
    update public.room_members rm set display_name = v_display, avatar_url = v_avatar
    where rm.room_id = v_room.id and rm.user_id = uid;
    return v_room.id;
  end if;

  if v_room.is_locked and v_room.host_id <> uid then
    raise exception 'room_locked' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into active_count
  from public.room_members rm where rm.room_id = v_room.id and rm.left_at is null;
  if active_count >= 20 then raise exception 'room_full' using errcode = 'P0001'; end if;

  insert into public.room_members (room_id, user_id, role, display_name, avatar_url)
  values (v_room.id, uid, 'participant', v_display, v_avatar)
  on conflict (room_id, user_id)
  do update set left_at = null, joined_at = pg_catalog.now(),
                display_name = excluded.display_name, avatar_url = excluded.avatar_url;

  return v_room.id;
end;
$$;
