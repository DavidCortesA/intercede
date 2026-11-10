-- Fase 8 — Moderación (reportes y bloqueos), eliminación de cuenta y auditoría de seguridad.
--
-- Principios:
--   * Reportar es posible solo sobre lo que la persona puede ver (sala en la que estuvo, petición que lee,
--     persona con la que coincidió): no sirve para sondear ids ni para acosar a quien no se conoce.
--   * Bloquear oculta el contenido en ambos sentidos (el muro de la comunidad y las peticiones de las salas),
--     pero NO le quita a la anfitriona ni al liderazgo su capacidad de moderar.
--   * Los reportes los lee quien reportó y el liderazgo de la comunidad afectada; el resto (plataforma) usa la
--     service role (panel interno futuro: CLAUDE.md §5.6).
--   * Borrar la cuenta es una cascada completa (todas las llaves hacia auth.users caen); las comunidades que
--     quedarían sin admin se transfieren o, si estaban vacías, se eliminan.

-- ───────────────────────── Bloqueos ─────────────────────────

create table public.blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- ¿Comparte la persona alguna sala o comunidad con `p_user_id`? (condición para reportar o bloquear)
create function public.shares_context_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  ) or exists (
    select 1
    from public.community_members mine
    join public.community_members theirs on theirs.community_id = mine.community_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

-- ¿Hay un bloqueo entre la persona y `p_other` (en cualquiera de los dos sentidos)?
create function public.is_blocked_between(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = (select auth.uid()))
  );
$$;

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select, delete on public.blocks to authenticated;

-- Quien bloquea ve y quita sus bloqueos; la otra persona no sabe que la bloquearon
create policy "blocks_select_own" on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy "blocks_delete_own" on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

-- Códigos de error: not_authenticated, cannot_block_self, no_shared_context, too_many_blocks
create function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_user_id = uid then raise exception 'cannot_block_self' using errcode = 'P0001'; end if;
  if not public.shares_context_with(p_user_id) then raise exception 'no_shared_context' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.blocks b where b.blocker_id = uid) >= 200 then
    raise exception 'too_many_blocks' using errcode = 'P0001';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (uid, p_user_id) on conflict do nothing;
end;
$$;

-- Efecto de bloquear 1: el muro de la comunidad (el liderazgo siempre ve todo, para poder moderar)
drop policy "community_requests_select_visible" on public.community_requests;
create policy "community_requests_select_visible"
  on public.community_requests for select to authenticated
  using (
    public.is_community_member(community_id)
    and (visibility = 'community' or author_id = (select auth.uid()) or public.is_community_leader(community_id))
    and (author_id = (select auth.uid()) or public.is_community_leader(community_id) or not public.is_blocked_between(author_id))
  );

-- Efecto de bloquear 2: las peticiones de las salas (la anfitriona ve todo). Realtime respeta esta política.
drop policy "prayer_requests_select" on public.prayer_requests;
create policy "prayer_requests_select"
  on public.prayer_requests for select to authenticated
  using (
    author_id = (select auth.uid())
    or (public.is_room_member(room_id) and (public.is_room_host(room_id) or not public.is_blocked_between(author_id)))
  );

-- Efecto de bloquear 3: quien la anfitriona bloqueó no entra a sus salas (se le responde como si la hubieran sacado)
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
  if exists (select 1 from public.blocks b where b.blocker_id = v_room.host_id and b.blocked_id = uid) then
    raise exception 'removed' using errcode = 'P0001';
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

-- ───────────────────────── Reportes ─────────────────────────

create table public.reports (
  id             uuid primary key default gen_random_uuid(),
  -- Si la persona que reportó borra su cuenta, el reporte se conserva sin su identidad
  reporter_id    uuid references auth.users (id) on delete set null,
  target_type    text not null check (target_type in ('room', 'prayer_request', 'community_request', 'user')),
  target_id      uuid not null,
  -- Autor/a o anfitrión/a del contenido (para ver reincidencia); no es llave foránea con cascada
  target_user_id uuid references auth.users (id) on delete set null,
  -- Comunidad afectada (el liderazgo de esa comunidad ve el reporte)
  community_id   uuid references public.communities (id) on delete cascade,
  reason         text not null check (reason in ('harassment', 'hate', 'spam', 'inappropriate', 'self_harm', 'other')),
  details        text check (details is null or char_length(btrim(details)) between 1 and 500),
  status         text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references auth.users (id) on delete set null,
  constraint reports_resolved_consistency check ((status = 'open') = (resolved_at is null))
);

create unique index reports_one_open_per_reporter_idx on public.reports (reporter_id, target_type, target_id) where status = 'open';
create index reports_queue_idx on public.reports (status, created_at desc);
create index reports_community_idx on public.reports (community_id, status) where community_id is not null;

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

create policy "reports_select_reporter_or_leaders"
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (community_id is not null and public.is_community_leader(community_id)));

-- Códigos de error: not_authenticated, invalid_target, target_not_found, own_content, no_shared_context,
-- invalid_reason, invalid_details, already_reported, too_many_reports
create function public.create_report(
  p_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null,
  p_community_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_details text := nullif(pg_catalog.btrim(coalesce(p_details, '')), '');
  v_target_user uuid;
  v_community   uuid;
  v_room        uuid;
  v_visibility  text;
  v_id          uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_reason not in ('harassment', 'hate', 'spam', 'inappropriate', 'self_harm', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  if v_details is not null and pg_catalog.char_length(v_details) > 500 then
    raise exception 'invalid_details' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from public.reports r where r.reporter_id = uid and r.created_at > pg_catalog.now() - interval '1 day') >= 20 then
    raise exception 'too_many_reports' using errcode = 'P0001';
  end if;

  if p_type = 'room' then
    select r.host_id, r.community_id into v_target_user, v_community from public.rooms r where r.id = p_target_id;
    if not found or not public.has_joined_room(p_target_id) then raise exception 'target_not_found' using errcode = 'P0001'; end if;

  elsif p_type = 'prayer_request' then
    select pr.author_id, pr.room_id into v_target_user, v_room from public.prayer_requests pr where pr.id = p_target_id;
    if not found or not public.has_joined_room(v_room) then raise exception 'target_not_found' using errcode = 'P0001'; end if;
    select r.community_id into v_community from public.rooms r where r.id = v_room;

  elsif p_type = 'community_request' then
    select cr.author_id, cr.community_id, cr.visibility into v_target_user, v_community, v_visibility
    from public.community_requests cr where cr.id = p_target_id;
    if not found or not public.is_community_member(v_community)
       or (v_visibility = 'leaders' and v_target_user <> uid and not public.is_community_leader(v_community)) then
      raise exception 'target_not_found' using errcode = 'P0001';
    end if;

  elsif p_type = 'user' then
    if p_target_id = uid then raise exception 'own_content' using errcode = 'P0001'; end if;
    if not public.shares_context_with(p_target_id) then raise exception 'no_shared_context' using errcode = 'P0001'; end if;
    v_target_user := p_target_id;
    -- Si se reporta desde una comunidad en la que ambas personas están, el liderazgo también lo ve
    if p_community_id is not null and exists (
      select 1 from public.community_members a join public.community_members b on b.community_id = a.community_id
      where a.community_id = p_community_id and a.user_id = uid and b.user_id = p_target_id
    ) then
      v_community := p_community_id;
    end if;
  else
    raise exception 'invalid_target' using errcode = 'P0001';
  end if;

  if p_type <> 'user' and v_target_user = uid then raise exception 'own_content' using errcode = 'P0001'; end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, target_user_id, community_id, reason, details)
    values (uid, p_type, p_target_id, v_target_user, v_community, p_reason, v_details)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_reported' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

-- El liderazgo de la comunidad atiende los reportes de su comunidad (la plataforma usa la service role)
create function public.resolve_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
begin
  if p_status not in ('resolved', 'dismissed', 'open') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  select r.community_id into v_community from public.reports r where r.id = p_report_id;
  if not found or v_community is null or not public.is_community_leader(v_community) then
    raise exception 'not_leader' using errcode = 'P0001';
  end if;
  update public.reports r
  set status = p_status,
      resolved_at = case when p_status = 'open' then null else pg_catalog.now() end,
      resolved_by = case when p_status = 'open' then null else (select auth.uid()) end
  where r.id = p_report_id;
end;
$$;

-- ───────────────────────── Eliminación de cuenta ─────────────────────────

-- Prepara el borrado de una cuenta (solo la service role: la llama la ruta /api/account/delete).
-- Las comunidades en las que era la única persona admin: si hay más gente, la administración pasa a
-- quien lleva más tiempo (liderazgo primero); si estaba sola, la comunidad se elimina. Devuelve lo que
-- hay que limpiar fuera de la base (archivos de logos, salas de audio abiertas).
create function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c            record;
  v_heir       uuid;
  deleted_ids  uuid[] := '{}';
  heirs        jsonb := '[]'::jsonb;
  open_rooms   uuid[];
begin
  for c in
    select cm.community_id from public.community_members cm
    where cm.user_id = p_user_id and cm.role = 'admin'
      and not exists (
        select 1 from public.community_members o
        where o.community_id = cm.community_id and o.role = 'admin' and o.user_id <> p_user_id
      )
  loop
    select o.user_id into v_heir
    from public.community_members o
    where o.community_id = c.community_id and o.user_id <> p_user_id
    order by (o.role = 'leader') desc, o.joined_at, o.user_id
    limit 1;

    if v_heir is null then
      delete from public.communities cc where cc.id = c.community_id;
      deleted_ids := deleted_ids || c.community_id;
    else
      update public.community_members cm set role = 'admin' where cm.community_id = c.community_id and cm.user_id = v_heir;
      heirs := heirs || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('community_id', c.community_id, 'user_id', v_heir));
    end if;
  end loop;

  select coalesce(pg_catalog.array_agg(r.id), '{}') into open_rooms
  from public.rooms r where r.host_id = p_user_id and r.status = 'open';

  return pg_catalog.jsonb_build_object('deleted_communities', pg_catalog.to_jsonb(deleted_ids), 'transferred', heirs, 'open_rooms', pg_catalog.to_jsonb(open_rooms));
end;
$$;

-- Las personas que entraron como invitadas y no volvieron se borran solas (minimización de datos)
-- `p_only` limita el borrado a esas cuentas (pruebas y operación manual); nulo = todas las que cumplan
create function public.purge_inactive_guests(p_days int default 90, p_only uuid[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with gone as (
    delete from auth.users u
    where u.is_anonymous
      and (p_only is null or u.id = any (p_only))
      and coalesce(u.last_sign_in_at, u.created_at) < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
      and u.created_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
      and not exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at > pg_catalog.now() - pg_catalog.make_interval(days => p_days))
    returning 1
  )
  select pg_catalog.count(*)::int into n from gone;
  return n;
end;
$$;

select cron.schedule('purge-inactive-guests', '17 4 * * 0', $$select public.purge_inactive_guests()$$);

-- ───────────────────────── Auditoría de seguridad ─────────────────────────

-- Revisa la propia base (también el proyecto remoto): lo que debería estar cerrado y no lo está.
-- Solo la service role la ejecuta; las pruebas exigen que no devuelva nada inesperado.
create function public.security_audit()
returns table (category text, object_name text, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  -- 1) Tablas sin RLS
  select 'rls_disabled'::text, c.relname::text, 'La tabla no tiene RLS activado'::text
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  -- 2) Tablas con RLS pero sin ninguna política (nadie podría leer ni escribir: probablemente un olvido)
  select 'rls_without_policies', c.relname::text, 'RLS activado pero sin políticas'
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid)
  union all
  -- 3) Funciones SECURITY DEFINER sin search_path fijo (riesgo de suplantación de objetos)
  select 'definer_without_search_path', (p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text,
         'SECURITY DEFINER sin search_path fijo'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')
  union all
  -- 4) Funciones que se pueden llamar sin sesión (rol anon). Las de trigger no se pueden llamar directamente.
  select 'anon_can_execute', (p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text,
         'El rol anon puede ejecutarla'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
  union all
  -- 5) Tablas con permisos para anon (sin sesión)
  select 'anon_table_privilege', g.table_name::text, ('anon tiene ' || g.privilege_type)::text
  from information_schema.role_table_grants g
  where g.grantee = 'anon' and g.table_schema = 'public'
  union all
  -- 6) Buckets públicos sin límite de tamaño o de tipos de archivo
  select 'bucket_unrestricted', b.id::text, 'Bucket público sin límite de tamaño o de tipos de archivo'
  from storage.buckets b
  where b.public and (b.file_size_limit is null or b.allowed_mime_types is null)
  union all
  -- 7) Buckets sin ninguna política de escritura
  select 'bucket_without_write_policy', b.id::text, 'Sin política de inserción en storage.objects'
  from storage.buckets b
  where not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid and c.relname = 'objects'
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'storage'
    where p.polcmd in ('a', '*') and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) like '%' || b.id || '%'
  );
$$;

-- ───────────────────────── Permisos de ejecución ─────────────────────────

revoke all on function
  public.shares_context_with(uuid), public.is_blocked_between(uuid), public.block_user(uuid),
  public.create_report(text, uuid, text, text, uuid), public.resolve_report(uuid, text),
  public.prepare_account_deletion(uuid), public.purge_inactive_guests(int, uuid[]), public.security_audit()
from public, anon, authenticated;

grant execute on function public.shares_context_with(uuid), public.is_blocked_between(uuid) to authenticated;
grant execute on function public.block_user(uuid), public.create_report(text, uuid, text, text, uuid), public.resolve_report(uuid, text) to authenticated;
grant execute on function public.prepare_account_deletion(uuid), public.purge_inactive_guests(int, uuid[]), public.security_audit() to service_role;

-- Hallazgos de la primera auditoría: tres funciones quedaron ejecutables sin sesión por el permiso por
-- defecto. No exponían datos, pero se cierran: solo las vistas previas de invitación (peek_*) son públicas.
revoke all on function public.devotional_stats(), public.is_allowed_push_endpoint(text), public.is_permanent_user()
  from public, anon;
grant execute on function public.devotional_stats(), public.is_allowed_push_endpoint(text), public.is_permanent_user()
  to authenticated, service_role;
