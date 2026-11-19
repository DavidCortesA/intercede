-- Fase 10 (lote 1) — Guías de oración con temporizador (B3), modo pantalla con petición en foco (B4) y
-- estadísticas para líderes (B5). CLAUDE.md §16.
--
-- Principios:
--   * La hora que manda es la del SERVIDOR: el temporizador de una guía se guarda como "progreso acumulado" + "desde cuándo
--     corre" (timestamptz del servidor). Cada dispositivo calcula el segmento y la cuenta regresiva con la hora del servidor,
--     así que coinciden y sobreviven a reconectar. Saltar de segmento o sumar un minuto es una escritura del anfitrión (RPC).
--   * La pantalla de proyección NO se conecta a LiveKit ni a la sesión: se entra con un enlace secreto revocable que genera el
--     anfitrión; el servidor lo valida y devuelve solo lo que se proyecta (sin autores de las peticiones).
--   * Estadísticas: solo agregados por comunidad; si un indicador involucra a menos de 5 personas se oculta (null).

-- ───────────────────────── Guías de oración ─────────────────────────

-- Segmentos: lista de {title, minutes, instruction?}. Se valida aquí porque la restricción vive con los datos.
create function public.valid_guide_segments(p_segments jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  seg jsonb;
begin
  if p_segments is null or pg_catalog.jsonb_typeof(p_segments) <> 'array' then return false; end if;
  if pg_catalog.jsonb_array_length(p_segments) not between 1 and 20 then return false; end if;
  for seg in select * from pg_catalog.jsonb_array_elements(p_segments) loop
    if pg_catalog.jsonb_typeof(seg) <> 'object' then return false; end if;
    if coalesce(pg_catalog.jsonb_typeof(seg -> 'title'), '') <> 'string' or pg_catalog.char_length(pg_catalog.btrim(seg ->> 'title')) not between 1 and 60 then return false; end if;
    if coalesce(pg_catalog.jsonb_typeof(seg -> 'minutes'), '') <> 'number' or (seg ->> 'minutes') !~ '^[0-9]{1,2}$' or (seg ->> 'minutes')::int not between 1 and 60 then return false; end if;
    if seg ? 'instruction' and (pg_catalog.jsonb_typeof(seg -> 'instruction') <> 'string' or pg_catalog.char_length(seg ->> 'instruction') > 300) then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.prayer_guides (
  id           uuid primary key default gen_random_uuid(),
  -- Nulo = guía del sistema (la ven todas las personas); con valor = guía propia de esa comunidad
  community_id uuid references public.communities (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 80),
  description  text check (description is null or char_length(btrim(description)) between 1 and 300),
  language     text not null default 'es' check (language ~ '^[a-z]{2}$'),
  segments     jsonb not null check (public.valid_guide_segments(segments)),
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint prayer_guides_scope check ((is_system and community_id is null) or (not is_system and community_id is not null))
);

create index prayer_guides_community_idx on public.prayer_guides (community_id) where community_id is not null;

-- Guías del sistema (gratis para todas las personas). Los textos son indicaciones propias (sin citar versiones bíblicas).
insert into public.prayer_guides (title, description, is_system, segments) values
  ('Adoración, confesión, gratitud y súplica', 'Un camino clásico de cuatro momentos para orar con orden.', true,
   '[{"title":"Adoración","minutes":5,"instruction":"Alaba a Dios por quién es. Nombra sus atributos con tus palabras."},
     {"title":"Confesión","minutes":3,"instruction":"En silencio, presenta a Dios lo que pesa en tu corazón y recibe su perdón."},
     {"title":"Gratitud","minutes":5,"instruction":"Da gracias por lo recibido esta semana, grande o pequeño."},
     {"title":"Súplica","minutes":7,"instruction":"Presenta las peticiones de la sala y las tuyas."}]'),
  ('Oración por la nación', 'Cinco momentos para interceder por el país.', true,
   '[{"title":"Gratitud por nuestra nación","minutes":3,"instruction":"Agradece lo bueno de tu país y de su gente."},
     {"title":"Autoridades","minutes":5,"instruction":"Ora por quienes gobiernan, para que actúen con sabiduría y justicia."},
     {"title":"Familias","minutes":5,"instruction":"Ora por los hogares: protección, reconciliación y esperanza."},
     {"title":"Justicia y paz","minutes":5,"instruction":"Ora por quienes sufren violencia, escasez o injusticia."},
     {"title":"La iglesia","minutes":4,"instruction":"Ora para que la iglesia sea luz y sirva con amor."}]'),
  ('Silencio y escucha', 'Un rato quieto para escuchar a Dios.', true,
   '[{"title":"Llegar","minutes":2,"instruction":"Respira hondo. Suelta las prisas y reconoce que Dios está presente."},
     {"title":"Silencio","minutes":10,"instruction":"Quédate en silencio. Si te distraes, vuelve con calma."},
     {"title":"Compartir","minutes":3,"instruction":"Si quieres, comparte en una frase lo que sentiste. Nadie está obligado."}]'),
  ('El Padre Nuestro, guiado', 'Seis pausas para orar con las peticiones que Jesús enseñó.', true,
   '[{"title":"Acércate a Dios como Padre","minutes":2,"instruction":"Reconoce que oras como hijo o hija, con confianza."},
     {"title":"Que su nombre sea honrado","minutes":2,"instruction":"Alaba su nombre y pide que sea honrado en tu vida y en tu ciudad."},
     {"title":"Que venga su reino","minutes":3,"instruction":"Pide que se haga su voluntad aquí, como se hace en el cielo."},
     {"title":"El pan de cada día","minutes":3,"instruction":"Presenta tus necesidades y las de quienes están en la sala."},
     {"title":"Perdón","minutes":3,"instruction":"Recibe perdón y pide corazón para perdonar a quien te ofendió."},
     {"title":"Protección del mal","minutes":3,"instruction":"Pide que Dios te guarde de la tentación y del mal."}]');

-- La guía en curso de una sala (una a la vez). Es una COPIA de la guía: si después se edita o se borra, la sesión no cambia.
create table public.room_guide_runs (
  room_id         uuid primary key references public.rooms (id) on delete cascade,
  guide_id        uuid references public.prayer_guides (id) on delete set null,
  title           text not null,
  segments        jsonb not null check (public.valid_guide_segments(segments)),
  -- Milisegundos extra sumados a cada segmento ("+1 minuto"), uno por segmento
  extra_ms        int[] not null,
  status          text not null check (status in ('running', 'paused')),
  -- Progreso acumulado de la guía y, si corre, desde qué instante del servidor se cuenta
  base_elapsed_ms bigint not null default 0 check (base_elapsed_ms >= 0),
  running_since   timestamptz,
  started_at      timestamptz not null default now(),
  constraint room_guide_runs_clock check ((status = 'running') = (running_since is not null))
);

-- Segmento que corresponde a una posición (ms desde el inicio). `idx` nulo = la guía ya terminó.
create function public.guide_segment_at(p_segments jsonb, p_extra int[], p_pos bigint)
returns table (idx int, seg_start bigint, seg_end bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  n      int := pg_catalog.jsonb_array_length(p_segments);
  i      int;
  acc    bigint := 0;
  dur    bigint;
begin
  for i in 0 .. n - 1 loop
    dur := ((p_segments -> i ->> 'minutes')::bigint) * 60000 + coalesce(p_extra[i + 1], 0);
    if p_pos < acc + dur then
      return query select i, acc, acc + dur;
      return;
    end if;
    acc := acc + dur;
  end loop;
  return query select null::int, acc, acc;
end;
$$;

-- Hora del servidor: los dispositivos calculan su diferencia con ella para mostrar la cuenta regresiva
create function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select pg_catalog.now(); $$;

-- Guías propias: administración y liderazgo, solo con plan Plus/Pro (CLAUDE.md §16.4). Códigos: not_leader, plan_required,
-- invalid_title, invalid_segments, too_many_guides, guide_not_found
create function public.create_guide(p_community_id uuid, p_title text, p_description text, p_segments jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_desc  text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_id    uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  if not coalesce(((public.entitlements_for(p_community_id) ->> 'own_guides'))::boolean, false) then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 or (v_desc is not null and pg_catalog.char_length(v_desc) > 300) then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;
  if not public.valid_guide_segments(p_segments) then raise exception 'invalid_segments' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.prayer_guides g where g.community_id = p_community_id) >= 30 then
    raise exception 'too_many_guides' using errcode = 'P0001';
  end if;

  insert into public.prayer_guides (community_id, created_by, title, description, segments)
  values (p_community_id, uid, v_title, v_desc, p_segments) returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_guide(p_guide_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
begin
  select g.community_id into v_community from public.prayer_guides g where g.id = p_guide_id and not g.is_system;
  if not found then raise exception 'guide_not_found' using errcode = 'P0001'; end if;
  if not public.is_community_leader(v_community) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  delete from public.prayer_guides g where g.id = p_guide_id;
end;
$$;

-- Inicia (o reemplaza) la guía de la sala. Solo quien anfitriona; una guía de comunidad solo en salas de esa comunidad.
-- Códigos: not_host, guide_not_found, guide_wrong_community
create function public.start_guide(p_room_id uuid, p_guide_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  v_room public.rooms;
  v_g    public.prayer_guides;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_room from public.rooms r where r.id = p_room_id and r.host_id = uid and r.status = 'open';
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;
  select * into v_g from public.prayer_guides g where g.id = p_guide_id;
  if not found then raise exception 'guide_not_found' using errcode = 'P0001'; end if;
  if not v_g.is_system and v_g.community_id is distinct from v_room.community_id then
    raise exception 'guide_wrong_community' using errcode = 'P0001';
  end if;

  insert into public.room_guide_runs (room_id, guide_id, title, segments, extra_ms, status, base_elapsed_ms, running_since, started_at)
  values (p_room_id, v_g.id, v_g.title, v_g.segments,
          pg_catalog.array_fill(0, array[pg_catalog.jsonb_array_length(v_g.segments)]), 'running', 0, pg_catalog.now(), pg_catalog.now())
  on conflict (room_id) do update
    set guide_id = excluded.guide_id, title = excluded.title, segments = excluded.segments, extra_ms = excluded.extra_ms,
        status = 'running', base_elapsed_ms = 0, running_since = pg_catalog.now(), started_at = pg_catalog.now();
end;
$$;

-- Pausar, reanudar, saltar al siguiente segmento, sumar un minuto al actual o terminar. Códigos: not_host,
-- no_guide_running, invalid_action, guide_finished
create function public.control_guide(p_room_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  r    public.room_guide_runs;
  pos  bigint;
  seg  record;
  last int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.rooms x where x.id = p_room_id and x.host_id = uid and x.status = 'open') then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  if p_action not in ('pause', 'resume', 'skip', 'add_minute', 'stop') then raise exception 'invalid_action' using errcode = 'P0001'; end if;

  select * into r from public.room_guide_runs g where g.room_id = p_room_id for update;
  if not found then raise exception 'no_guide_running' using errcode = 'P0001'; end if;

  if p_action = 'stop' then
    delete from public.room_guide_runs g where g.room_id = p_room_id;
    return;
  end if;

  pos := r.base_elapsed_ms + case when r.status = 'running' then (extract(epoch from (pg_catalog.now() - r.running_since)) * 1000)::bigint else 0 end;
  select * into seg from public.guide_segment_at(r.segments, r.extra_ms, pos);
  last := pg_catalog.jsonb_array_length(r.segments) - 1;

  if p_action = 'pause' then
    if r.status = 'running' then
      update public.room_guide_runs g set status = 'paused', base_elapsed_ms = pos, running_since = null where g.room_id = p_room_id;
    end if;
  elsif p_action = 'resume' then
    if r.status = 'paused' then
      update public.room_guide_runs g set status = 'running', running_since = pg_catalog.now() where g.room_id = p_room_id;
    end if;
  elsif p_action = 'skip' then
    -- Terminada o en el último segmento: saltar equivale a terminar
    if seg.idx is null or seg.idx >= last then
      delete from public.room_guide_runs g where g.room_id = p_room_id;
    else
      update public.room_guide_runs g
      set base_elapsed_ms = seg.seg_end, running_since = case when r.status = 'running' then pg_catalog.now() else null end
      where g.room_id = p_room_id;
    end if;
  else -- add_minute
    if seg.idx is null then raise exception 'guide_finished' using errcode = 'P0001'; end if;
    update public.room_guide_runs g
    set extra_ms = (select pg_catalog.array_agg(case when t.ord = seg.idx + 1 then least(t.val + 60000, 1800000) else t.val end order by t.ord)
                    from pg_catalog.unnest(r.extra_ms) with ordinality as t(val, ord))
    where g.room_id = p_room_id;
  end if;
end;
$$;

-- ───────────────────────── Petición en foco y modo pantalla ─────────────────────────

-- "En foco": la petición por la que se ora ahora, elegida por quien anfitriona (la pantalla de proyección la muestra grande).
-- Es el primer paso hacia el estado "Orando ahora" de CLAUDE.md §15.3, sin cola todavía.
alter table public.rooms add column focus_request_id uuid references public.prayer_requests (id) on delete set null;

create function public.set_room_focus(p_room_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = (select auth.uid()) and r.status = 'open') then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  if p_request_id is not null and not exists (select 1 from public.prayer_requests pr where pr.id = p_request_id and pr.room_id = p_room_id) then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  update public.rooms r set focus_request_id = p_request_id where r.id = p_room_id;
end;
$$;

-- Enlace de pantalla: secreto, revocable (generar otro invalida el anterior), solo lo ve y lo maneja quien anfitriona
create table public.room_display_links (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  token      text not null unique default public.new_invite_token(),
  created_at timestamptz not null default now()
);

create function public.create_display_link(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := public.new_invite_token();
begin
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = (select auth.uid()) and r.status = 'open') then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  insert into public.room_display_links (room_id, token) values (p_room_id, v_token)
  on conflict (room_id) do update set token = excluded.token, created_at = pg_catalog.now();
  return v_token;
end;
$$;

create function public.revoke_display_link(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = (select auth.uid())) then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  delete from public.room_display_links d where d.room_id = p_room_id;
end;
$$;

-- Lo que se proyecta. SOLO la service role (la ruta del servidor valida el enlace). Devuelve null si el enlace no sirve.
-- No incluye autores ni nombres de personas: solo el texto de la petición en foco y las que siguen.
create function public.display_state(p_code text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room  public.rooms;
  v_focus text;
  v_next  jsonb;
  v_run   public.room_guide_runs;
begin
  select r.* into v_room
  from public.rooms r
  join public.room_display_links d on d.room_id = r.id
  where r.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, ''))) and d.token = p_token;
  if not found then return null; end if;

  if v_room.status <> 'open' then
    return pg_catalog.jsonb_build_object('status', 'closed', 'name', v_room.name, 'server_now', pg_catalog.now());
  end if;

  select pr.content into v_focus from public.prayer_requests pr where pr.id = v_room.focus_request_id and not pr.is_answered;
  select coalesce(pg_catalog.jsonb_agg(x.content order by x.created_at), '[]'::jsonb) into v_next
  from (
    select pr.content, pr.created_at from public.prayer_requests pr
    where pr.room_id = v_room.id and not pr.is_answered and pr.id is distinct from v_room.focus_request_id
      and (v_room.focus_request_id is null or pr.created_at > coalesce((select f.created_at from public.prayer_requests f where f.id = v_room.focus_request_id), '-infinity'))
    order by pr.created_at limit 2
  ) x;

  select * into v_run from public.room_guide_runs g where g.room_id = v_room.id;

  return pg_catalog.jsonb_build_object(
    'status', 'open',
    'name', v_room.name,
    'code', v_room.code,
    'focus', v_focus,
    'next', v_next,
    'guide', case when v_run.room_id is null then null else pg_catalog.jsonb_build_object(
      'title', v_run.title, 'segments', v_run.segments, 'extra_ms', v_run.extra_ms, 'status', v_run.status,
      'base_elapsed_ms', v_run.base_elapsed_ms, 'running_since', v_run.running_since) end,
    'server_now', pg_catalog.now()
  );
end;
$$;

-- ───────────────────────── Estadísticas para líderes (B5) ─────────────────────────

-- Solo agregados por comunidad y semana (lunes, UTC). Nunca minutos por persona: si un indicador involucra a menos de 5
-- personas distintas, se devuelve null. Plus: últimas 5 semanas (~30 días). Pro: hasta 52 semanas. Gratuito: plan_required.
-- Códigos: not_leader, plan_required
create function public.community_stats(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level text;
  v_weeks int;
  v_to    date := pg_catalog.date_trunc('week', pg_catalog.now() at time zone 'UTC')::date;
  v_from  date;
  v_series jsonb;
  v_people int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  v_level := public.entitlements_for(p_community_id) ->> 'stats';
  if v_level = 'none' then raise exception 'plan_required' using errcode = 'P0001'; end if;

  v_weeks := case when v_level = 'history' then 52 else 5 end;
  v_from := v_to - (v_weeks - 1) * 7;

  with weeks as (
    select pg_catalog.generate_series(v_from, v_to, interval '7 days')::date as w
  ),
  usage as (
    select pg_catalog.date_trunc('week', ue.left_at at time zone 'UTC')::date as w,
           pg_catalog.sum(ue.minutes)::int as minutes,
           pg_catalog.count(distinct ue.user_id)::int as people,
           pg_catalog.count(distinct (ue.room_id, ue.user_id))::int as attendances,
           pg_catalog.count(distinct ue.room_id)::int as rooms_with_people
    from public.usage_events ue
    where ue.community_id = p_community_id and ue.left_at >= v_from::timestamp at time zone 'UTC'
    group by 1
  ),
  rooms_held as (
    select pg_catalog.date_trunc('week', r.created_at at time zone 'UTC')::date as w, pg_catalog.count(*)::int as n
    from public.rooms r
    where r.community_id = p_community_id and r.created_at >= v_from::timestamp at time zone 'UTC'
    group by 1
  ),
  req_new as (
    select pg_catalog.date_trunc('week', cr.created_at at time zone 'UTC')::date as w, pg_catalog.count(*)::int as n
    from public.community_requests cr
    where cr.community_id = p_community_id and cr.created_at >= v_from::timestamp at time zone 'UTC'
    group by 1
  ),
  req_answered as (
    select pg_catalog.date_trunc('week', cr.answered_at at time zone 'UTC')::date as w, pg_catalog.count(*)::int as n
    from public.community_requests cr
    where cr.community_id = p_community_id and cr.answered_at >= v_from::timestamp at time zone 'UTC'
    group by 1
  ),
  devos as (
    select pg_catalog.date_trunc('week', dp.read_at at time zone 'UTC')::date as w,
           pg_catalog.count(*)::int as reads, pg_catalog.count(distinct dp.user_id)::int as readers
    from public.devotional_progress dp
    join public.devotionals d on d.id = dp.devotional_id
    where d.community_id = p_community_id and dp.read_at >= v_from::timestamp at time zone 'UTC'
    group by 1
  )
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'week_start', w.w,
      'rooms', coalesce(rh.n, 0),
      -- Tiempo y participación: solo si participaron 5 personas distintas o más esa semana
      'person_minutes', case when coalesce(u.people, 0) >= 5 then u.minutes end,
      'avg_participants', case when coalesce(u.people, 0) >= 5 then pg_catalog.round(u.attendances::numeric / nullif(u.rooms_with_people, 0), 1) end,
      'had_attendance', coalesce(u.people, 0) > 0,
      'requests_new', coalesce(rn.n, 0),
      'requests_answered', coalesce(ra.n, 0),
      'devotionals_read', case when coalesce(dv.readers, 0) >= 5 then dv.reads end,
      'had_devotional_reads', coalesce(dv.reads, 0) > 0,
      'members', (select pg_catalog.count(*)::int from public.community_members cm
                  where cm.community_id = p_community_id and cm.joined_at < (w.w + 7)::timestamp at time zone 'UTC')
    ) order by w.w
  ) into v_series
  from weeks w
  left join usage u on u.w = w.w
  left join rooms_held rh on rh.w = w.w
  left join req_new rn on rn.w = w.w
  left join req_answered ra on ra.w = w.w
  left join devos dv on dv.w = w.w;

  select pg_catalog.count(distinct ue.user_id)::int into v_people
  from public.usage_events ue where ue.community_id = p_community_id and ue.left_at >= v_from::timestamp at time zone 'UTC';

  return pg_catalog.jsonb_build_object(
    'level', v_level,
    'from', v_from,
    'to', v_to,
    -- Personas distintas en todo el periodo (para decidir si se muestran totales de tiempo)
    'people_in_period', v_people,
    'weeks', v_series
  );
end;
$$;

-- ───────────────────────── RLS ─────────────────────────

alter table public.prayer_guides enable row level security;
alter table public.room_guide_runs enable row level security;
alter table public.room_display_links enable row level security;

create policy "prayer_guides_select" on public.prayer_guides for select to authenticated
  using (is_system or (community_id is not null and public.is_community_member(community_id)));
-- La sesión de guía la ven quienes están en la sala; solo se escribe con las funciones del anfitrión
create policy "room_guide_runs_select_members" on public.room_guide_runs for select to authenticated
  using (public.is_room_member(room_id));
create policy "room_display_links_select_host" on public.room_display_links for select to authenticated
  using (public.is_room_host(room_id));

revoke all on public.prayer_guides, public.room_guide_runs, public.room_display_links from anon, authenticated;
grant select on public.prayer_guides, public.room_guide_runs, public.room_display_links to authenticated;

alter publication supabase_realtime add table public.room_guide_runs;

-- ───────────────────────── Permisos de ejecución ─────────────────────────

revoke all on function
  public.valid_guide_segments(jsonb), public.guide_segment_at(jsonb, int[], bigint), public.get_server_time(),
  public.create_guide(uuid, text, text, jsonb), public.delete_guide(uuid), public.start_guide(uuid, uuid),
  public.control_guide(uuid, text), public.set_room_focus(uuid, uuid), public.create_display_link(uuid),
  public.revoke_display_link(uuid), public.display_state(text, text), public.community_stats(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_server_time(), public.create_guide(uuid, text, text, jsonb), public.delete_guide(uuid),
  public.start_guide(uuid, uuid), public.control_guide(uuid, text), public.set_room_focus(uuid, uuid),
  public.create_display_link(uuid), public.revoke_display_link(uuid), public.community_stats(uuid)
to authenticated;

-- Las tablas con CHECK/ funciones auxiliares las usa la propia base; la pantalla solo la lee la service role
grant execute on function public.valid_guide_segments(jsonb), public.guide_segment_at(jsonb, int[], bigint) to authenticated, service_role;
grant execute on function public.display_state(text, text) to service_role;
