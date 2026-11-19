-- Fase 9 — Planes, límites y cobros (CLAUDE.md §14).
--
-- Principios:
--   * Orar es gratis: el plan "Comunidad" (gratis) es el piso de todo el mundo. Quien paga compra CAPACIDAD
--     (duración, personas, salas simultáneas) y administración de organización.
--   * UNA sola fuente de límites: `entitlements_for(community)`. Los límites efectivos de una sala se FIJAN al crearla
--     (rooms.max_participants, rooms.ends_at) mediante un trigger; los pases y extensiones los suben después.
--   * Los precios y límites viven en tablas (`plans`, `products`), nunca escritos a mano en componentes.
--   * Todo se decide en la base (RLS y funciones SECURITY DEFINER con search_path vacío); errores estables (P0001).
--   * La pasarela es una capa delgada fuera de la base: aquí solo hay órdenes, eventos de pago idempotentes y el
--     cumplimiento (`fulfill_order`). Nada se activa por la redirección del navegador: solo por un evento de pago
--     verificado en el servidor.

-- ───────────────────────── Catálogo: planes y productos ─────────────────────────

create table public.plans (
  code              text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name              text not null,
  monthly_price_mxn int not null default 0 check (monthly_price_mxn >= 0),
  annual_price_mxn  int not null default 0 check (annual_price_mxn >= 0),
  trial_days        int not null default 0 check (trial_days between 0 and 60),
  -- Límites (ver CLAUDE.md §14.4 y §16.4). `null` en included_person_hours = el plan no mide horas-persona.
  limits            jsonb not null,
  sort_order        int not null default 0
);

create table public.products (
  code          text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  kind          text not null check (kind in ('pass', 'addon')),
  name          text not null,
  price_mxn     int not null check (price_mxn > 0),
  -- Precio para organizaciones con plan de pago (Plus/Pro); nulo = el mismo precio
  org_price_mxn int check (org_price_mxn is null or org_price_mxn > 0),
  -- Los extras mensuales duran 30 días por unidad; los demás, no
  is_monthly    boolean not null default false,
  limits        jsonb not null default '{}'::jsonb,
  sort_order    int not null default 0
);

insert into public.plans (code, name, monthly_price_mxn, annual_price_mxn, trial_days, limits, sort_order) values
  ('comunidad', 'Comunidad', 0, 0, 0,
   '{"max_members":30,"max_concurrent_rooms":4,"max_room_minutes":120,"max_room_participants":15,"included_person_hours":null,"max_cameras":4,"camera_quality":"360p","urgent_per_day":3,"breakout_groups":0,"own_guides":false,"stats":"none","branding":false}',
   1),
  ('plus', 'Plus', 499, 4990, 14,
   '{"max_members":100,"max_concurrent_rooms":10,"max_room_minutes":360,"max_room_participants":30,"included_person_hours":500,"max_cameras":12,"camera_quality":"720p","urgent_per_day":3,"breakout_groups":10,"own_guides":true,"stats":"last_30_days","branding":false}',
   2),
  ('pro', 'Pro', 1499, 14990, 0,
   '{"max_members":500,"max_concurrent_rooms":30,"max_room_minutes":720,"max_room_participants":100,"included_person_hours":1500,"max_cameras":25,"camera_quality":"720p","urgent_per_day":3,"breakout_groups":20,"own_guides":true,"stats":"history","branding":true}',
   3);

insert into public.products (code, kind, name, price_mxn, org_price_mxn, is_monthly, limits, sort_order) values
  ('sala_larga',     'pass',  'Sala Larga',     79,  null, false, '{"max_room_minutes":360,"max_room_participants":30}', 1),
  ('vigilia',        'pass',  'Vigilia',        249, 149,  false, '{"max_room_minutes":1440,"max_room_participants":30}', 2),
  ('vigilia_grande', 'pass',  'Vigilia Grande', 799, 479,  false, '{"max_room_minutes":1440,"max_room_participants":100}', 3),
  ('extension',      'pass',  'Extensión de sala', 39, null, false, '{"extend_minutes":120,"max_room_participants":30}', 4),
  ('members_50',     'addon', '+50 miembros',   99,  null, true,  '{"max_members":50}', 5),
  ('rooms_5',        'addon', '+5 salas simultáneas', 149, null, true, '{"max_concurrent_rooms":5}', 6),
  ('hours_100',      'addon', 'Bolsa de +100 horas-persona', 99, null, false, '{"person_minutes":6000,"valid_days":90}', 7);

comment on table public.plans is 'Planes de organización y sus límites. Los precios y límites se ajustan aquí, no en el código.';
comment on table public.products is 'Pases por evento y extras. org_price_mxn = precio con plan Plus/Pro.';

-- ───────────────────────── Suscripciones, órdenes, pases, extras ─────────────────────────

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  owner_type               text not null check (owner_type in ('user', 'community')),
  user_id                  uuid references auth.users (id) on delete cascade,
  community_id             uuid references public.communities (id) on delete cascade,
  plan_code                text not null references public.plans (code),
  status                   text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  billing_period           text not null default 'monthly' check (billing_period in ('monthly', 'annual')),
  provider                 text not null default 'none' check (provider in ('none', 'trial', 'conekta')),
  provider_subscription_id text,
  current_period_end       timestamptz not null,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  -- Exactamente un dueño; hoy solo se usan las de comunidad (la columna de usuario queda lista para después)
  constraint subscriptions_one_owner check (
    (owner_type = 'user' and user_id is not null and community_id is null)
    or (owner_type = 'community' and community_id is not null and user_id is null)
  ),
  constraint subscriptions_one_per_community unique (community_id),
  constraint subscriptions_one_per_user unique (user_id)
);

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  -- Los registros de cobro se conservan aunque se borre la cuenta (sin identidad)
  buyer_id          uuid references auth.users (id) on delete set null,
  community_id      uuid references public.communities (id) on delete set null,
  kind              text not null check (kind in ('plan', 'pass', 'addon')),
  item_code         text not null,
  billing_period    text check (billing_period in ('monthly', 'annual')),
  quantity          int not null default 1 check (quantity between 1 and 10),
  -- Sala a la que se aplica el pase al pagarse (opcional; obligatoria para extensiones)
  room_id           uuid references public.rooms (id) on delete set null,
  amount_mxn        int not null check (amount_mxn > 0),
  status            text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed', 'canceled', 'refunded')),
  provider          text not null default 'conekta' check (provider in ('conekta')),
  provider_order_id text unique,
  checkout_url      text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_community_idx on public.orders (community_id, created_at desc);

create table public.passes (
  id           uuid primary key default gen_random_uuid(),
  buyer_id     uuid references auth.users (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  product_code text not null references public.products (code),
  order_id     uuid references public.orders (id) on delete set null,
  -- available = pagado y sin usar; applied = en una sala; expired/refunded = ya no sirve
  status       text not null default 'available' check (status in ('available', 'applied', 'expired', 'refunded')),
  room_id      uuid references public.rooms (id) on delete set null,
  limits       jsonb not null,
  created_at   timestamptz not null default now(),
  -- Disponible: fecha límite para usarlo. Aplicado: hasta cuándo rige en la sala
  starts_at    timestamptz,
  expires_at   timestamptz not null
);

create index passes_buyer_idx on public.passes (buyer_id, created_at desc);
create index passes_community_idx on public.passes (community_id);

create table public.addons (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities (id) on delete cascade,
  kind              text not null references public.products (code),
  quantity          int not null default 1 check (quantity between 1 and 10),
  order_id          uuid references public.orders (id) on delete set null,
  expires_at        timestamptz not null,
  -- Solo bolsas de horas: minutos que quedan por consumir
  minutes_remaining int check (minutes_remaining is null or minutes_remaining >= 0),
  created_at        timestamptz not null default now()
);

create index addons_community_idx on public.addons (community_id, kind);

-- ───────────────────────── Uso (medición) y eventos de pago ─────────────────────────

-- Un registro por cada vez que alguien estuvo conectado a una sala (lo alimenta el webhook de LiveKit). Contiene
-- minutos por persona: NO lo lee nadie desde la app (solo la service role); la app solo ve agregados por comunidad.
create table public.usage_events (
  id               uuid primary key default gen_random_uuid(),
  livekit_event_id text not null unique,
  room_id          uuid references public.rooms (id) on delete set null,
  community_id     uuid references public.communities (id) on delete set null,
  user_id          uuid references auth.users (id) on delete set null,
  joined_at        timestamptz not null,
  left_at          timestamptz not null,
  minutes          int not null check (minutes > 0),
  constraint usage_events_order check (left_at >= joined_at)
);

create index usage_events_community_idx on public.usage_events (community_id, left_at);

create table public.usage_periods (
  community_id      uuid not null references public.communities (id) on delete cascade,
  period            date not null,
  person_minutes    int not null default 0 check (person_minutes >= 0),
  -- Minutos de este mes que ya se descontaron de bolsas de horas
  pack_minutes_used int not null default 0 check (pack_minutes_used >= 0),
  primary key (community_id, period)
);

create table public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  -- Único: el mismo evento entregado dos veces se procesa una sola vez
  provider_event_id text not null,
  type              text not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  error             text,
  unique (provider, provider_event_id)
);

comment on table public.usage_events is 'Minutos conectados por persona y sala. Solo la service role la lee; la app muestra agregados.';
comment on table public.payment_events is 'Eventos de la pasarela (idempotencia por provider_event_id). Solo la service role.';

-- ───────────────────────── Límites efectivos de una sala ─────────────────────────

alter table public.rooms
  add column max_participants int check (max_participants is null or max_participants between 2 and 100),
  add column ends_at timestamptz;

-- Las salas que ya existían conservan su aforo (20) y, si siguen abiertas, empiezan una ventana de 2 h desde ahora
update public.rooms r
set max_participants = 20,
    ends_at = case when r.status = 'open' then pg_catalog.now() + interval '2 hours' else coalesce(r.closed_at, r.created_at) end;

alter table public.rooms
  alter column max_participants set not null,
  alter column ends_at set not null;

-- ¿Qué plan rige HOY en una comunidad? Sin comunidad (sala personal) o sin plan vigente: el gratuito.
create function public.entitlements_for(p_community_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan   text := 'comunidad';
  v_limits jsonb;
  v_members int;
  v_rooms   int;
begin
  if p_community_id is not null then
    select s.plan_code into v_plan
    from public.subscriptions s
    where s.community_id = p_community_id and s.current_period_end > pg_catalog.now()
    order by s.current_period_end desc limit 1;
    v_plan := coalesce(v_plan, 'comunidad');
  end if;

  select pl.limits into v_limits from public.plans pl where pl.code = v_plan;

  if p_community_id is not null then
    select coalesce(pg_catalog.sum(a.quantity) filter (where a.kind = 'members_50'), 0)::int * 50,
           coalesce(pg_catalog.sum(a.quantity) filter (where a.kind = 'rooms_5'), 0)::int * 5
      into v_members, v_rooms
    from public.addons a
    where a.community_id = p_community_id and a.expires_at > pg_catalog.now() and a.kind in ('members_50', 'rooms_5');

    v_limits := pg_catalog.jsonb_set(v_limits, '{max_members}', pg_catalog.to_jsonb(((v_limits ->> 'max_members')::int) + v_members));
    v_limits := pg_catalog.jsonb_set(v_limits, '{max_concurrent_rooms}', pg_catalog.to_jsonb(((v_limits ->> 'max_concurrent_rooms')::int) + v_rooms));
  end if;

  return v_limits || pg_catalog.jsonb_build_object('plan', v_plan);
end;
$$;

-- Fija los límites de la sala al crearla (cualquier camino: sala rápida, de comunidad, programada o de evento)
create function public.rooms_set_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb := public.entitlements_for(new.community_id);
begin
  if new.max_participants is null then
    new.max_participants := (e ->> 'max_room_participants')::int;
  end if;
  if new.ends_at is null then
    new.ends_at := coalesce(new.scheduled_at, pg_catalog.now()) + pg_catalog.make_interval(mins => (e ->> 'max_room_minutes')::int);
  end if;
  return new;
end;
$$;

create trigger rooms_set_limits
  before insert on public.rooms
  for each row execute function public.rooms_set_limits();

-- Límites que ve la persona en pantalla: de una comunidad (solo sus miembros) o los gratuitos
create function public.get_entitlements(p_community_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_community_id is not null and not public.is_community_member(p_community_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  return public.entitlements_for(p_community_id);
end;
$$;

-- ───────────────────────── Salas: aforo, tiempo y salas simultáneas ─────────────────────────
-- Códigos nuevos: room_expired, community_rooms_limit, community_full (ahora según el plan)

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
  -- Salas personales abiertas por persona: el límite del plan gratuito (freno también contra abuso)
  if (select pg_catalog.count(*) from public.rooms r where r.host_id = uid and r.status = 'open' and r.community_id is null)
     >= (public.entitlements_for(null) ->> 'max_concurrent_rooms')::int then
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

create or replace function public.create_community_room(p_community_id uuid, p_name text, p_display_name text)
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
  -- Sala simultánea = sala abierta con al menos una persona presente (CLAUDE.md §14.6)
  if (
    select pg_catalog.count(*) from public.rooms r
    where r.community_id = p_community_id and r.status = 'open'
      and exists (select 1 from public.room_members rm where rm.room_id = r.id and rm.left_at is null)
  ) >= (public.entitlements_for(p_community_id) ->> 'max_concurrent_rooms')::int then
    raise exception 'community_rooms_limit' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from public.rooms r where r.host_id = uid and r.status = 'open') >= 10 then
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
  -- Pasado el tiempo de la sala y su gracia de 5 minutos, ya no se entra (el servidor la cierra)
  if pg_catalog.now() > v_room.ends_at + interval '5 minutes' then raise exception 'room_expired' using errcode = 'P0001'; end if;
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
  if active_count >= v_room.max_participants then raise exception 'room_full' using errcode = 'P0001'; end if;

  insert into public.room_members (room_id, user_id, role, display_name, avatar_url)
  values (v_room.id, uid, 'participant', v_display, v_avatar)
  on conflict (room_id, user_id)
  do update set left_at = null, joined_at = pg_catalog.now(),
                display_name = excluded.display_name, avatar_url = excluded.avatar_url;

  return v_room.id;
end;
$$;

create or replace function public.join_community(p_token text)
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
  -- El límite de miembros lo da el plan (más los extras). Quien ya está dentro nunca se saca por bajar de plan.
  if (select pg_catalog.count(*) from public.community_members cm where cm.community_id = v_id)
     >= (public.entitlements_for(v_id) ->> 'max_members')::int then
    raise exception 'community_full' using errcode = 'P0001';
  end if;

  select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Miembro') into v_display from public.profiles p where p.id = uid;
  insert into public.community_members (community_id, user_id, role, display_name, avatar_url)
  values (v_id, uid, 'member', coalesce(v_display, 'Miembro'), (select p.avatar_url from public.profiles p where p.id = uid));
  return v_id;
end;
$$;

-- Toda comunidad nueva estrena Plus 14 días, sin tarjeta (CLAUDE.md §14.5)
create or replace function public.create_community(p_name text, p_kind text default 'church', p_description text default null)
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

  insert into public.subscriptions (owner_type, community_id, plan_code, status, billing_period, provider, current_period_end)
  select 'community', v_id, pl.code, 'trialing', 'monthly', 'trial', pg_catalog.now() + pg_catalog.make_interval(days => pl.trial_days)
  from public.plans pl where pl.trial_days > 0 order by pl.sort_order limit 1;

  return v_id;
end;
$$;

-- ───────────────────────── Pases: aplicar a una sala ─────────────────────────

-- Sube los límites de una sala con un pase (uso interno: lo llaman apply_pass y fulfill_order)
create function public.apply_pass_to_room(p_pass_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass public.passes;
  v_room public.rooms;
  v_ends timestamptz;
begin
  select * into v_pass from public.passes p where p.id = p_pass_id for update;
  if not found then raise exception 'pass_not_found' using errcode = 'P0001'; end if;
  if v_pass.status <> 'available' or v_pass.expires_at <= pg_catalog.now() then
    raise exception 'pass_unavailable' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then raise exception 'room_not_found' using errcode = 'P0001'; end if;
  if v_room.status <> 'open' then raise exception 'room_closed' using errcode = 'P0001'; end if;
  if v_pass.community_id is not null and v_room.community_id is distinct from v_pass.community_id then
    raise exception 'pass_wrong_community' using errcode = 'P0001';
  end if;

  if v_pass.limits ? 'extend_minutes' then
    -- Extensión: suma tiempo al final actual (o desde ahora si ya pasó)
    v_ends := greatest(v_room.ends_at, pg_catalog.now()) + pg_catalog.make_interval(mins => (v_pass.limits ->> 'extend_minutes')::int);
  else
    -- Pase de duración: la sala dura desde ahora lo que diga el pase (nunca menos de lo que ya tenía)
    v_ends := greatest(v_room.ends_at, pg_catalog.now() + pg_catalog.make_interval(mins => (v_pass.limits ->> 'max_room_minutes')::int));
  end if;

  update public.rooms r
  set ends_at = v_ends,
      max_participants = greatest(r.max_participants, coalesce((v_pass.limits ->> 'max_room_participants')::int, r.max_participants))
  where r.id = p_room_id;

  update public.passes p
  set status = 'applied', room_id = p_room_id, starts_at = pg_catalog.now(), expires_at = v_ends
  where p.id = p_pass_id;
end;
$$;

-- La persona dueña del pase lo usa en una sala que ella anfitrióna
create function public.apply_pass(p_pass_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.passes p where p.id = p_pass_id and p.buyer_id = uid) then
    raise exception 'pass_not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = uid) then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  perform public.apply_pass_to_room(p_pass_id, p_room_id);
end;
$$;

-- ───────────────────────── Órdenes y cumplimiento ─────────────────────────
-- Códigos: not_authenticated, account_required, invalid_item, not_admin, not_host, plan_required, invalid_quantity,
-- too_many_pending, order_not_found

-- Crea la orden con el precio CALCULADO AQUÍ (el cliente nunca manda un monto). La pasarela se llama después, en el servidor.
create function public.create_order(
  p_kind text, p_code text, p_period text default null, p_quantity int default 1,
  p_community_id uuid default null, p_room_id uuid default null
)
returns table (order_id uuid, amount_mxn int, item_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  v_plan   public.plans;
  v_prod   public.products;
  v_amount int;
  v_name   text;
  v_period text := p_period;
  v_qty    int := coalesce(p_quantity, 1);
  v_paid   boolean;
  v_id     uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;
  if v_qty not between 1 and 10 then raise exception 'invalid_quantity' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.orders o where o.buyer_id = uid and o.status = 'pending' and o.created_at > pg_catalog.now() - interval '1 day') >= 10 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;

  if p_community_id is not null and not public.is_community_admin(p_community_id) then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  v_paid := p_community_id is not null and (public.entitlements_for(p_community_id) ->> 'plan') in ('plus', 'pro');

  if p_kind = 'plan' then
    if p_community_id is null then raise exception 'not_admin' using errcode = 'P0001'; end if;
    select * into v_plan from public.plans pl where pl.code = p_code and pl.monthly_price_mxn > 0;
    if not found then raise exception 'invalid_item' using errcode = 'P0001'; end if;
    if v_period not in ('monthly', 'annual') then raise exception 'invalid_item' using errcode = 'P0001'; end if;
    v_qty := 1;
    v_amount := case when v_period = 'annual' then v_plan.annual_price_mxn else v_plan.monthly_price_mxn end;
    v_name := 'Plan ' || v_plan.name || case when v_period = 'annual' then ' (anual)' else ' (mensual)' end;

  elsif p_kind in ('pass', 'addon') then
    select * into v_prod from public.products pr where pr.code = p_code and pr.kind = p_kind;
    if not found then raise exception 'invalid_item' using errcode = 'P0001'; end if;
    v_period := null;
    if p_kind = 'addon' then
      -- Los extras son de organizaciones con plan de pago
      if p_community_id is null or not v_paid then raise exception 'plan_required' using errcode = 'P0001'; end if;
    end if;
    if v_prod.code = 'extension' and p_room_id is null then raise exception 'invalid_item' using errcode = 'P0001'; end if;
    if p_room_id is not null and not exists (
      select 1 from public.rooms r where r.id = p_room_id and r.host_id = uid and r.status = 'open'
        and (p_community_id is null or r.community_id = p_community_id)
    ) then
      raise exception 'not_host' using errcode = 'P0001';
    end if;
    v_amount := (case when v_paid and v_prod.org_price_mxn is not null then v_prod.org_price_mxn else v_prod.price_mxn end) * v_qty;
    v_name := v_prod.name;
  else
    raise exception 'invalid_item' using errcode = 'P0001';
  end if;

  insert into public.orders (buyer_id, community_id, kind, item_code, billing_period, quantity, room_id, amount_mxn, expires_at)
  values (uid, p_community_id, p_kind, p_code, v_period, v_qty, p_room_id, v_amount, pg_catalog.now() + interval '3 days')
  returning id into v_id;

  return query select v_id, v_amount, v_name;
end;
$$;

-- La pasarela devolvió la dirección de pago: se guarda en la orden (solo el servidor)
create function public.attach_order_checkout(p_order_id uuid, p_provider_order_id text, p_checkout_url text, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders o
  set provider_order_id = p_provider_order_id, checkout_url = p_checkout_url, expires_at = coalesce(p_expires_at, o.expires_at)
  where o.id = p_order_id and o.status = 'pending';
$$;

-- Activa lo comprado. Idempotente: pagar dos veces la misma orden no duplica nada.
create function public.fulfill_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        public.orders;
  v_prod   public.products;
  v_sub    public.subscriptions;
  v_start  timestamptz;
  v_end    timestamptz;
  v_pass   uuid;
begin
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0001'; end if;
  if o.status in ('paid', 'refunded') then return pg_catalog.jsonb_build_object('already', true, 'status', o.status); end if;

  update public.orders x set status = 'paid', paid_at = pg_catalog.now() where x.id = o.id;

  if o.kind = 'plan' then
    select * into v_sub from public.subscriptions s where s.community_id = o.community_id for update;
    -- Renovar a tiempo suma al periodo vigente; una prueba o una suscripción vencida empieza ahora
    v_start := case when found and v_sub.status in ('active', 'past_due', 'canceled') and v_sub.current_period_end > pg_catalog.now()
                    then v_sub.current_period_end else pg_catalog.now() end;
    v_end := v_start + case when o.billing_period = 'annual' then interval '1 year' else interval '1 month' end;
    if v_sub.id is null then
      insert into public.subscriptions (owner_type, community_id, plan_code, status, billing_period, provider, current_period_end)
      values ('community', o.community_id, o.item_code, 'active', o.billing_period, 'conekta', v_end);
    else
      update public.subscriptions s
      set plan_code = o.item_code, status = 'active', billing_period = o.billing_period, provider = 'conekta',
          current_period_end = v_end, cancel_at_period_end = false
      where s.id = v_sub.id;
    end if;

  elsif o.kind = 'pass' then
    select * into v_prod from public.products pr where pr.code = o.item_code;
    insert into public.passes (buyer_id, community_id, product_code, order_id, limits, expires_at)
    values (o.buyer_id, o.community_id, o.item_code, o.id, v_prod.limits, pg_catalog.now() + interval '180 days')
    returning id into v_pass;
    -- Comprado desde una sala en curso: se aplica de una vez (si ya cerró, queda disponible)
    if o.room_id is not null then
      begin
        perform public.apply_pass_to_room(v_pass, o.room_id);
      exception when others then
        null;
      end;
    end if;

  elsif o.kind = 'addon' then
    select * into v_prod from public.products pr where pr.code = o.item_code;
    if o.item_code = 'hours_100' then
      insert into public.addons (community_id, kind, quantity, order_id, expires_at, minutes_remaining)
      values (o.community_id, o.item_code, o.quantity, o.id,
              pg_catalog.now() + pg_catalog.make_interval(days => (v_prod.limits ->> 'valid_days')::int),
              o.quantity * (v_prod.limits ->> 'person_minutes')::int);
    else
      insert into public.addons (community_id, kind, quantity, order_id, expires_at)
      values (o.community_id, o.item_code, o.quantity, o.id, pg_catalog.now() + interval '30 days');
    end if;
  end if;

  return pg_catalog.jsonb_build_object('already', false, 'status', 'paid', 'kind', o.kind);
end;
$$;

-- La orden no se pagó (venció, se canceló o falló). No toca las ya pagadas.
create function public.fail_order(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('expired', 'failed', 'canceled') then raise exception 'invalid_item' using errcode = 'P0001'; end if;
  update public.orders o set status = p_status where o.id = p_order_id and o.status = 'pending';
end;
$$;

-- Reembolso: el pase deja de servir, el plan termina y los extras vencen. Lo ya vivido en una sala no se revierte.
create function public.refund_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0001'; end if;
  if o.status <> 'paid' then return; end if;

  update public.orders x set status = 'refunded' where x.id = o.id;
  update public.passes p set status = 'refunded' where p.order_id = o.id and p.status = 'available';
  update public.addons a set expires_at = pg_catalog.now(), minutes_remaining = case when a.minutes_remaining is null then null else 0 end
  where a.order_id = o.id;
  if o.kind = 'plan' then
    update public.subscriptions s set status = 'canceled', current_period_end = pg_catalog.now() where s.community_id = o.community_id;
  end if;
end;
$$;

-- ───────────────────────── Eventos de pago (idempotencia) ─────────────────────────

-- Registra el evento. Si ya existía y se procesó, `already_processed` = true: no se vuelve a hacer nada.
-- Si existía pero falló a medias (processed_at nulo), se devuelve para reintentarlo de forma segura.
create function public.record_payment_event(p_provider text, p_event_id text, p_type text, p_payload jsonb)
returns table (event_row_id uuid, already_processed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_done timestamptz;
begin
  insert into public.payment_events (provider, provider_event_id, type, payload)
  values (p_provider, p_event_id, p_type, p_payload)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select pe.id, pe.processed_at into v_id, v_done
    from public.payment_events pe where pe.provider = p_provider and pe.provider_event_id = p_event_id;
  end if;

  return query select v_id, v_done is not null;
end;
$$;

create function public.finish_payment_event(p_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_events pe
  set processed_at = case when p_error is null then pg_catalog.now() else null end, error = left(p_error, 500)
  where pe.id = p_id;
$$;

-- ───────────────────────── Uso: minutos conectados ─────────────────────────

-- Un registro por participante y sesión (el id de evento de LiveKit es único). Descuenta de las bolsas de horas
-- lo que exceda las horas incluidas del plan en el mes. Devuelve false si ya estaba registrado.
create function public.record_usage(p_event_id text, p_room_id uuid, p_user_id uuid, p_joined_at timestamptz, p_left_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_minutes   int;
  v_period    date;
  v_included  int;
  v_total     int;
  v_used      int;
  v_need      int;
  v_take      int;
  v_consumed  int := 0;
  pk          record;
begin
  if p_event_id is null or pg_catalog.char_length(p_event_id) not between 1 and 200 or p_left_at < p_joined_at then
    raise exception 'invalid_event' using errcode = 'P0001';
  end if;

  -- Se cobra por minuto iniciado (como LiveKit), con un tope por sesión para que un dato absurdo no distorsione
  v_minutes := least(greatest(1, pg_catalog.ceil(extract(epoch from (p_left_at - p_joined_at)) / 60.0)::int), 2880);
  select r.community_id into v_community from public.rooms r where r.id = p_room_id;

  insert into public.usage_events (livekit_event_id, room_id, community_id, user_id, joined_at, left_at, minutes)
  values (p_event_id, (select r.id from public.rooms r where r.id = p_room_id), v_community,
          (select u.id from auth.users u where u.id = p_user_id), p_joined_at, p_left_at, v_minutes)
  on conflict (livekit_event_id) do nothing;
  if not found then return false; end if;

  if v_community is not null then
    v_period := pg_catalog.date_trunc('month', p_left_at at time zone 'UTC')::date;
    insert into public.usage_periods (community_id, period, person_minutes) values (v_community, v_period, v_minutes)
    on conflict (community_id, period) do update set person_minutes = public.usage_periods.person_minutes + excluded.person_minutes
    returning person_minutes, pack_minutes_used into v_total, v_used;

    v_included := (public.entitlements_for(v_community) ->> 'included_person_hours')::int;
    if v_included is not null then
      v_need := greatest(0, v_total - v_included * 60) - v_used;
      for pk in
        select a.id, a.minutes_remaining from public.addons a
        where a.community_id = v_community and a.kind = 'hours_100' and a.expires_at > pg_catalog.now() and a.minutes_remaining > 0
        order by a.expires_at, a.created_at for update
      loop
        exit when v_need <= 0;
        v_take := least(v_need, pk.minutes_remaining);
        update public.addons a set minutes_remaining = a.minutes_remaining - v_take where a.id = pk.id;
        v_need := v_need - v_take;
        v_consumed := v_consumed + v_take;
      end loop;
      if v_consumed > 0 then
        update public.usage_periods up set pack_minutes_used = up.pack_minutes_used + v_consumed
        where up.community_id = v_community and up.period = v_period;
      end if;
    end if;
  end if;
  return true;
end;
$$;

-- ───────────────────────── Resumen de facturación de una comunidad (administración) ─────────────────────────

-- Solo agregados de la comunidad: nunca minutos por persona
create function public.community_billing(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e      jsonb;
  v_sub    public.subscriptions;
  v_period date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_up     public.usage_periods;
  v_packs  int;
  v_addons jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_admin(p_community_id) then raise exception 'not_admin' using errcode = 'P0001'; end if;

  v_e := public.entitlements_for(p_community_id);
  select * into v_sub from public.subscriptions s where s.community_id = p_community_id;
  select * into v_up from public.usage_periods up where up.community_id = p_community_id and up.period = v_period;
  select coalesce(pg_catalog.sum(a.minutes_remaining), 0)::int into v_packs
  from public.addons a where a.community_id = p_community_id and a.kind = 'hours_100' and a.expires_at > pg_catalog.now();
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', a.kind, 'quantity', a.quantity, 'expires_at', a.expires_at) order by a.expires_at), '[]'::jsonb)
    into v_addons
  from public.addons a where a.community_id = p_community_id and a.expires_at > pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'plan', v_e ->> 'plan',
    'limits', v_e,
    'subscription', case when v_sub.id is null then null else pg_catalog.jsonb_build_object(
      'status', v_sub.status, 'billing_period', v_sub.billing_period, 'provider', v_sub.provider,
      'current_period_end', v_sub.current_period_end, 'cancel_at_period_end', v_sub.cancel_at_period_end,
      'is_current', v_sub.current_period_end > pg_catalog.now()) end,
    'members', (select pg_catalog.count(*) from public.community_members cm where cm.community_id = p_community_id),
    'usage', pg_catalog.jsonb_build_object(
      'period', v_period,
      'person_minutes', coalesce(v_up.person_minutes, 0),
      'included_minutes', case when (v_e ->> 'included_person_hours') is null then null else (v_e ->> 'included_person_hours')::int * 60 end,
      'pack_minutes_available', v_packs
    ),
    'addons', v_addons
  );
end;
$$;

-- ───────────────────────── Cumplimiento de límites (servidor) ─────────────────────────

-- Salas abiertas que ya pasaron su tiempo MÁS la gracia de 5 minutos: el servidor las cierra y desconecta el audio
create function public.rooms_over_limit()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.rooms r
  where r.status = 'open' and r.ends_at + interval '5 minutes' < pg_catalog.now();
$$;

create function public.close_room_system(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms r set status = 'closed', closed_at = pg_catalog.now() where r.id = p_room_id and r.status = 'open';
  update public.room_members rm set left_at = coalesce(rm.left_at, pg_catalog.now()) where rm.room_id = p_room_id;
end;
$$;

-- Llama al servidor web (que habla con LiveKit) cuando hay salas vencidas. Lee la URL y el secreto de Vault; sin
-- ellos no hace nada (seguro por defecto). Ver docs/operaciones/facturacion.md.
create function public.invoke_enforcer()
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
  if not exists (select 1 from public.rooms r where r.status = 'open' and r.ends_at + interval '5 minutes' < pg_catalog.now()) then
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

select cron.schedule('enforce-room-limits', '* * * * *', $$select public.invoke_enforcer()$$);

-- Los pases sin usar que pasan su fecha límite dejan de estar disponibles
create function public.expire_passes()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.passes p set status = 'expired' where p.status = 'available' and p.expires_at <= pg_catalog.now();
$$;

select cron.schedule('expire-passes', '23 3 * * *', $$select public.expire_passes()$$);

-- ───────────────────────── RLS ─────────────────────────

alter table public.plans enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
alter table public.passes enable row level security;
alter table public.addons enable row level security;
alter table public.usage_events enable row level security;
alter table public.usage_periods enable row level security;
alter table public.payment_events enable row level security;

-- El catálogo lo ve cualquier persona con sesión
create policy "plans_select" on public.plans for select to authenticated using (true);
create policy "products_select" on public.products for select to authenticated using (true);

-- Lo de una comunidad lo ve su administración; nadie escribe desde la app (solo funciones y la service role)
create policy "subscriptions_select_admin" on public.subscriptions for select to authenticated
  using (community_id is not null and public.is_community_admin(community_id));
create policy "orders_select_own_or_admin" on public.orders for select to authenticated
  using (buyer_id = (select auth.uid()) or (community_id is not null and public.is_community_admin(community_id)));
create policy "passes_select_own_or_admin" on public.passes for select to authenticated
  using (buyer_id = (select auth.uid()) or (community_id is not null and public.is_community_admin(community_id)));
create policy "addons_select_admin" on public.addons for select to authenticated
  using (public.is_community_admin(community_id));
create policy "usage_periods_select_admin" on public.usage_periods for select to authenticated
  using (public.is_community_admin(community_id));

-- Tablas solo de servidor: política explícita que no deja pasar a nadie (la service role se salta RLS)
create policy "usage_events_no_access" on public.usage_events for select to authenticated using (false);
create policy "payment_events_no_access" on public.payment_events for select to authenticated using (false);

-- Sin sesión no se toca nada; con sesión solo se lee lo que dejan las políticas (las escrituras van por funciones)
revoke all on public.plans, public.products, public.subscriptions, public.orders, public.passes, public.addons,
  public.usage_events, public.usage_periods, public.payment_events from anon, authenticated;
grant select on public.plans, public.products, public.subscriptions, public.orders, public.passes, public.addons,
  public.usage_periods to authenticated;
grant select on public.usage_events, public.payment_events to authenticated;

-- ───────────────────────── Permisos de ejecución ─────────────────────────

revoke all on function
  public.entitlements_for(uuid), public.rooms_set_limits(), public.get_entitlements(uuid),
  public.apply_pass_to_room(uuid, uuid), public.apply_pass(uuid, uuid),
  public.create_order(text, text, text, int, uuid, uuid), public.attach_order_checkout(uuid, text, text, timestamptz),
  public.fulfill_order(uuid), public.fail_order(uuid, text), public.refund_order(uuid),
  public.record_payment_event(text, text, text, jsonb), public.finish_payment_event(uuid, text),
  public.record_usage(text, uuid, uuid, timestamptz, timestamptz), public.community_billing(uuid),
  public.rooms_over_limit(), public.close_room_system(uuid), public.invoke_enforcer(), public.expire_passes()
from public, anon, authenticated;

grant execute on function
  public.get_entitlements(uuid), public.apply_pass(uuid, uuid), public.create_order(text, text, text, int, uuid, uuid),
  public.community_billing(uuid)
to authenticated;

grant execute on function
  public.entitlements_for(uuid), public.apply_pass_to_room(uuid, uuid), public.attach_order_checkout(uuid, text, text, timestamptz),
  public.fulfill_order(uuid), public.fail_order(uuid, text), public.refund_order(uuid),
  public.record_payment_event(text, text, text, jsonb), public.finish_payment_event(uuid, text),
  public.record_usage(text, uuid, uuid, timestamptz, timestamptz), public.rooms_over_limit(), public.close_room_system(uuid),
  public.expire_passes()
to service_role;

-- Las funciones reemplazadas conservan sus permisos (create or replace); se reafirman por claridad
revoke all on function public.create_room(text, text), public.create_community_room(uuid, text, text),
  public.join_room(text, text), public.join_community(text), public.create_community(text, text, text) from public, anon;
grant execute on function public.create_room(text, text), public.create_community_room(uuid, text, text),
  public.join_room(text, text), public.join_community(text), public.create_community(text, text, text) to authenticated;
