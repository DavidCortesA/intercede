-- Fase 11 — Google Calendar, nivel 2: sincronización automática en UN solo sentido, INTERCEDE → Google (CLAUDE.md §16.3 C6).
--
-- Decisiones del propietario: permiso mínimo `calendar.app.created` (INTERCEDE crea un calendario secundario propio y solo toca eventos
-- ahí; no lee ni escribe en el calendario principal ni en ningún otro).
--
-- Principios:
--   * Es un flujo de autorización INDEPENDIENTE del inicio de sesión (el login sigue con permisos mínimos).
--   * El token de actualización se guarda CIFRADO por la aplicación (AES-256-GCM con una llave que NO está en la base) y la persona nunca
--     puede leerlo: las columnas sensibles no se conceden a `authenticated`.
--   * La sincronización es "reconciliar": un trabajo dice "revisa este elemento de esta persona" y el servidor compara lo que debe existir
--     (asistencia confirmada, sala que sigue) con lo que hay en Google. Es idempotente y tolera reintentos.
--   * Si la persona BORRA el evento en Google, no se vuelve a crear (`user_deleted`). Si revoca el permiso, la conexión pasa a
--     `disconnected` y se le avisa. Desconectar revoca el token y borra todo lo guardado.

-- ───────────────────────── Tablas ─────────────────────────

create table public.calendar_connections (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  provider                text not null default 'google' check (provider = 'google'),
  -- Permiso concedido (lo que Google devolvió), para comprobar que es solo el acotado
  scope                   text not null,
  -- Cifrado por la aplicación; nunca se lee desde el navegador
  refresh_token_encrypted text not null,
  -- Calendario secundario "INTERCEDE" creado en la cuenta de la persona
  calendar_id             text,
  status                  text not null default 'connected' check (status in ('connected', 'disconnected')),
  sync_events             boolean not null default true,
  sync_schedules          boolean not null default true,
  connected_at            timestamptz not null default now(),
  last_error              text check (last_error is null or char_length(last_error) <= 300),
  updated_at              timestamptz not null default now()
);

-- Un vínculo por persona y elemento: qué evento de Google corresponde a qué cosa de INTERCEDE
create table public.calendar_event_links (
  user_id         uuid not null references auth.users (id) on delete cascade,
  source_type     text not null check (source_type in ('event', 'schedule', 'chain_slot')),
  source_id       uuid not null,
  google_event_id text not null,
  -- user_deleted = la persona lo borró en Google: no se vuelve a crear
  status          text not null default 'active' check (status in ('active', 'user_deleted')),
  updated_at      timestamptz not null default now(),
  primary key (user_id, source_type, source_id)
);

-- Cola: "revisa este elemento de esta persona". Único por elemento, así que muchos cambios seguidos son un solo trabajo.
create table public.calendar_sync_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  source_type   text not null check (source_type in ('event', 'schedule', 'chain_slot')),
  source_id     uuid not null,
  attempts      int not null default 0,
  run_after     timestamptz not null default now(),
  claimed_until timestamptz,
  last_error    text check (last_error is null or char_length(last_error) <= 300),
  created_at    timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create index calendar_sync_jobs_due_idx on public.calendar_sync_jobs (run_after);

comment on table public.calendar_connections is 'Conexión de una persona con Google Calendar. El token va cifrado y no se concede a authenticated.';

-- ───────────────────────── Encolar ─────────────────────────

-- Pide revisar un elemento de una persona. Solo si tiene la conexión activa y el tipo habilitado (o con `p_force`, para limpiar al apagarlo).
create function public.enqueue_calendar_sync(p_user_id uuid, p_type text, p_source_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.calendar_connections c
    where c.user_id = p_user_id and c.status = 'connected'
      and (p_force or (p_type = 'event' and c.sync_events) or (p_type = 'schedule' and c.sync_schedules) or p_type = 'chain_slot')
  ) then
    return;
  end if;
  insert into public.calendar_sync_jobs (user_id, source_type, source_id) values (p_user_id, p_type, p_source_id)
  on conflict (user_id, source_type, source_id) do update set run_after = pg_catalog.now(), attempts = 0, claimed_until = null, last_error = null;
end;
$$;

-- Asistencia a un evento: confirmar o quitar
create function public.calendar_rsvp_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_calendar_sync(coalesce(new.user_id, old.user_id), 'event', coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end;
$$;

create trigger calendar_rsvp_changed
  after insert or update of status or delete on public.event_rsvps
  for each row execute function public.calendar_rsvp_changed();

-- Un evento cambió (título, hora, descripción): se revisa a quienes dijeron que van (borrarlo borra las asistencias y las encola una a una)
create function public.calendar_event_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select v.user_id from public.event_rsvps v where v.event_id = new.id and v.status in ('going', 'maybe') loop
    perform public.enqueue_calendar_sync(r.user_id, 'event', new.id);
  end loop;
  return new;
end;
$$;

create trigger calendar_event_changed
  after update of title, description, starts_at, ends_at, timezone on public.events
  for each row execute function public.calendar_event_changed();

-- Seguir o dejar de seguir una sala programada ("recordarme")
create function public.calendar_subscription_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_calendar_sync(coalesce(new.user_id, old.user_id), 'schedule', coalesce(new.schedule_id, old.schedule_id));
  return coalesce(new, old);
end;
$$;

create trigger calendar_subscription_changed
  after insert or delete on public.schedule_subscriptions
  for each row execute function public.calendar_subscription_changed();

-- Una programación cambió (hora, días, pausa): se revisa a quienes la siguen
create function public.calendar_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select s.user_id from public.schedule_subscriptions s where s.schedule_id = new.id loop
    perform public.enqueue_calendar_sync(r.user_id, 'schedule', new.id);
  end loop;
  return new;
end;
$$;

create trigger calendar_schedule_changed
  after update of name, timezone, recurrence, local_time, start_date, weekdays, is_active on public.room_schedules
  for each row execute function public.calendar_schedule_changed();

-- Encola todo lo que corresponde a una persona (al conectar o al volver a encender un tipo)
create function public.calendar_backfill(p_user_id uuid, p_type text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  r record;
begin
  if p_type is null or p_type = 'event' then
    for r in
      select v.event_id from public.event_rsvps v join public.events e on e.id = v.event_id
      where v.user_id = p_user_id and v.status in ('going', 'maybe') and e.ends_at > pg_catalog.now()
    loop
      perform public.enqueue_calendar_sync(p_user_id, 'event', r.event_id);
      n := n + 1;
    end loop;
  end if;
  if p_type is null or p_type = 'schedule' then
    for r in
      select s.schedule_id from public.schedule_subscriptions s join public.room_schedules g on g.id = s.schedule_id
      where s.user_id = p_user_id and g.is_active
    loop
      perform public.enqueue_calendar_sync(p_user_id, 'schedule', r.schedule_id);
      n := n + 1;
    end loop;
  end if;
  return n;
end;
$$;

-- ───────────────────────── Preferencias ─────────────────────────

-- Encender o apagar un tipo: al apagarlo se borran sus eventos de Google; al encenderlo se vuelve a sincronizar lo que corresponde
create function public.set_calendar_preferences(p_sync_events boolean, p_sync_schedules boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c   public.calendar_connections;
  l   record;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into c from public.calendar_connections x where x.user_id = uid and x.status = 'connected' for update;
  if not found then raise exception 'not_connected' using errcode = 'P0001'; end if;

  update public.calendar_connections x set sync_events = p_sync_events, sync_schedules = p_sync_schedules, updated_at = pg_catalog.now() where x.user_id = uid;

  if c.sync_events and not p_sync_events then
    for l in select k.source_id from public.calendar_event_links k where k.user_id = uid and k.source_type = 'event' loop
      perform public.enqueue_calendar_sync(uid, 'event', l.source_id, true);
    end loop;
  elsif not c.sync_events and p_sync_events then
    perform public.calendar_backfill(uid, 'event');
  end if;
  if c.sync_schedules and not p_sync_schedules then
    for l in select k.source_id from public.calendar_event_links k where k.user_id = uid and k.source_type = 'schedule' loop
      perform public.enqueue_calendar_sync(uid, 'schedule', l.source_id, true);
    end loop;
  elsif not c.sync_schedules and p_sync_schedules then
    perform public.calendar_backfill(uid, 'schedule');
  end if;
end;
$$;

-- ───────────────────────── Cola (servidor) ─────────────────────────

-- Reserva trabajos vencidos por 2 minutos (varios procesos no hacen lo mismo dos veces)
create function public.claim_calendar_jobs(p_limit int default 20)
returns setof public.calendar_sync_jobs
language sql
security definer
set search_path = ''
as $$
  with due as (
    select j.id from public.calendar_sync_jobs j
    where j.run_after <= pg_catalog.now() and (j.claimed_until is null or j.claimed_until < pg_catalog.now())
    order by j.run_after limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.calendar_sync_jobs j set claimed_until = pg_catalog.now() + interval '2 minutes'
  from due where j.id = due.id
  returning j.*;
$$;

create function public.finish_calendar_job(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.calendar_sync_jobs j where j.id = p_id; $$;

-- Fallo pasajero: se reintenta más tarde (espera creciente); pasados 6 intentos se descarta con su error
create function public.retry_calendar_job(p_id uuid, p_error text, p_delay_seconds int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  update public.calendar_sync_jobs j
  set attempts = j.attempts + 1, last_error = pg_catalog.left(p_error, 300), claimed_until = null,
      run_after = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(p_delay_seconds, 1))
  where j.id = p_id returning j.attempts into v_attempts;
  if v_attempts is not null and v_attempts >= 6 then
    delete from public.calendar_sync_jobs j where j.id = p_id;
  end if;
end;
$$;

-- Llama al servidor web cuando hay trabajos pendientes (como invoke_enforcer: sin secretos en Vault no hace nada)
create function public.invoke_calendar_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'calendar_sync_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'calendar_sync_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.calendar_sync_jobs j where j.run_after <= pg_catalog.now() and (j.claimed_until is null or j.claimed_until < pg_catalog.now())) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-calendar-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

select cron.schedule('calendar-sync', '* * * * *', $$select public.invoke_calendar_sync()$$);

-- ───────────────────────── Avisos ─────────────────────────

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('schedule_reminder', 'schedule_started', 'devotional_reminder', 'event_reminder', 'event_started', 'partner_paired', 'calendar_disconnected'));

-- ───────────────────────── RLS y permisos ─────────────────────────

alter table public.calendar_connections enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.calendar_sync_jobs enable row level security;

create policy "calendar_connections_select_own" on public.calendar_connections for select to authenticated using (user_id = (select auth.uid()));
create policy "calendar_event_links_no_access" on public.calendar_event_links for select to authenticated using (false);
create policy "calendar_sync_jobs_no_access" on public.calendar_sync_jobs for select to authenticated using (false);

revoke all on public.calendar_connections, public.calendar_event_links, public.calendar_sync_jobs from anon, authenticated;
-- La persona ve el estado de su conexión, NUNCA el token cifrado
grant select (user_id, provider, scope, calendar_id, status, sync_events, sync_schedules, connected_at, last_error) on public.calendar_connections to authenticated;
grant select on public.calendar_event_links, public.calendar_sync_jobs to authenticated;

revoke all on function
  public.enqueue_calendar_sync(uuid, text, uuid, boolean), public.calendar_rsvp_changed(), public.calendar_event_changed(),
  public.calendar_subscription_changed(), public.calendar_schedule_changed(), public.calendar_backfill(uuid, text),
  public.set_calendar_preferences(boolean, boolean), public.claim_calendar_jobs(int), public.finish_calendar_job(uuid),
  public.retry_calendar_job(uuid, text, int), public.invoke_calendar_sync()
from public, anon, authenticated;

grant execute on function public.set_calendar_preferences(boolean, boolean) to authenticated;
grant execute on function public.calendar_backfill(uuid, text), public.claim_calendar_jobs(int), public.finish_calendar_job(uuid), public.retry_calendar_job(uuid, text, int) to service_role;
