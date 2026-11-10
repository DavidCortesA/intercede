-- Fase 6 — Devocionales, salas programadas y avisos (push y correo).
--
-- Modelo de seguridad:
--   * Devocionales: el contenido es de lectura para cualquier sesión; el progreso, las notas y la racha
--     son privados y solo de cuentas permanentes. Nadie escribe devocionales desde el cliente (se
--     cargan con el importador usando la service role; en la Fase 7 los administran las comunidades).
--   * Programación: las salas programadas las crea una cuenta con RPC; las personas se suman con un
--     enlace de invitación REVOCABLE (el token vive en otra tabla que solo lee quien la creó).
--   * Avisos: una cola (`notifications`) que llena pg_cron y vacía una Edge Function con la service role.
--     Las personas solo leen sus avisos y sus preferencias; las suscripciones push se registran por RPC
--     (un navegador puede pasar de una cuenta a otra).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ───────────────────────── Devocionales ─────────────────────────

create table public.devotionals (
  id                uuid primary key default gen_random_uuid(),
  devotional_date   date not null,
  -- Nulo = devocional general de la plataforma. La llave foránea llega con las comunidades (Fase 7).
  community_id      uuid,
  passage_reference text not null check (char_length(btrim(passage_reference)) between 1 and 120),
  passage_text      text not null check (char_length(btrim(passage_text)) between 1 and 2000),
  bible_version     text not null check (char_length(btrim(bible_version)) between 1 and 60),
  reflection        text not null check (char_length(btrim(reflection)) between 1 and 4000),
  question          text not null check (char_length(btrim(question)) between 1 and 500),
  suggested_prayer  text check (suggested_prayer is null or char_length(btrim(suggested_prayer)) between 1 and 1000),
  created_at        timestamptz not null default now()
);

create unique index devotionals_global_date_idx on public.devotionals (devotional_date) where community_id is null;
create unique index devotionals_community_date_idx on public.devotionals (community_id, devotional_date) where community_id is not null;

comment on table public.devotionals is 'Un devocional por día (general o de una comunidad). Se carga con el importador, no desde el cliente.';

create table public.devotional_progress (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  devotional_id uuid not null references public.devotionals (id) on delete cascade,
  -- Nulo = todavía no lo marcó como leído (puede tener solo una nota)
  read_at       timestamptz,
  note          text check (note is null or char_length(btrim(note)) between 1 and 2000),
  updated_at    timestamptz not null default now(),
  primary key (user_id, devotional_id)
);

create function public.devotional_progress_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  -- Marcar como leído guarda la hora una sola vez (cambiar la nota no la mueve)
  if new.read_at is not null and tg_op = 'UPDATE' and old.read_at is not null then
    new.read_at := old.read_at;
  end if;
  return new;
end;
$$;

create trigger devotional_progress_before_write
  before insert or update on public.devotional_progress
  for each row execute function public.devotional_progress_before_write();

alter table public.devotionals enable row level security;
alter table public.devotional_progress enable row level security;
revoke all on public.devotionals, public.devotional_progress from anon, authenticated;

grant select on public.devotionals to authenticated;
-- Hasta mañana (por las zonas horarias): no se adelanta contenido futuro
create policy "devotionals_select_published"
  on public.devotionals for select to authenticated
  using (community_id is null and devotional_date <= (current_date + 1));

grant select, delete on public.devotional_progress to authenticated;
grant insert (devotional_id, read_at, note) on public.devotional_progress to authenticated;
grant update (read_at, note) on public.devotional_progress to authenticated;

create policy "devotional_progress_select_own"
  on public.devotional_progress for select to authenticated
  using (user_id = (select auth.uid()));

create policy "devotional_progress_insert_own_permanent"
  on public.devotional_progress for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_permanent_user()
    and exists (select 1 from public.devotionals d where d.id = devotional_id)
  );

create policy "devotional_progress_update_own"
  on public.devotional_progress for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "devotional_progress_delete_own"
  on public.devotional_progress for delete to authenticated
  using (user_id = (select auth.uid()));

-- Racha "suave": días seguidos leyendo, sin castigos. Si hoy todavía no lo lees, la racha de ayer sigue
-- viva; los días sin devocional publicado no la rompen (solo cuentan los devocionales que existen).
create function public.devotional_stats()
returns table (streak int, total_read int, read_today boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  tz        text;
  v_today   date;
  r         record;
  first_row boolean := true;
begin
  select p.timezone into tz from public.profiles p where p.id = uid;
  v_today := (pg_catalog.now() at time zone coalesce(tz, 'UTC'))::date;

  streak := 0;
  select pg_catalog.count(*)::int into total_read
  from public.devotional_progress dp where dp.user_id = uid and dp.read_at is not null;

  select exists (
    select 1 from public.devotional_progress dp
    join public.devotionals d on d.id = dp.devotional_id
    where dp.user_id = uid and dp.read_at is not null and d.community_id is null and d.devotional_date = v_today
  ) into read_today;

  for r in
    select d.devotional_date as day, (dp.read_at is not null) as was_read
    from public.devotionals d
    left join public.devotional_progress dp on dp.devotional_id = d.id and dp.user_id = uid
    where d.community_id is null and d.devotional_date <= v_today
    order by d.devotional_date desc
  loop
    if r.was_read then
      streak := streak + 1;
    elsif first_row and r.day = v_today then
      null; -- hoy aún sin leer: no rompe la racha
    else
      exit;
    end if;
    first_row := false;
  end loop;

  return next;
end;
$$;

grant execute on function public.devotional_stats() to authenticated;

-- ───────────────────────── Preferencias y suscripciones push ─────────────────────────

create table public.notification_preferences (
  user_id                  uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  push_enabled             boolean not null default true,
  email_enabled            boolean not null default false,
  schedule_reminders       boolean not null default true,
  devotional_reminder      boolean not null default false,
  devotional_reminder_time time not null default '07:00',
  updated_at               timestamptz not null default now()
);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

create policy "notification_preferences_own_select"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notification_preferences_own_insert"
  on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_permanent_user());

create policy "notification_preferences_own_update"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- El envío de avisos hace una petición HTTP a cada endpoint guardado. Para que nadie pueda usar esa
-- función como pasarela hacia servidores internos (SSRF), solo se aceptan los servicios push de los
-- navegadores (Chrome/Edge/Android, Firefox, Safari y Windows). Los hosts .test (reservados, no se
-- resuelven en internet) existen para las pruebas.
create function public.is_allowed_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)?push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.test)(:443)?/';
$$;

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique check (char_length(endpoint) between 1 and 2048 and public.is_allowed_push_endpoint(endpoint)),
  p256dh       text not null check (char_length(p256dh) between 1 and 256),
  auth         text not null check (char_length(auth) between 1 and 128),
  user_agent   text check (user_agent is null or char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- El mismo navegador puede pasar de una cuenta a otra: el endpoint es único y se reasigna.
create function public.upsert_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;
  if not public.is_allowed_push_endpoint(p_endpoint) then raise exception 'invalid_endpoint' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.push_subscriptions ps where ps.user_id = uid) >= 10
     and not exists (select 1 from public.push_subscriptions ps where ps.endpoint = p_endpoint) then
    raise exception 'too_many_devices' using errcode = 'P0001';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint)
  do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                user_agent = excluded.user_agent, last_seen_at = pg_catalog.now();
end;
$$;

-- ───────────────────────── Avisos (cola de notificaciones) ─────────────────────────

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('schedule_reminder', 'schedule_started', 'devotional_reminder')),
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) between 1 and 300),
  -- Ruta interna sin idioma (p. ej. /r/abc234); la app le antepone el idioma
  url          text not null check (url ~ '^/[a-z0-9\-_/]*$'),
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  claimed_at   timestamptz,
  push_state   text not null default 'pending' check (push_state in ('pending', 'sent', 'skipped', 'failed')),
  email_state  text not null default 'pending' check (email_state in ('pending', 'sent', 'skipped', 'failed')),
  push_sent_at  timestamptz,
  email_sent_at timestamptz,
  delivery_error text,
  unique (user_id, dedupe_key)
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (created_at)
  where push_state = 'pending' or email_state = 'pending';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ───────────────────────── Salas programadas ─────────────────────────

create function public.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.translate(
    pg_catalog.encode(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()), 'base64'),
    '+/=', '-_'
  );
$$;

create table public.room_schedules (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  -- Hora de pared en la zona horaria elegida: así "6:00 a. m." sigue siendo las 6 aunque cambie el horario de verano
  timezone           text not null,
  recurrence         text not null check (recurrence in ('once', 'daily', 'weekly')),
  local_time         time not null,
  start_date         date not null,
  -- Días de la semana (0 = domingo … 6 = sábado), solo para 'weekly'
  weekdays           smallint[] not null default '{}',
  reminder_minutes   int not null default 10 check (reminder_minutes in (0, 5, 10, 15, 30, 60)),
  is_active          boolean not null default true,
  next_occurrence_at timestamptz,
  last_room_id       uuid references public.rooms (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint room_schedules_weekdays_valid check (
    (recurrence = 'weekly' and cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
    or (recurrence <> 'weekly' and cardinality(weekdays) = 0)
  )
);

create index room_schedules_due_idx on public.room_schedules (next_occurrence_at) where is_active;
create index room_schedules_owner_idx on public.room_schedules (owner_id);

create table public.schedule_invites (
  schedule_id uuid primary key references public.room_schedules (id) on delete cascade,
  token       text not null unique default public.new_invite_token(),
  created_at  timestamptz not null default now()
);

create table public.schedule_subscriptions (
  schedule_id uuid not null references public.room_schedules (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (schedule_id, user_id)
);

create index schedule_subscriptions_user_idx on public.schedule_subscriptions (user_id);

alter table public.rooms add column schedule_id uuid references public.room_schedules (id) on delete set null;
alter table public.rooms add column scheduled_at timestamptz;
create unique index rooms_schedule_occurrence_idx on public.rooms (schedule_id, scheduled_at) where schedule_id is not null;

create function public.room_schedules_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger room_schedules_validate
  before insert or update of timezone on public.room_schedules
  for each row execute function public.room_schedules_validate();

-- Próxima ocurrencia estrictamente posterior a `p_after`, calculada con la hora de pared de la zona
-- (maneja el horario de verano: la hora local no cambia aunque cambie el desfase UTC).
create function public.compute_next_occurrence(
  p_recurrence text,
  p_local_time time,
  p_start_date date,
  p_weekdays smallint[],
  p_timezone text,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  first_day date := greatest(p_start_date, (p_after at time zone p_timezone)::date);
  candidate timestamptz;
  i         int;
begin
  if p_recurrence = 'once' then
    candidate := (p_start_date + p_local_time) at time zone p_timezone;
    return case when candidate > p_after then candidate else null end;
  end if;

  for i in 0..8 loop
    candidate := ((first_day + i) + p_local_time) at time zone p_timezone;
    if candidate > p_after
       and (p_recurrence = 'daily' or extract(dow from (first_day + i))::smallint = any (p_weekdays)) then
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;

alter table public.room_schedules enable row level security;
alter table public.schedule_invites enable row level security;
alter table public.schedule_subscriptions enable row level security;
revoke all on public.room_schedules, public.schedule_invites, public.schedule_subscriptions from anon, authenticated;

create function public.is_schedule_owner(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_schedules s where s.id = p_schedule_id and s.owner_id = (select auth.uid()));
$$;

create function public.is_schedule_subscriber(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.schedule_subscriptions ss where ss.schedule_id = p_schedule_id and ss.user_id = (select auth.uid()));
$$;

revoke all on function public.is_schedule_owner(uuid), public.is_schedule_subscriber(uuid) from public, anon;
grant execute on function public.is_schedule_owner(uuid), public.is_schedule_subscriber(uuid) to authenticated;

grant select, delete on public.room_schedules to authenticated;
create policy "room_schedules_select_owner_or_subscriber"
  on public.room_schedules for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_schedule_subscriber(id));
create policy "room_schedules_delete_owner"
  on public.room_schedules for delete to authenticated
  using (owner_id = (select auth.uid()));

-- El token de invitación solo lo ve quien creó la programación (y por RPC)
grant select on public.schedule_invites to authenticated;
create policy "schedule_invites_select_owner"
  on public.schedule_invites for select to authenticated
  using (public.is_schedule_owner(schedule_id));

grant select, delete on public.schedule_subscriptions to authenticated;
create policy "schedule_subscriptions_select_own_or_owner"
  on public.schedule_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_schedule_owner(schedule_id));
create policy "schedule_subscriptions_delete_own"
  on public.schedule_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Códigos de error: account_required, invalid_name, too_many_schedules, schedule_in_past,
-- schedule_not_found, not_owner, invalid_timezone, invalid_weekdays, not_authenticated

create function public.create_schedule(
  p_name text,
  p_recurrence text,
  p_local_time time,
  p_start_date date,
  p_weekdays smallint[],
  p_timezone text,
  p_reminder_minutes int default 10
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

  insert into public.room_schedules (owner_id, name, timezone, recurrence, local_time, start_date, weekdays, reminder_minutes, next_occurrence_at)
  values (uid, v_name, p_timezone, p_recurrence, p_local_time, p_start_date, coalesce(p_weekdays, '{}'), p_reminder_minutes, v_next)
  returning id into v_id;

  insert into public.schedule_invites (schedule_id) values (v_id);
  insert into public.schedule_subscriptions (schedule_id, user_id) values (v_id, uid);
  return v_id;
end;
$$;

create function public.set_schedule_active(p_schedule_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.room_schedules;
  v_next timestamptz;
begin
  select * into s from public.room_schedules rs where rs.id = p_schedule_id and rs.owner_id = (select auth.uid()) for update;
  if not found then raise exception 'not_owner' using errcode = 'P0001'; end if;

  if p_active then
    v_next := public.compute_next_occurrence(s.recurrence, s.local_time, s.start_date, s.weekdays, s.timezone, pg_catalog.now());
    if v_next is null then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
    update public.room_schedules rs set is_active = true, next_occurrence_at = v_next where rs.id = s.id;
  else
    update public.room_schedules rs set is_active = false where rs.id = s.id;
  end if;
end;
$$;

create function public.get_schedule_invite(p_schedule_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.token from public.schedule_invites i
  where i.schedule_id = p_schedule_id and public.is_schedule_owner(p_schedule_id);
$$;

-- Revocar = generar otro token: el enlace anterior deja de servir.
create function public.regenerate_schedule_invite(p_schedule_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_schedule_owner(p_schedule_id) then raise exception 'not_owner' using errcode = 'P0001'; end if;
  update public.schedule_invites i set token = public.new_invite_token(), created_at = pg_catalog.now()
  where i.schedule_id = p_schedule_id returning i.token into v_token;
  return v_token;
end;
$$;

-- Vista previa para la pantalla de invitación (quien tiene el enlace ya podría suscribirse)
create function public.peek_schedule(p_token text)
returns table (name text, recurrence text, local_time time, weekdays smallint[], timezone text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.recurrence, s.local_time, s.weekdays, s.timezone, s.is_active
  from public.schedule_invites i
  join public.room_schedules s on s.id = i.schedule_id
  where i.token = p_token;
$$;

create function public.subscribe_to_schedule(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;

  select s.id into v_id
  from public.schedule_invites i
  join public.room_schedules s on s.id = i.schedule_id
  where i.token = p_token and s.is_active;
  if not found then raise exception 'schedule_not_found' using errcode = 'P0001'; end if;

  insert into public.schedule_subscriptions (schedule_id, user_id) values (v_id, uid) on conflict do nothing;
  return v_id;
end;
$$;

-- ───────────────────────── Trabajo programado (pg_cron) ─────────────────────────

-- Abre las salas que ya tocan, avisa a quien se suscribió, genera los recordatorios y limpia.
-- Es idempotente: las llaves `dedupe_key` y el índice único de (programación, hora) evitan duplicados.
create function public.process_scheduled_work(p_now timestamptz default pg_catalog.now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s            public.room_schedules;
  v_code       text;
  v_room       uuid;
  v_host_name  text;
  v_next       timestamptz;
  attempts     int;
  reminders    int := 0;
  opened       int := 0;
  devotionals  int := 0;
  closed       int := 0;
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
    -- Si el sistema estuvo caído más de 6 horas, esa ocurrencia se omite (no se abre una sala a deshoras)
    if s.next_occurrence_at >= p_now - interval '6 hours' then
      select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Anfitrión') into v_host_name
      from public.profiles p where p.id = s.owner_id;
      v_host_name := coalesce(v_host_name, 'Anfitrión');

      attempts := 0;
      loop
        attempts := attempts + 1;
        v_code := public.generate_room_code();
        begin
          insert into public.rooms (code, name, host_id, schedule_id, scheduled_at)
          values (v_code, s.name, s.owner_id, s.id, s.next_occurrence_at)
          returning id into v_room;
          exit;
        exception when unique_violation then
          -- Misma ocurrencia ya abierta (índice único) o código repetido
          if exists (select 1 from public.rooms r where r.schedule_id = s.id and r.scheduled_at = s.next_occurrence_at) then
            v_room := null;
            exit;
          end if;
          if attempts >= 10 then raise; end if;
        end;
      end loop;

      if v_room is not null then
        -- La persona anfitriona figura como miembro (fuera de la sala) para poder entrar con join_room
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

  -- 4) Limpieza: salas vacías abiertas hace más de 3 horas y avisos de hace más de 30 días
  with stale as (
    update public.rooms r set status = 'closed', closed_at = p_now
    where r.status = 'open' and r.created_at < p_now - interval '3 hours'
      and not exists (select 1 from public.room_members rm where rm.room_id = r.id and rm.left_at is null)
    returning r.id
  )
  select pg_catalog.count(*)::int into closed from stale;

  delete from public.notifications nf where nf.created_at < p_now - interval '30 days';

  return pg_catalog.jsonb_build_object('reminders', reminders, 'rooms_opened', opened, 'devotional_reminders', devotionals, 'rooms_closed', closed);
end;
$$;

-- ───────────────────────── Envío de avisos (solo service role) ─────────────────────────

-- Reclama avisos pendientes para la Edge Function. Decide aquí qué canales aplican según las
-- preferencias y los dispositivos; lo que no aplica queda como 'skipped'. `skip locked` evita que
-- dos ejecuciones envíen lo mismo. Un canal que se deja en 'pending' al cerrar se reintenta (cada
-- 2 minutos, durante una hora como máximo).
create function public.claim_notifications(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n          public.notifications;
  prefs      public.notification_preferences;
  v_email    text;
  v_has_subs boolean;
  v_push     text;
  v_mail     text;
  result     jsonb := '[]'::jsonb;
begin
  -- Un aviso que lleva más de una hora sin poder enviarse ya no sirve (un recordatorio tardío confunde):
  -- se da por fallido en lugar de reintentarlo para siempre.
  update public.notifications nf
  set push_state = case when nf.push_state = 'pending' then 'failed' else nf.push_state end,
      email_state = case when nf.email_state = 'pending' then 'failed' else nf.email_state end,
      delivery_error = coalesce(nf.delivery_error, 'expired')
  where (nf.push_state = 'pending' or nf.email_state = 'pending')
    and nf.created_at <= pg_catalog.now() - interval '1 hour';

  for n in
    select * from public.notifications nf
    where (nf.push_state = 'pending' or nf.email_state = 'pending')
      and nf.created_at > pg_catalog.now() - interval '1 hour'
      and (nf.claimed_at is null or nf.claimed_at < pg_catalog.now() - interval '2 minutes')
    order by nf.created_at
    limit p_limit
    for update skip locked
  loop
    select * into prefs from public.notification_preferences np where np.user_id = n.user_id;
    select u.email into v_email from auth.users u where u.id = n.user_id;
    select exists (select 1 from public.push_subscriptions ps where ps.user_id = n.user_id) into v_has_subs;

    v_push := case when n.push_state = 'pending' and coalesce(prefs.push_enabled, true) and v_has_subs then 'pending'
                   when n.push_state = 'pending' then 'skipped' else n.push_state end;
    v_mail := case when n.email_state = 'pending' and coalesce(prefs.email_enabled, false) and v_email is not null and v_email <> '' then 'pending'
                   when n.email_state = 'pending' then 'skipped' else n.email_state end;

    update public.notifications nf set claimed_at = pg_catalog.now(), push_state = v_push, email_state = v_mail where nf.id = n.id;

    if v_push = 'pending' or v_mail = 'pending' then
      result := result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'url', n.url,
        'push_pending', v_push = 'pending', 'email_pending', v_mail = 'pending',
        'email', case when v_mail = 'pending' then v_email else null end,
        'subscriptions', case when v_push = 'pending' then (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
          from public.push_subscriptions ps where ps.user_id = n.user_id
        ) else '[]'::jsonb end
      ));
    end if;
  end loop;
  return result;
end;
$$;

create function public.finish_notification(
  p_id uuid,
  p_push_state text,
  p_email_state text,
  p_error text default null,
  p_dead_endpoints text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications nf
  set push_state = case when nf.push_state = 'pending' then p_push_state else nf.push_state end,
      email_state = case when nf.email_state = 'pending' then p_email_state else nf.email_state end,
      push_sent_at = case when nf.push_state = 'pending' and p_push_state = 'sent' then pg_catalog.now() else nf.push_sent_at end,
      email_sent_at = case when nf.email_state = 'pending' and p_email_state = 'sent' then pg_catalog.now() else nf.email_sent_at end,
      delivery_error = left(p_error, 500)
  where nf.id = p_id;

  -- Dispositivos que el servicio push informó como dados de baja (404/410)
  delete from public.push_subscriptions ps where ps.endpoint = any (p_dead_endpoints);
end;
$$;

-- Llama a la Edge Function de envío. Lee la URL y el secreto de Vault (los configura quien opera el
-- proyecto una vez; ver docs/operaciones/avisos.md). Sin ellos no hace nada: es seguro por defecto.
create function public.invoke_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'dispatcher_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'dispatcher_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (
    select 1 from public.notifications nf where nf.push_state = 'pending' or nf.email_state = 'pending'
  ) then return; end if;

  perform net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function
  public.upsert_push_subscription(text, text, text, text),
  public.create_schedule(text, text, time, date, smallint[], text, int),
  public.set_schedule_active(uuid, boolean),
  public.get_schedule_invite(uuid),
  public.regenerate_schedule_invite(uuid),
  public.subscribe_to_schedule(text),
  public.peek_schedule(text),
  public.process_scheduled_work(timestamptz),
  public.claim_notifications(int),
  public.finish_notification(uuid, text, text, text, text[]),
  public.invoke_dispatcher(),
  public.compute_next_occurrence(text, time, date, smallint[], text, timestamptz),
  public.new_invite_token()
from public, anon, authenticated;

grant execute on function
  public.upsert_push_subscription(text, text, text, text),
  public.create_schedule(text, text, time, date, smallint[], text, int),
  public.set_schedule_active(uuid, boolean),
  public.get_schedule_invite(uuid),
  public.regenerate_schedule_invite(uuid),
  public.subscribe_to_schedule(text),
  public.compute_next_occurrence(text, time, date, smallint[], text, timestamptz)
to authenticated;
grant execute on function public.peek_schedule(text) to anon, authenticated;
grant execute on function public.process_scheduled_work(timestamptz), public.claim_notifications(int),
  public.finish_notification(uuid, text, text, text, text[]) to service_role;

-- Cron: cada minuto prepara los avisos y llama al enviador
select cron.schedule('process-scheduled-work', '* * * * *', $$select public.process_scheduled_work()$$);
select cron.schedule('dispatch-notifications', '* * * * *', $$select public.invoke_dispatcher()$$);
