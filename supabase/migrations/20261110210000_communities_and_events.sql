-- Fase 7 — Comunidades (capa 3): iglesias, ministerios y grupos con muro de oración, salas recurrentes,
-- devocional propio y eventos con confirmación de asistencia.
--
-- Principios:
--   * La capa 3 se SUMA sin tocar la capa 1: las tablas de salas y peticiones de sala siguen igual; solo
--     se añade `rooms.community_id` (nulo = sala normal) y una comprobación en join_room.
--   * Roles simples: admin (todo), leader (crea salas, programaciones, eventos y devocionales, modera el
--     muro), member (ora, publica en el muro y confirma asistencia).
--   * Todo se decide en la base (RLS y funciones SECURITY DEFINER con search_path vacío); los códigos de
--     error son estables (P0001).
--   * Unirse es con un enlace/código REVOCABLE (como las invitaciones de salas programadas), solo cuentas.

-- ───────────────────────── Comunidades y miembros ─────────────────────────

create table public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  kind        text not null default 'church' check (kind in ('church', 'ministry', 'group')),
  description text check (description is null or char_length(btrim(description)) between 1 and 500),
  logo_url    text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- El logo solo puede apuntar a la carpeta de esta comunidad en nuestro almacenamiento
  constraint communities_logo_in_own_folder
    check (logo_url is null or logo_url like ('%/storage/v1/object/public/community-logos/' || id::text || '/%'))
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'leader', 'member')),
  -- Copia del nombre y la foto del perfil (profiles es privado); un trigger la mantiene al día
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_url   text,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index community_members_user_idx on public.community_members (user_id);

create table public.community_invites (
  community_id uuid primary key references public.communities (id) on delete cascade,
  token        text not null unique default public.new_invite_token(),
  created_at   timestamptz not null default now()
);

comment on table public.communities is 'Iglesia, ministerio o grupo. Se crea con create_community; solo sus miembros la ven.';
comment on table public.community_invites is 'Enlace de invitación (revocable: regenerar cambia el token). Lo ven admin y líderes.';

-- ───────────────────────── Funciones auxiliares (para RLS) ─────────────────────────

create function public.community_role(p_community_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select cm.role from public.community_members cm
  where cm.community_id = p_community_id and cm.user_id = (select auth.uid());
$$;

create function public.is_community_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id and cm.user_id = (select auth.uid())
  );
$$;

create function public.is_community_leader(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.community_role(p_community_id) in ('admin', 'leader'), false);
$$;

create function public.is_community_admin(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.community_role(p_community_id) = 'admin', false);
$$;

-- Para las políticas de Storage: la primera carpeta del archivo es el id de la comunidad (texto)
create function public.is_community_admin_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.is_community_admin(p_folder::uuid);
$$;

-- ───────────────────────── RLS: comunidades ─────────────────────────

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_invites enable row level security;
revoke all on public.communities, public.community_members, public.community_invites from anon, authenticated;

grant select on public.communities to authenticated;
grant update (name, kind, description, logo_url) on public.communities to authenticated;
grant delete on public.communities to authenticated;
grant select on public.community_members, public.community_invites to authenticated;

create policy "communities_select_members"
  on public.communities for select to authenticated
  using (public.is_community_member(id));
create policy "communities_update_admin"
  on public.communities for update to authenticated
  using (public.is_community_admin(id))
  with check (public.is_community_admin(id));
create policy "communities_delete_admin"
  on public.communities for delete to authenticated
  using (public.is_community_admin(id));

create policy "community_members_select_members"
  on public.community_members for select to authenticated
  using (public.is_community_member(community_id));

create policy "community_invites_select_leaders"
  on public.community_invites for select to authenticated
  using (public.is_community_leader(community_id));

-- Mantiene al día el nombre y la foto que ven las demás personas de la comunidad
create function public.sync_profile_to_communities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.community_members cm
  set display_name = coalesce(nullif(pg_catalog.btrim(new.display_name), ''), cm.display_name),
      avatar_url = new.avatar_url
  where cm.user_id = new.id;
  return new;
end;
$$;

create trigger profiles_sync_communities
  after update of display_name, avatar_url on public.profiles
  for each row execute function public.sync_profile_to_communities();

-- ───────────────────────── Funciones de comunidades ─────────────────────────
-- Códigos de error: not_authenticated, account_required, invalid_name, invalid_kind, too_many_communities,
-- community_not_found, community_full, not_admin, not_leader, not_member, member_not_found, invalid_role,
-- last_admin, cannot_remove_admin

create function public.create_community(p_name text, p_kind text default 'church', p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_name  text := pg_catalog.btrim(coalesce(p_name, ''));
  v_desc  text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_id    uuid;
  v_display text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_kind not in ('church', 'ministry', 'group') then raise exception 'invalid_kind' using errcode = 'P0001'; end if;
  if v_desc is not null and pg_catalog.char_length(v_desc) > 500 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.communities c where c.created_by = uid) >= 5 then
    raise exception 'too_many_communities' using errcode = 'P0001';
  end if;

  select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Miembro') into v_display from public.profiles p where p.id = uid;

  insert into public.communities (name, kind, description, created_by) values (v_name, p_kind, v_desc, uid) returning id into v_id;
  insert into public.community_members (community_id, user_id, role, display_name, avatar_url)
  values (v_id, uid, 'admin', coalesce(v_display, 'Miembro'), (select p.avatar_url from public.profiles p where p.id = uid));
  insert into public.community_invites (community_id) values (v_id);
  return v_id;
end;
$$;

-- Vista previa para la pantalla de invitación (quien tiene el enlace ya podría unirse)
create function public.peek_community(p_token text)
returns table (name text, kind text, description text, logo_url text, members bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name, c.kind, c.description, c.logo_url,
         (select pg_catalog.count(*) from public.community_members cm where cm.community_id = c.id)
  from public.community_invites i
  join public.communities c on c.id = i.community_id
  where i.token = p_token;
$$;

create function public.join_community(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_id      uuid;
  v_display text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;

  select i.community_id into v_id from public.community_invites i where i.token = p_token;
  if not found then raise exception 'community_not_found' using errcode = 'P0001'; end if;

  if exists (select 1 from public.community_members cm where cm.community_id = v_id and cm.user_id = uid) then
    return v_id; -- ya es miembro: idempotente
  end if;
  if (select pg_catalog.count(*) from public.community_members cm where cm.community_id = v_id) >= 1000 then
    raise exception 'community_full' using errcode = 'P0001';
  end if;

  select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Miembro') into v_display from public.profiles p where p.id = uid;
  insert into public.community_members (community_id, user_id, role, display_name, avatar_url)
  values (v_id, uid, 'member', coalesce(v_display, 'Miembro'), (select p.avatar_url from public.profiles p where p.id = uid));
  return v_id;
end;
$$;

create function public.leave_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_role text;
begin
  select cm.role into v_role from public.community_members cm where cm.community_id = p_community_id and cm.user_id = uid;
  if not found then raise exception 'not_member' using errcode = 'P0001'; end if;
  if v_role = 'admin' and not exists (
    select 1 from public.community_members cm where cm.community_id = p_community_id and cm.role = 'admin' and cm.user_id <> uid
  ) then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  delete from public.community_members cm where cm.community_id = p_community_id and cm.user_id = uid;
  -- Deja de seguir las programaciones de la comunidad
  delete from public.schedule_subscriptions ss
  using public.room_schedules rs
  where ss.schedule_id = rs.id and rs.community_id = p_community_id and ss.user_id = uid;
end;
$$;

create function public.set_member_role(p_community_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if not public.is_community_admin(p_community_id) then raise exception 'not_admin' using errcode = 'P0001'; end if;
  if p_role not in ('admin', 'leader', 'member') then raise exception 'invalid_role' using errcode = 'P0001'; end if;

  select cm.role into v_current from public.community_members cm where cm.community_id = p_community_id and cm.user_id = p_user_id for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0001'; end if;

  if v_current = 'admin' and p_role <> 'admin' and not exists (
    select 1 from public.community_members cm where cm.community_id = p_community_id and cm.role = 'admin' and cm.user_id <> p_user_id
  ) then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;

  update public.community_members cm set role = p_role where cm.community_id = p_community_id and cm.user_id = p_user_id;
end;
$$;

-- Admin saca a cualquiera que no sea admin; un líder solo puede sacar a miembros
create function public.remove_community_member(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target text;
begin
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  select cm.role into v_target from public.community_members cm where cm.community_id = p_community_id and cm.user_id = p_user_id;
  if not found then raise exception 'member_not_found' using errcode = 'P0001'; end if;
  if p_user_id = (select auth.uid()) then raise exception 'cannot_remove_admin' using errcode = 'P0001'; end if;
  if v_target = 'admin' or (v_target = 'leader' and not public.is_community_admin(p_community_id)) then
    raise exception 'cannot_remove_admin' using errcode = 'P0001';
  end if;

  delete from public.community_members cm where cm.community_id = p_community_id and cm.user_id = p_user_id;
  delete from public.schedule_subscriptions ss
  using public.room_schedules rs
  where ss.schedule_id = rs.id and rs.community_id = p_community_id and ss.user_id = p_user_id;
end;
$$;

create function public.get_community_invite(p_community_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.token from public.community_invites i
  where i.community_id = p_community_id and public.is_community_leader(p_community_id);
$$;

create function public.regenerate_community_invite(p_community_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_community_admin(p_community_id) then raise exception 'not_admin' using errcode = 'P0001'; end if;
  update public.community_invites i set token = public.new_invite_token(), created_at = pg_catalog.now()
  where i.community_id = p_community_id returning i.token into v_token;
  return v_token;
end;
$$;

-- ───────────────────────── Logos (Storage) ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-logos', 'community-logos', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "community_logos_select_admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'community-logos' and public.is_community_admin_folder((storage.foldername(name))[1]));

create policy "community_logos_insert_admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'community-logos' and public.is_community_admin_folder((storage.foldername(name))[1]));

create policy "community_logos_update_admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'community-logos' and public.is_community_admin_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'community-logos' and public.is_community_admin_folder((storage.foldername(name))[1]));

create policy "community_logos_delete_admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'community-logos' and public.is_community_admin_folder((storage.foldername(name))[1]));

-- ───────────────────────── Muro de oración ─────────────────────────
-- Tabla propia (no se reutiliza prayer_requests, que está atada a una sala): así la capa 1 no cambia.
-- visibility: 'community' = todas las personas de la comunidad; 'leaders' = solo quien la escribió y
-- el equipo de liderazgo (admin y líderes), para peticiones pastorales delicadas.

create table public.community_requests (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content      text not null check (char_length(btrim(content)) between 1 and 500),
  visibility   text not null default 'community' check (visibility in ('community', 'leaders')),
  is_answered  boolean not null default false,
  testimony    text check (testimony is null or char_length(btrim(testimony)) between 1 and 500),
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint community_requests_answer_consistency check (is_answered or (testimony is null and answered_at is null))
);

create index community_requests_wall_idx on public.community_requests (community_id, created_at desc);

create function public.community_requests_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (
    select pg_catalog.count(*) from public.community_requests cr
    where cr.community_id = new.community_id and cr.author_id = new.author_id and not cr.is_answered
  ) >= 30 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  if new.is_answered then
    if tg_op = 'INSERT' or not old.is_answered then new.answered_at := pg_catalog.now(); end if;
  else
    new.answered_at := null;
    new.testimony := null;
  end if;
  return new;
end;
$$;

create trigger community_requests_before_write
  before insert or update on public.community_requests
  for each row execute function public.community_requests_before_write();

create table public.community_request_support (
  request_id   uuid not null references public.community_requests (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (request_id, user_id)
);

create function public.community_support_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  req public.community_requests;
begin
  -- Se lee con los permisos de quien inserta: si la petición no es visible para esa persona, no existe
  select * into req from public.community_requests cr where cr.id = new.request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if req.author_id = (select auth.uid()) then raise exception 'own_request' using errcode = 'P0001'; end if;
  new.community_id := req.community_id;
  return new;
end;
$$;

create trigger community_support_before_insert
  before insert on public.community_request_support
  for each row execute function public.community_support_before_insert();

alter table public.community_requests enable row level security;
alter table public.community_request_support enable row level security;
revoke all on public.community_requests, public.community_request_support from anon, authenticated;

grant select, delete on public.community_requests to authenticated;
grant insert (community_id, content, visibility) on public.community_requests to authenticated;
grant update (content, visibility, is_answered, testimony) on public.community_requests to authenticated;
grant select, delete on public.community_request_support to authenticated;
grant insert (request_id) on public.community_request_support to authenticated;

create policy "community_requests_select_visible"
  on public.community_requests for select to authenticated
  using (
    public.is_community_member(community_id)
    and (visibility = 'community' or author_id = (select auth.uid()) or public.is_community_leader(community_id))
  );
create policy "community_requests_insert_member"
  on public.community_requests for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_community_member(community_id) and public.is_permanent_user());
create policy "community_requests_update_author"
  on public.community_requests for update to authenticated
  using (author_id = (select auth.uid()) and public.is_community_member(community_id))
  with check (author_id = (select auth.uid()) and public.is_community_member(community_id));
-- Quien la escribió la borra; el liderazgo también (moderación)
create policy "community_requests_delete_author_or_leader"
  on public.community_requests for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_community_leader(community_id));

create policy "community_support_select_visible"
  on public.community_request_support for select to authenticated
  using (
    public.is_community_member(community_id)
    and exists (select 1 from public.community_requests cr where cr.id = request_id)
  );
create policy "community_support_insert_own"
  on public.community_request_support for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_community_member(community_id));
create policy "community_support_delete_own"
  on public.community_request_support for delete to authenticated
  using (user_id = (select auth.uid()));

-- ───────────────────────── Salas de la comunidad ─────────────────────────

alter table public.rooms add column community_id uuid references public.communities (id) on delete cascade;
create index rooms_community_idx on public.rooms (community_id) where community_id is not null;

alter table public.room_schedules add column community_id uuid references public.communities (id) on delete cascade;
create index room_schedules_community_idx on public.room_schedules (community_id) where community_id is not null;

-- Las personas de la comunidad ven las salas abiertas de la comunidad (para entrar), aunque no hayan estado en ellas
create policy "rooms_select_community_members"
  on public.rooms for select to authenticated
  using (community_id is not null and public.is_community_member(community_id));

-- Una sala de comunidad solo admite a miembros de esa comunidad
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

  select * into v_room from public.rooms r
  where r.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, ''))) for update;

  if not found then raise exception 'room_not_found' using errcode = 'P0001'; end if;
  if v_room.status <> 'open' then raise exception 'room_closed' using errcode = 'P0001'; end if;
  if v_room.community_id is not null and not public.is_community_member(v_room.community_id) then
    raise exception 'community_only' using errcode = 'P0001';
  end if;

  select * into v_member from public.room_members rm where rm.room_id = v_room.id and rm.user_id = uid;

  if found and v_member.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;

  if found and v_member.left_at is null then
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

-- Sala abierta ahora, de la comunidad (admin o líder)
create function public.create_community_room(p_community_id uuid, p_name text, p_display_name text)
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
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_display) not between 1 and 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then raise exception 'invalid_room_name' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.rooms r where r.host_id = uid and r.status = 'open') >= 5 then
    raise exception 'too_many_rooms' using errcode = 'P0001';
  end if;

  loop
    attempts := attempts + 1;
    v_code := public.generate_room_code();
    begin
      insert into public.rooms (code, name, host_id, community_id) values (v_code, v_name, uid, p_community_id) returning id into v_room;
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

-- ───────────────────────── Programaciones de la comunidad ─────────────────────────

create function public.can_manage_schedule(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_schedules s
    where s.id = p_schedule_id
      and (s.owner_id = (select auth.uid()) or (s.community_id is not null and public.is_community_admin(s.community_id)))
  );
$$;

-- Las personas de la comunidad ven las programaciones de la comunidad (para seguirlas)
create policy "room_schedules_select_community_members"
  on public.room_schedules for select to authenticated
  using (community_id is not null and public.is_community_member(community_id));

drop policy "room_schedules_delete_owner" on public.room_schedules;
create policy "room_schedules_delete_manager"
  on public.room_schedules for delete to authenticated
  using (public.can_manage_schedule(id));

-- create_schedule gana un parámetro opcional (comunidad): se reemplaza la función
drop function public.create_schedule(text, text, time, date, smallint[], text, int);
create function public.create_schedule(
  p_name text,
  p_recurrence text,
  p_local_time time,
  p_start_date date,
  p_weekdays smallint[],
  p_timezone text,
  p_reminder_minutes int default 10,
  p_community_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_name  text := pg_catalog.btrim(coalesce(p_name, ''));
  v_next  timestamptz;
  v_id    uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;
  if p_community_id is not null and not public.is_community_leader(p_community_id) then
    raise exception 'not_leader' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.room_schedules s where s.owner_id = uid and s.is_active) >= 10 then
    raise exception 'too_many_schedules' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = 'P0001';
  end if;

  if p_recurrence = 'weekly' and (coalesce(pg_catalog.cardinality(p_weekdays), 0) = 0 or not p_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]) then
    raise exception 'invalid_weekdays' using errcode = 'P0001';
  end if;

  v_next := public.compute_next_occurrence(p_recurrence, p_local_time, p_start_date, coalesce(p_weekdays, '{}'), p_timezone, pg_catalog.now());
  if v_next is null then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;

  insert into public.room_schedules (owner_id, name, timezone, recurrence, local_time, start_date, weekdays, reminder_minutes, next_occurrence_at, community_id)
  values (uid, v_name, p_timezone, p_recurrence, p_local_time, p_start_date, coalesce(p_weekdays, '{}'), p_reminder_minutes, v_next, p_community_id)
  returning id into v_id;

  insert into public.schedule_invites (schedule_id) values (v_id);
  insert into public.schedule_subscriptions (schedule_id, user_id) values (v_id, uid);
  return v_id;
end;
$$;

-- Pausar/reanudar: quien la creó o el admin de la comunidad
create or replace function public.set_schedule_active(p_schedule_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.room_schedules;
  v_next timestamptz;
begin
  if not public.can_manage_schedule(p_schedule_id) then raise exception 'not_owner' using errcode = 'P0001'; end if;
  select * into s from public.room_schedules rs where rs.id = p_schedule_id for update;

  if p_active then
    v_next := public.compute_next_occurrence(s.recurrence, s.local_time, s.start_date, s.weekdays, s.timezone, pg_catalog.now());
    if v_next is null then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
    update public.room_schedules rs set is_active = true, next_occurrence_at = v_next where rs.id = s.id;
  else
    update public.room_schedules rs set is_active = false where rs.id = s.id;
  end if;
end;
$$;

-- Seguir una programación de la comunidad (sin enlace: basta ser miembro)
create function public.follow_community_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_community uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select s.community_id into v_community from public.room_schedules s where s.id = p_schedule_id and s.is_active;
  if not found or v_community is null then raise exception 'schedule_not_found' using errcode = 'P0001'; end if;
  if not public.is_community_member(v_community) then raise exception 'not_member' using errcode = 'P0001'; end if;
  insert into public.schedule_subscriptions (schedule_id, user_id) values (p_schedule_id, uid) on conflict do nothing;
end;
$$;

-- ───────────────────────── Devocional de la comunidad ─────────────────────────

alter table public.devotionals
  add constraint devotionals_community_fk foreign key (community_id) references public.communities (id) on delete cascade;

grant insert (devotional_date, community_id, passage_reference, passage_text, bible_version, reflection, question, suggested_prayer)
  on public.devotionals to authenticated;
grant update (devotional_date, passage_reference, passage_text, bible_version, reflection, question, suggested_prayer)
  on public.devotionals to authenticated;
grant delete on public.devotionals to authenticated;

create policy "devotionals_select_community"
  on public.devotionals for select to authenticated
  using (
    community_id is not null and public.is_community_member(community_id)
    and (devotional_date <= (current_date + 1) or public.is_community_leader(community_id))
  );
create policy "devotionals_insert_leaders"
  on public.devotionals for insert to authenticated
  with check (community_id is not null and public.is_community_leader(community_id));
create policy "devotionals_update_leaders"
  on public.devotionals for update to authenticated
  using (community_id is not null and public.is_community_leader(community_id))
  with check (community_id is not null and public.is_community_leader(community_id));
create policy "devotionals_delete_leaders"
  on public.devotionals for delete to authenticated
  using (community_id is not null and public.is_community_leader(community_id));

-- ───────────────────────── Eventos y confirmación de asistencia ─────────────────────────

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 100),
  description      text check (description is null or char_length(btrim(description)) between 1 and 1000),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  -- Zona horaria en la que se programó (para mostrar la hora de pared del lugar del evento)
  timezone         text not null,
  -- Si es true, al empezar el evento se abre una sala de oración de la comunidad
  opens_room       boolean not null default false,
  room_id          uuid references public.rooms (id) on delete set null,
  reminder_minutes int not null default 60 check (reminder_minutes in (0, 15, 30, 60, 120, 1440)),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint events_end_after_start check (ends_at > starts_at)
);

create index events_community_start_idx on public.events (community_id, starts_at);
create index events_due_idx on public.events (starts_at) where room_id is null and opens_room;

create table public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status     text not null check (status in ('going', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create function public.is_event_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and public.is_community_member(e.community_id)
  );
$$;

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
revoke all on public.events, public.event_rsvps from anon, authenticated;
grant select, delete on public.events to authenticated;
grant select on public.event_rsvps to authenticated;

create policy "events_select_members"
  on public.events for select to authenticated
  using (public.is_community_member(community_id));
create policy "events_delete_leaders"
  on public.events for delete to authenticated
  using (public.is_community_leader(community_id));
create policy "event_rsvps_select_members"
  on public.event_rsvps for select to authenticated
  using (public.is_event_member(event_id));
-- (las altas y cambios de asistencia van por set_rsvp)

-- Códigos de error: not_leader, invalid_title, invalid_timezone, invalid_duration, event_in_past,
-- too_many_events, event_not_found, event_ended, invalid_status, not_member
create function public.create_event(
  p_community_id uuid,
  p_title text,
  p_description text,
  p_date date,
  p_time time,
  p_timezone text,
  p_duration_minutes int default 60,
  p_opens_room boolean default false,
  p_reminder_minutes int default 60
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title  text := pg_catalog.btrim(coalesce(p_title, ''));
  v_desc   text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_start  timestamptz;
  v_id     uuid;
begin
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  if pg_catalog.char_length(v_title) not between 1 and 100 or (v_desc is not null and pg_catalog.char_length(v_desc) > 1000) then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = 'P0001';
  end if;
  if p_duration_minutes not between 15 and 1440 then raise exception 'invalid_duration' using errcode = 'P0001'; end if;

  v_start := (p_date + p_time) at time zone p_timezone;
  if v_start <= pg_catalog.now() then raise exception 'event_in_past' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.events e where e.community_id = p_community_id and e.ends_at > pg_catalog.now()) >= 100 then
    raise exception 'too_many_events' using errcode = 'P0001';
  end if;

  insert into public.events (community_id, title, description, starts_at, ends_at, timezone, opens_room, reminder_minutes)
  values (p_community_id, v_title, v_desc, v_start, v_start + pg_catalog.make_interval(mins => p_duration_minutes), p_timezone, p_opens_room, p_reminder_minutes)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.set_rsvp(p_event_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  e   public.events;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_status not in ('going', 'maybe', 'no') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  select * into e from public.events ev where ev.id = p_event_id;
  if not found or not public.is_community_member(e.community_id) then raise exception 'event_not_found' using errcode = 'P0001'; end if;
  if e.ends_at <= pg_catalog.now() then raise exception 'event_ended' using errcode = 'P0001'; end if;

  insert into public.event_rsvps (event_id, user_id, status) values (p_event_id, uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status, updated_at = pg_catalog.now();
end;
$$;

-- ───────────────────────── Avisos de eventos y salas de la comunidad ─────────────────────────

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('schedule_reminder', 'schedule_started', 'devotional_reminder', 'event_reminder', 'event_started'));

-- Igual que la versión de la Fase 6, más: las salas programadas de una comunidad nacen con community_id y los
-- eventos avisan a quien confirmó (o dijo "tal vez") y, si piden sala, la abren a su hora.
create or replace function public.process_scheduled_work(p_now timestamptz default pg_catalog.now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s            public.room_schedules;
  ev           public.events;
  v_code       text;
  v_room       uuid;
  v_host_name  text;
  v_next       timestamptz;
  attempts     int;
  reminders    int := 0;
  opened       int := 0;
  devotionals  int := 0;
  closed       int := 0;
  event_notes  int := 0;
  n            int;
begin
  -- 1) Recordatorios previos a cada ocurrencia
  for s in
    select * from public.room_schedules rs
    where rs.is_active and rs.reminder_minutes > 0 and rs.next_occurrence_at is not null
      and rs.next_occurrence_at > p_now
      and rs.next_occurrence_at <= p_now + pg_catalog.make_interval(mins => rs.reminder_minutes)
  loop
    insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
    select ss.user_id, 'schedule_reminder', s.name,
           'Empieza en ' || pg_catalog.ceil(extract(epoch from (s.next_occurrence_at - p_now)) / 60)::int || ' minutos',
           '/programadas',
           'reminder:' || s.id || ':' || extract(epoch from s.next_occurrence_at)::bigint
    from public.schedule_subscriptions ss
    left join public.notification_preferences np on np.user_id = ss.user_id
    where ss.schedule_id = s.id and coalesce(np.schedule_reminders, true)
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count;
    reminders := reminders + n;
  end loop;

  -- 2) Abrir las salas cuya hora llegó
  for s in
    select * from public.room_schedules rs
    where rs.is_active and rs.next_occurrence_at is not null and rs.next_occurrence_at <= p_now
    order by rs.next_occurrence_at
    for update skip locked
  loop
    if s.next_occurrence_at >= p_now - interval '6 hours' then
      select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Anfitrión') into v_host_name
      from public.profiles p where p.id = s.owner_id;
      v_host_name := coalesce(v_host_name, 'Anfitrión');

      attempts := 0;
      loop
        attempts := attempts + 1;
        v_code := public.generate_room_code();
        begin
          insert into public.rooms (code, name, host_id, schedule_id, scheduled_at, community_id)
          values (v_code, s.name, s.owner_id, s.id, s.next_occurrence_at, s.community_id)
          returning id into v_room;
          exit;
        exception when unique_violation then
          if exists (select 1 from public.rooms r where r.schedule_id = s.id and r.scheduled_at = s.next_occurrence_at) then
            v_room := null;
            exit;
          end if;
          if attempts >= 10 then raise; end if;
        end;
      end loop;

      if v_room is not null then
        insert into public.room_members (room_id, user_id, role, display_name, left_at)
        values (v_room, s.owner_id, 'host', left(v_host_name, 40), p_now);

        insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
        select ss.user_id, 'schedule_started', s.name, 'Ya empezó la sala de oración', '/r/' || v_code,
               'start:' || s.id || ':' || extract(epoch from s.next_occurrence_at)::bigint
        from public.schedule_subscriptions ss
        left join public.notification_preferences np on np.user_id = ss.user_id
        where ss.schedule_id = s.id and coalesce(np.schedule_reminders, true)
        on conflict (user_id, dedupe_key) do nothing;

        update public.room_schedules rs set last_room_id = v_room where rs.id = s.id;
        opened := opened + 1;
      end if;
    end if;

    v_next := public.compute_next_occurrence(s.recurrence, s.local_time, s.start_date, s.weekdays, s.timezone, greatest(p_now, s.next_occurrence_at));
    update public.room_schedules rs
    set next_occurrence_at = v_next, is_active = (v_next is not null)
    where rs.id = s.id;
  end loop;

  -- 3) Recordatorio diario del devocional (a la hora local de cada persona, hasta 3 horas después)
  insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
  select np.user_id, 'devotional_reminder', 'Tu devocional de hoy', 'Tómate unos minutos con Dios.', '/devocional',
         'devotional:' || d.devotional_date
  from public.notification_preferences np
  join public.profiles p on p.id = np.user_id
  join public.devotionals d on d.community_id is null and d.devotional_date = (p_now at time zone p.timezone)::date
  where np.devotional_reminder
    and p_now >= (((p_now at time zone p.timezone)::date + np.devotional_reminder_time) at time zone p.timezone)
    and p_now <  (((p_now at time zone p.timezone)::date + np.devotional_reminder_time) at time zone p.timezone) + interval '3 hours'
    and not exists (
      select 1 from public.devotional_progress dp
      where dp.user_id = np.user_id and dp.devotional_id = d.id and dp.read_at is not null
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics devotionals = row_count;

  -- 4) Eventos: recordatorio a quien va (o tal vez)…
  insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
  select r.user_id, 'event_reminder', e.title,
         'Empieza en ' || pg_catalog.ceil(extract(epoch from (e.starts_at - p_now)) / 60)::int || ' minutos',
         '/comunidades/' || e.community_id || '/eventos',
         'event-reminder:' || e.id
  from public.events e
  join public.event_rsvps r on r.event_id = e.id and r.status in ('going', 'maybe')
  left join public.notification_preferences np on np.user_id = r.user_id
  where e.reminder_minutes > 0 and e.starts_at > p_now
    and e.starts_at <= p_now + pg_catalog.make_interval(mins => e.reminder_minutes)
    and coalesce(np.schedule_reminders, true)
    and exists (select 1 from public.community_members cm where cm.community_id = e.community_id and cm.user_id = r.user_id)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  event_notes := event_notes + n;

  --    …y, si el evento pide sala, abrirla a su hora (con la misma tolerancia de 6 horas)
  for ev in
    select * from public.events e
    where e.opens_room and e.room_id is null and e.starts_at <= p_now and e.starts_at >= p_now - interval '6 hours'
      and e.created_by is not null
    order by e.starts_at
    for update skip locked
  loop
    select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Anfitrión') into v_host_name
    from public.profiles p where p.id = ev.created_by;
    v_host_name := coalesce(v_host_name, 'Anfitrión');

    attempts := 0;
    loop
      attempts := attempts + 1;
      v_code := public.generate_room_code();
      begin
        insert into public.rooms (code, name, host_id, community_id) values (v_code, left(ev.title, 60), ev.created_by, ev.community_id)
        returning id into v_room;
        exit;
      exception when unique_violation then
        if attempts >= 10 then raise; end if;
      end;
    end loop;

    insert into public.room_members (room_id, user_id, role, display_name, left_at)
    values (v_room, ev.created_by, 'host', left(v_host_name, 40), p_now);
    update public.events e set room_id = v_room where e.id = ev.id;
    opened := opened + 1;

    insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
    select r.user_id, 'event_started', ev.title, 'Ya empezó: entra a la sala de oración', '/r/' || v_code,
           'event-start:' || ev.id
    from public.event_rsvps r
    left join public.notification_preferences np on np.user_id = r.user_id
    where r.event_id = ev.id and r.status in ('going', 'maybe') and coalesce(np.schedule_reminders, true)
      and exists (select 1 from public.community_members cm where cm.community_id = ev.community_id and cm.user_id = r.user_id)
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count;
    event_notes := event_notes + n;
  end loop;

  -- 5) Limpieza: salas vacías abiertas hace más de 3 horas y avisos de hace más de 30 días
  with stale as (
    update public.rooms r set status = 'closed', closed_at = p_now
    where r.status = 'open' and r.created_at < p_now - interval '3 hours'
      and not exists (select 1 from public.room_members rm where rm.room_id = r.id and rm.left_at is null)
    returning r.id
  )
  select pg_catalog.count(*)::int into closed from stale;

  delete from public.notifications nf where nf.created_at < p_now - interval '30 days';

  return pg_catalog.jsonb_build_object('reminders', reminders, 'rooms_opened', opened, 'devotional_reminders', devotionals,
                                       'rooms_closed', closed, 'event_notifications', event_notes);
end;
$$;

-- ───────────────────────── Permisos de ejecución ─────────────────────────

revoke all on function
  public.community_role(uuid), public.is_community_member(uuid), public.is_community_leader(uuid),
  public.is_community_admin(uuid), public.is_community_admin_folder(text), public.is_event_member(uuid),
  public.can_manage_schedule(uuid), public.sync_profile_to_communities(),
  public.create_community(text, text, text), public.peek_community(text), public.join_community(text),
  public.leave_community(uuid), public.set_member_role(uuid, uuid, text), public.remove_community_member(uuid, uuid),
  public.get_community_invite(uuid), public.regenerate_community_invite(uuid),
  public.create_community_room(uuid, text, text), public.follow_community_schedule(uuid),
  public.create_schedule(text, text, time, date, smallint[], text, int, uuid),
  public.create_event(uuid, text, text, date, time, text, int, boolean, int), public.set_rsvp(uuid, text),
  public.process_scheduled_work(timestamptz)
from public, anon, authenticated;

-- Las funciones auxiliares de RLS las evalúa quien consulta (authenticated)
grant execute on function
  public.community_role(uuid), public.is_community_member(uuid), public.is_community_leader(uuid),
  public.is_community_admin(uuid), public.is_community_admin_folder(text), public.is_event_member(uuid),
  public.can_manage_schedule(uuid)
to authenticated;

grant execute on function
  public.create_community(text, text, text), public.join_community(text), public.leave_community(uuid),
  public.set_member_role(uuid, uuid, text), public.remove_community_member(uuid, uuid),
  public.get_community_invite(uuid), public.regenerate_community_invite(uuid),
  public.create_community_room(uuid, text, text), public.follow_community_schedule(uuid),
  public.create_schedule(text, text, time, date, smallint[], text, int, uuid),
  public.create_event(uuid, text, text, date, time, text, int, boolean, int), public.set_rsvp(uuid, text)
to authenticated;
grant execute on function public.peek_community(text) to anon, authenticated;
grant execute on function public.process_scheduled_work(timestamptz) to service_role;
