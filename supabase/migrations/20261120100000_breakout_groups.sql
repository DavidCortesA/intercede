-- Fase 11 — Grupos pequeños dentro de una sala (CLAUDE.md §16 B2).
--
-- Principios:
--   * Cada grupo es una sala de LiveKit APARTE (`bg-<id>`), creada por el servidor al emitir el primer token. El navegador solo
--     recibe un token de grupo si la BASE dice que la persona está asignada a ese grupo (o es la anfitriona).
--   * Una persona está en UNA sala a la vez: sus minutos cuentan una sola vez (el webhook de LiveKit suma los de un grupo a la
--     sala principal). Las salas de grupo NO cuentan como salas simultáneas.
--   * El regreso a la sala principal NO depende de la anfitriona: cada dispositivo vuelve al terminar el tiempo (hora del
--     servidor) y el servidor, además, cierra los grupos vencidos (pg_cron → /api/billing/enforce).
--   * Plan: Plus hasta 10 grupos y Pro hasta 20 (`plans.limits.breakout_groups`); el plan gratuito y las salas personales: 0.

-- ───────────────────────── Tablas ─────────────────────────

create table public.room_breakouts (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  status       text not null default 'active' check (status in ('active', 'ended')),
  started_by   uuid references auth.users (id) on delete set null,
  minutes      int not null check (minutes between 1 and 60),
  started_at   timestamptz not null default now(),
  ends_at      timestamptz not null,
  ended_at     timestamptz,
  -- Aviso de la anfitriona a todos ("Regresamos en 2 minutos")
  announcement text check (announcement is null or char_length(btrim(announcement)) between 1 and 140),
  announced_at timestamptz,
  constraint room_breakouts_ended_consistency check ((status = 'ended') = (ended_at is not null))
);

-- Un solo reparto activo por sala
create unique index room_breakouts_one_active on public.room_breakouts (room_id) where status = 'active';

create table public.breakout_groups (
  id           uuid primary key default gen_random_uuid(),
  breakout_id  uuid not null references public.room_breakouts (id) on delete cascade,
  position     int not null check (position between 1 and 20),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  -- Nombre de la sala de audio en LiveKit
  livekit_room text not null unique,
  -- Petición por la que ora este grupo (opcional)
  request_id   uuid references public.prayer_requests (id) on delete set null,
  unique (breakout_id, position)
);

create table public.breakout_assignments (
  breakout_id uuid not null references public.room_breakouts (id) on delete cascade,
  group_id    uuid not null references public.breakout_groups (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Una persona, un grupo por reparto
  primary key (breakout_id, user_id)
);

create index breakout_assignments_group_idx on public.breakout_assignments (group_id);

comment on table public.room_breakouts is 'Reparto de una sala en grupos pequeños. Solo se escribe con RPC (start_breakout, end_breakout, announce_breakout).';
comment on table public.breakout_assignments is 'Quién está en qué grupo. Cada quien ve el suyo y quienes comparten grupo; la anfitriona ve todos.';

-- ───────────────────────── Funciones auxiliares (RLS) ─────────────────────────

create function public.breakout_room(p_breakout_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select b.room_id from public.room_breakouts b where b.id = p_breakout_id; $$;

create function public.in_breakout_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.breakout_assignments a where a.group_id = p_group_id and a.user_id = (select auth.uid()));
$$;

-- ───────────────────────── Reparto ─────────────────────────
-- Códigos: not_authenticated, not_host, plan_required, breakout_active, no_breakout, invalid_groups, too_many_groups,
-- invalid_duration, not_enough_people, invalid_assignments, request_not_found, invalid_message, not_assigned, breakout_ended

-- Inicia el reparto. Sin `p_assignments` el reparto es ALEATORIO y parejo entre quienes están presentes; con él, manual
-- ({"<user_id>": <número de grupo>}): quien no aparezca se queda en la sala principal. La anfitriona nunca se asigna.
create function public.start_breakout(
  p_room_id uuid, p_group_count int, p_minutes int, p_assignments jsonb default null, p_requests uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_room  public.rooms;
  v_limit int;
  v_people uuid[];
  v_id    uuid;
  v_group uuid;
  i       int;
  e       record;
  v_user  uuid;
  v_num   int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_room from public.rooms r where r.id = p_room_id and r.host_id = uid and r.status = 'open' for update;
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;

  v_limit := coalesce(((public.entitlements_for(v_room.community_id)) ->> 'breakout_groups')::int, 0);
  if v_limit = 0 then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if p_group_count is null or p_group_count < 2 then raise exception 'invalid_groups' using errcode = 'P0001'; end if;
  if p_group_count > v_limit then raise exception 'too_many_groups' using errcode = 'P0001'; end if;
  if p_minutes is null or p_minutes not between 1 and 60 then raise exception 'invalid_duration' using errcode = 'P0001'; end if;
  if exists (select 1 from public.room_breakouts b where b.room_id = p_room_id and b.status = 'active') then
    raise exception 'breakout_active' using errcode = 'P0001';
  end if;

  select coalesce(pg_catalog.array_agg(rm.user_id order by rm.joined_at), '{}') into v_people
  from public.room_members rm
  where rm.room_id = p_room_id and rm.left_at is null and rm.removed_at is null and rm.user_id <> uid;
  if pg_catalog.cardinality(v_people) < p_group_count then raise exception 'not_enough_people' using errcode = 'P0001'; end if;

  if p_requests is not null then
    if pg_catalog.cardinality(p_requests) > p_group_count then raise exception 'request_not_found' using errcode = 'P0001'; end if;
    if exists (
      select 1 from pg_catalog.unnest(p_requests) as r(id)
      where r.id is not null and not exists (select 1 from public.prayer_requests pr where pr.id = r.id and pr.room_id = p_room_id)
    ) then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  end if;

  insert into public.room_breakouts (room_id, started_by, minutes, ends_at)
  values (p_room_id, uid, p_minutes, pg_catalog.now() + pg_catalog.make_interval(mins => p_minutes))
  returning id into v_id;

  for i in 1 .. p_group_count loop
    v_group := pg_catalog.gen_random_uuid();
    insert into public.breakout_groups (id, breakout_id, position, name, livekit_room, request_id)
    values (v_group, v_id, i, 'Grupo ' || i::text, 'bg-' || v_group::text, case when p_requests is null then null else p_requests[i] end);
  end loop;

  if p_assignments is null then
    -- Aleatorio y parejo: se baraja y se reparte de uno en uno
    insert into public.breakout_assignments (breakout_id, group_id, user_id)
    select v_id, g.id, s.user_id
    from (select u.user_id, pg_catalog.row_number() over (order by pg_catalog.random()) as rn from pg_catalog.unnest(v_people) as u(user_id)) s
    join public.breakout_groups g on g.breakout_id = v_id and g.position = ((s.rn - 1) % p_group_count) + 1;
  else
    if pg_catalog.jsonb_typeof(p_assignments) <> 'object' then raise exception 'invalid_assignments' using errcode = 'P0001'; end if;
    for e in select * from pg_catalog.jsonb_each_text(p_assignments) loop
      begin
        v_user := e.key::uuid;
        v_num := e.value::int;
      exception when others then
        raise exception 'invalid_assignments' using errcode = 'P0001';
      end;
      if v_num not between 1 and p_group_count or not (v_user = any (v_people)) then
        raise exception 'invalid_assignments' using errcode = 'P0001';
      end if;
      insert into public.breakout_assignments (breakout_id, group_id, user_id)
      select v_id, g.id, v_user from public.breakout_groups g where g.breakout_id = v_id and g.position = v_num;
    end loop;
  end if;

  return v_id;
end;
$$;

-- La anfitriona termina el reparto: todos vuelven a la sala principal. Devuelve las salas de audio de los grupos para que el
-- servidor las cierre en LiveKit.
create function public.end_breakout(p_room_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_rooms text[];
begin
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = (select auth.uid())) then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  update public.room_breakouts b set status = 'ended', ended_at = pg_catalog.now()
  where b.room_id = p_room_id and b.status = 'active' returning b.id into v_id;
  if v_id is null then raise exception 'no_breakout' using errcode = 'P0001'; end if;

  select coalesce(pg_catalog.array_agg(g.livekit_room), '{}') into v_rooms from public.breakout_groups g where g.breakout_id = v_id;
  return v_rooms;
end;
$$;

create function public.announce_breakout(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg text := pg_catalog.btrim(coalesce(p_message, ''));
begin
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = (select auth.uid()) and r.status = 'open') then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_msg) not between 1 and 140 then raise exception 'invalid_message' using errcode = 'P0001'; end if;
  update public.room_breakouts b set announcement = v_msg, announced_at = pg_catalog.now()
  where b.room_id = p_room_id and b.status = 'active';
  if not found then raise exception 'no_breakout' using errcode = 'P0001'; end if;
end;
$$;

-- Acceso a la sala de audio de un grupo (lo usa el servidor ANTES de emitir el token, como la persona): solo quien está
-- asignada al grupo o la anfitriona, y solo mientras el reparto siga vigente (con 15 s de margen para reconectar).
create function public.get_breakout_access(p_room_id uuid, p_group_id uuid)
returns table (livekit_room text, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  return query
  select g.livekit_room, b.ends_at
  from public.breakout_groups g
  join public.room_breakouts b on b.id = g.breakout_id
  join public.rooms r on r.id = b.room_id
  where g.id = p_group_id and b.room_id = p_room_id and r.status = 'open'
    and (r.host_id = uid or exists (select 1 from public.breakout_assignments a where a.group_id = g.id and a.user_id = uid))
    and b.status = 'active' and b.ends_at + interval '15 seconds' > pg_catalog.now();
  if not found then
    raise exception 'not_assigned' using errcode = 'P0001';
  end if;
end;
$$;

-- ───────────────────────── Cierre (servidor) ─────────────────────────

-- Reparto vencido: se cierra y se devuelven las salas de audio para cortarlas. Margen de 15 s (los dispositivos vuelven solos
-- al terminar el tiempo; esto limpia a quien no lo hizo).
create function public.end_expired_breakouts()
returns setof text
language sql
security definer
set search_path = ''
as $$
  with ended as (
    update public.room_breakouts b set status = 'ended', ended_at = pg_catalog.now()
    where b.status = 'active' and b.ends_at + interval '15 seconds' < pg_catalog.now()
    returning b.id
  )
  select g.livekit_room from public.breakout_groups g join ended e on e.id = g.breakout_id;
$$;

-- Salas de audio de los grupos de una sala (para cortarlas al cerrarla o al expulsar a alguien)
create function public.breakout_group_rooms(p_room_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select g.livekit_room from public.breakout_groups g join public.room_breakouts b on b.id = g.breakout_id
  where b.room_id = p_room_id and b.status = 'active';
$$;

-- Sala principal a la que pertenece una sala de audio de grupo (el webhook de uso suma sus minutos a la sala principal)
create function public.breakout_main_room(p_livekit_room text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.room_id from public.breakout_groups g join public.room_breakouts b on b.id = g.breakout_id where g.livekit_room = p_livekit_room;
$$;

-- Cerrar la sala principal termina el reparto
create function public.rooms_end_breakouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_breakouts b set status = 'ended', ended_at = pg_catalog.now() where b.room_id = new.id and b.status = 'active';
  return new;
end;
$$;

create trigger rooms_end_breakouts
  after update of status on public.rooms
  for each row when (new.status = 'closed' and old.status <> 'closed')
  execute function public.rooms_end_breakouts();

-- El cierre programado también llama al servidor cuando hay repartos vencidos
create or replace function public.invoke_enforcer()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'enforcer_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'enforcer_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.rooms r where r.status = 'open' and r.ends_at + interval '5 minutes' < pg_catalog.now())
     and not exists (select 1 from public.room_breakouts b where b.status = 'active' and b.ends_at + interval '15 seconds' < pg_catalog.now()) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-enforcer-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

-- ───────────────────────── RLS ─────────────────────────

alter table public.room_breakouts enable row level security;
alter table public.breakout_groups enable row level security;
alter table public.breakout_assignments enable row level security;

-- Quienes están en la sala ven el reparto y sus grupos (nombres, tiempo, aviso); quién está en cada grupo, solo la anfitriona
-- y quienes comparten grupo
create policy "room_breakouts_select_members" on public.room_breakouts for select to authenticated
  using (public.is_room_member(room_id));
create policy "breakout_groups_select_members" on public.breakout_groups for select to authenticated
  using (public.is_room_member(public.breakout_room(breakout_id)));
create policy "breakout_assignments_select" on public.breakout_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_room_host(public.breakout_room(breakout_id))
    or public.in_breakout_group(group_id)
  );

revoke all on public.room_breakouts, public.breakout_groups, public.breakout_assignments from anon, authenticated;
grant select on public.room_breakouts, public.breakout_groups, public.breakout_assignments to authenticated;

alter publication supabase_realtime add table public.room_breakouts, public.breakout_groups, public.breakout_assignments;

-- ───────────────────────── Permisos de ejecución ─────────────────────────

revoke all on function
  public.breakout_room(uuid), public.in_breakout_group(uuid), public.start_breakout(uuid, int, int, jsonb, uuid[]),
  public.end_breakout(uuid), public.announce_breakout(uuid, text), public.get_breakout_access(uuid, uuid),
  public.end_expired_breakouts(), public.breakout_group_rooms(uuid), public.breakout_main_room(text), public.rooms_end_breakouts()
from public, anon, authenticated;

grant execute on function
  public.breakout_room(uuid), public.in_breakout_group(uuid), public.start_breakout(uuid, int, int, jsonb, uuid[]),
  public.end_breakout(uuid), public.announce_breakout(uuid, text), public.get_breakout_access(uuid, uuid)
to authenticated;
grant execute on function public.end_expired_breakouts(), public.breakout_group_rooms(uuid), public.breakout_main_room(text) to service_role;
