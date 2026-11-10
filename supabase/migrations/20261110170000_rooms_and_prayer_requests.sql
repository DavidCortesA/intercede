-- Fase 3 — Salas de oración, miembros y peticiones en vivo (capa 1, sin audio)
--
-- Modelo de seguridad:
--   * Nadie escribe `rooms` ni `room_members` directamente: todo pasa por funciones RPC
--     (SECURITY DEFINER) que validan sesión, estado de la sala, aforo y rol de anfitrión.
--   * Las personas leen solo lo de las salas en las que participan (RLS con funciones auxiliares
--     SECURITY DEFINER para evitar la recursión entre rooms y room_members).
--   * El código de la sala (/r/abc123) es la "llave" para entrar: no hay forma de listar salas.
--   * El nombre que se ve en la sala se guarda en `room_members.display_name` (cada sala puede
--     usar un nombre distinto), de modo que `profiles` sigue siendo privado.

-- ───────────────────────── Tablas ─────────────────────────

create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  -- 6 caracteres sin ambiguos (sin i, l, o, 0, 1)
  code       text not null unique check (code ~ '^[a-hj-km-np-z2-9]{6}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  host_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'open' check (status in ('open', 'closed')),
  is_locked  boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  constraint rooms_closed_consistency check ((status = 'closed') = (closed_at is not null))
);

create index rooms_host_open_idx on public.rooms (host_id) where status = 'open';

create table public.room_members (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'participant' check (role in ('host', 'participant')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (room_id, user_id)
);

create index room_members_user_idx on public.room_members (user_id);
create index room_members_active_idx on public.room_members (room_id) where left_at is null;

create table public.prayer_requests (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 500),
  is_answered boolean not null default false,
  testimony   text check (testimony is null or char_length(btrim(testimony)) between 1 and 500),
  answered_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint prayer_requests_answer_consistency check (is_answered or (testimony is null and answered_at is null))
);

create index prayer_requests_room_idx on public.prayer_requests (room_id, created_at desc);

comment on table public.rooms is 'Sala de oración. Se crea y modifica solo mediante RPC (create_room, close_room, set_room_locked).';
comment on table public.room_members is 'Participantes de una sala. Solo se modifica mediante RPC (join_room, leave_room). left_at nulo = presente.';
comment on table public.prayer_requests is 'Peticiones compartidas en una sala. Visibles solo para quienes están en ella.';

-- ───────────────────────── Triggers de peticiones ─────────────────────────

create function public.prayer_requests_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Freno contra spam: como máximo 20 peticiones por persona y sala
  if tg_op = 'INSERT' and (
    select pg_catalog.count(*) from public.prayer_requests pr
    where pr.room_id = new.room_id and pr.author_id = new.author_id
  ) >= 20 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  if new.is_answered then
    if tg_op = 'INSERT' or not old.is_answered then
      new.answered_at := pg_catalog.now();
    end if;
  else
    new.answered_at := null;
    new.testimony := null;
  end if;

  return new;
end;
$$;

create trigger prayer_requests_before_write
  before insert or update on public.prayer_requests
  for each row execute function public.prayer_requests_before_write();

-- ───────────────────────── Funciones auxiliares (para RLS) ─────────────────────────

-- ¿La persona está ahora en la sala?
create function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id = (select auth.uid()) and rm.left_at is null
  );
$$;

-- ¿Estuvo alguna vez en la sala? (historial)
create function public.has_joined_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id = (select auth.uid())
  );
$$;

create function public.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.host_id = (select auth.uid())
  );
$$;

create function public.is_room_open(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rooms r where r.id = p_room_id and r.status = 'open');
$$;

revoke all on function public.is_room_member(uuid), public.has_joined_room(uuid),
  public.is_room_host(uuid), public.is_room_open(uuid) from public, anon;
grant execute on function public.is_room_member(uuid), public.has_joined_room(uuid),
  public.is_room_host(uuid), public.is_room_open(uuid) to authenticated;

-- ───────────────────────── RLS y privilegios ─────────────────────────

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.prayer_requests enable row level security;

revoke all on public.rooms, public.room_members, public.prayer_requests from anon, authenticated;

-- Lectura (las escrituras de rooms y room_members son solo por RPC)
grant select on public.rooms, public.room_members to authenticated;

create policy "rooms_select_participants"
  on public.rooms for select to authenticated
  using (public.has_joined_room(id));

create policy "room_members_select_same_room"
  on public.room_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_room_member(room_id));

-- Peticiones: leer (autor o presentes), crear (presente y sala abierta), editar (autor), borrar (autor o anfitrión)
grant select, delete on public.prayer_requests to authenticated;
grant insert (room_id, content) on public.prayer_requests to authenticated;
grant update (content, is_answered, testimony) on public.prayer_requests to authenticated;

create policy "prayer_requests_select"
  on public.prayer_requests for select to authenticated
  using (author_id = (select auth.uid()) or public.is_room_member(room_id));

create policy "prayer_requests_insert"
  on public.prayer_requests for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_room_member(room_id)
    and public.is_room_open(room_id)
  );

create policy "prayer_requests_update_author"
  on public.prayer_requests for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- El anfitrión modera borrando; no reescribe lo que otra persona dijo.
create policy "prayer_requests_delete_author_or_host"
  on public.prayer_requests for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_room_host(room_id));

-- ───────────────────────── RPC ─────────────────────────
-- Los errores se devuelven como P0001 con un mensaje-código estable que la app traduce:
-- not_authenticated, invalid_name, invalid_room_name, too_many_rooms, code_unavailable,
-- room_not_found, room_closed, room_locked, room_full, not_host.

create function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; -- 31 caracteres, sin i l o 0 1
  raw bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid()); -- aleatorio criptográfico
  result text := '';
begin
  for i in 0..5 loop
    result := result || pg_catalog.substr(alphabet, (pg_catalog.get_byte(raw, i) % 31) + 1, 1);
  end loop;
  return result;
end;
$$;

create function public.create_room(p_name text, p_display_name text)
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

  insert into public.room_members (room_id, user_id, role, display_name)
  values (v_room, uid, 'host', v_display);

  return query select v_room, v_code;
end;
$$;

create function public.join_room(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := (select auth.uid());
  v_display    text := pg_catalog.btrim(coalesce(p_display_name, ''));
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
  if found and v_member.left_at is null then
    -- Ya está dentro: solo actualiza el nombre (idempotente)
    update public.room_members rm set display_name = v_display where rm.room_id = v_room.id and rm.user_id = uid;
    return v_room.id;
  end if;

  if v_room.is_locked and v_room.host_id <> uid then
    raise exception 'room_locked' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into active_count
  from public.room_members rm where rm.room_id = v_room.id and rm.left_at is null;
  if active_count >= 20 then raise exception 'room_full' using errcode = 'P0001'; end if;

  insert into public.room_members (room_id, user_id, role, display_name)
  values (v_room.id, uid, 'participant', v_display)
  on conflict (room_id, user_id)
  do update set left_at = null, joined_at = pg_catalog.now(), display_name = excluded.display_name;

  return v_room.id;
end;
$$;

create function public.leave_room(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.room_members rm
  set left_at = pg_catalog.now()
  where rm.room_id = p_room_id and rm.user_id = (select auth.uid()) and rm.left_at is null;
$$;

create function public.close_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  perform 1 from public.rooms r where r.id = p_room_id and r.host_id = uid for update;
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;

  update public.rooms r
  set status = 'closed', closed_at = pg_catalog.now()
  where r.id = p_room_id and r.status = 'open';

  update public.room_members rm
  set left_at = coalesce(rm.left_at, pg_catalog.now())
  where rm.room_id = p_room_id;
end;
$$;

create function public.set_room_locked(p_room_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms r
  set is_locked = p_locked
  where r.id = p_room_id and r.host_id = (select auth.uid()) and r.status = 'open';

  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;
end;
$$;

-- Vista previa para la pantalla "unirse": solo nombre, estado y cuántas personas hay.
-- Quien tiene el código ya puede entrar, así que no revela nada nuevo; no expone al anfitrión.
create function public.peek_room(p_code text)
returns table (name text, status text, is_locked boolean, active_members int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.name, r.status, r.is_locked,
         (select pg_catalog.count(*)::int from public.room_members rm where rm.room_id = r.id and rm.left_at is null)
  from public.rooms r
  where r.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')));
$$;

revoke all on function
  public.generate_room_code(), public.create_room(text, text), public.join_room(text, text),
  public.leave_room(uuid), public.close_room(uuid), public.set_room_locked(uuid, boolean),
  public.peek_room(text)
from public, anon, authenticated;

grant execute on function
  public.create_room(text, text), public.join_room(text, text), public.leave_room(uuid),
  public.close_room(uuid), public.set_room_locked(uuid, boolean)
to authenticated;
grant execute on function public.peek_room(text) to anon, authenticated;

-- ───────────────────────── Realtime ─────────────────────────
-- Realtime respeta RLS en INSERT/UPDATE. Los DELETE llegan solo con la clave primaria.
alter publication supabase_realtime add table public.rooms, public.room_members, public.prayer_requests;
