-- Fase 11 — Compañero de oración (CLAUDE.md §16 B7).
--
-- Decisión del propietario: SOLO PERSONAS ADULTAS. No se guarda edad ni hay consentimiento parental; el programa exige que la
-- cuenta haya confirmado ser mayor de edad (`profiles.adult_confirmed_at`), y esa confirmación se pide al registrarse y, si falta
-- (cuentas anteriores o de Google), al anotarse. Así nunca se empareja a un menor con una persona adulta.
--
-- Principios de seguridad:
--   * Opcional (opt-in) dentro de la comunidad; cualquiera pausa o sale cuando quiera. Salir BORRA sus peticiones de compañero.
--   * Solo se ve el NOMBRE de la pareja (el mismo que ya ve la comunidad): nunca contacto ni identificadores nuevos.
--   * No se guarda género. Emparejar es aleatorio o por etiqueta de grupo que elige el liderazgo.
--   * Bloquear a alguien termina la pareja y NUNCA vuelven a emparejarse; reportar sigue funcionando (reporte de persona).

-- ───────────────────────── Confirmación de mayoría de edad ─────────────────────────

alter table public.profiles add column adult_confirmed_at timestamptz;

comment on column public.profiles.adult_confirmed_at is 'Cuándo la persona declaró ser mayor de edad (CLAUDE.md §17.2). Solo se escribe al registrarse o con confirm_adult().';

-- El alta toma la declaración del registro (options.data.adult_confirmed = true)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
begin
  raw_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );

  insert into public.profiles (id, display_name, adult_confirmed_at)
  values (
    new.id,
    nullif(pg_catalog.btrim(pg_catalog.left(coalesce(raw_name, ''), 40)), ''),
    case when new.raw_user_meta_data ->> 'adult_confirmed' = 'true' then pg_catalog.now() end
  );

  return new;
end;
$$;

create function public.confirm_adult()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  update public.profiles p set adult_confirmed_at = coalesce(p.adult_confirmed_at, pg_catalog.now()) where p.id = (select auth.uid());
end;
$$;

-- ───────────────────────── Tablas ─────────────────────────

create function public.valid_partner_labels(p_labels text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.cardinality(p_labels) <= 20
    and not exists (select 1 from pg_catalog.unnest(p_labels) as l(v) where l.v is null or pg_catalog.char_length(pg_catalog.btrim(l.v)) not between 1 and 30);
$$;

create table public.partner_programs (
  community_id     uuid primary key references public.communities (id) on delete cascade,
  mode             text not null default 'random' check (mode in ('random', 'group')),
  -- Etiquetas de grupo/célula entre las que se elige (solo con mode = 'group')
  labels           text[] not null default '{}' check (public.valid_partner_labels(labels)),
  active           boolean not null default false,
  -- Última semana (lunes, UTC) en la que se emparejó: hace idempotente la tarea semanal
  last_paired_week date,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.partner_signups (
  community_id uuid not null,
  user_id      uuid not null,
  group_label  text check (group_label is null or char_length(btrim(group_label)) between 1 and 30),
  paused       boolean not null default false,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id),
  -- Salir de la comunidad (o que la saquen) también saca del programa
  foreign key (community_id, user_id) references public.community_members (community_id, user_id) on delete cascade
);

create table public.partner_pairs (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  -- Lunes (UTC) de la semana de la pareja
  week_start   date not null,
  user_a       uuid not null references auth.users (id) on delete cascade,
  user_b       uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- La pareja terminó (alguien salió, se bloquearon o la comunidad lo decidió)
  ended_at     timestamptz,
  constraint partner_pairs_distinct check (user_a <> user_b)
);

-- Una persona está en una sola pareja por semana (con el bloqueo de fila del programa, nunca se repite)
create unique index partner_pairs_a_week on public.partner_pairs (community_id, week_start, user_a);
create unique index partner_pairs_b_week on public.partner_pairs (community_id, week_start, user_b);
create index partner_pairs_users_idx on public.partner_pairs (user_a, user_b, week_start desc);

create table public.partner_requests (
  id         uuid primary key default gen_random_uuid(),
  pair_id    uuid not null references public.partner_pairs (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  content    text not null check (char_length(btrim(content)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index partner_requests_pair_idx on public.partner_requests (pair_id);

-- "Estoy orando por ti": una marca por persona y pareja
create table public.partner_prayers (
  pair_id   uuid not null references public.partner_pairs (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  prayed_at timestamptz not null default now(),
  primary key (pair_id, user_id)
);

-- Revisión semanal sencilla ("¿cómo te fue?")
create table public.partner_checkins (
  pair_id    uuid not null references public.partner_pairs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null check (status in ('good', 'ok', 'hard')),
  note       text check (note is null or char_length(btrim(note)) between 1 and 140),
  created_at timestamptz not null default now(),
  primary key (pair_id, user_id)
);

comment on table public.partner_signups is 'Quién se anotó al programa de compañeros de una comunidad. Cada quien ve solo lo suyo.';
comment on table public.partner_requests is 'Peticiones que una persona escribe para su pareja de la semana. Se borran al salir del programa.';

-- ───────────────────────── Ayudas (RLS) ─────────────────────────

create function public.in_partner_pair(p_pair_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_pairs p
    where p.id = p_pair_id and (p.user_a = (select auth.uid()) or p.user_b = (select auth.uid()))
  );
$$;

-- Máximo 3 peticiones por persona y pareja; solo quien forma parte de la pareja
create function public.partner_requests_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select pg_catalog.count(*) from public.partner_requests r where r.pair_id = new.pair_id and r.author_id = new.author_id) >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger partner_requests_before_insert
  before insert on public.partner_requests
  for each row execute function public.partner_requests_before_insert();

-- Salir del programa (por decisión, por salir de la comunidad o al borrar la cuenta) BORRA lo que esa persona escribió para su
-- pareja y termina las parejas vigentes
create function public.partner_signup_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.partner_requests r
  using public.partner_pairs p
  where r.pair_id = p.id and p.community_id = old.community_id and r.author_id = old.user_id;
  delete from public.partner_prayers x
  using public.partner_pairs p
  where x.pair_id = p.id and p.community_id = old.community_id and x.user_id = old.user_id;
  delete from public.partner_checkins x
  using public.partner_pairs p
  where x.pair_id = p.id and p.community_id = old.community_id and x.user_id = old.user_id;
  update public.partner_pairs p set ended_at = pg_catalog.now()
  where p.community_id = old.community_id and p.ended_at is null and (p.user_a = old.user_id or p.user_b = old.user_id);
  return old;
end;
$$;

create trigger partner_signup_cleanup
  after delete on public.partner_signups
  for each row execute function public.partner_signup_cleanup();

-- Bloquear termina la pareja (y el bloqueo impide emparejarlas de nuevo: ver pair_program)
create function public.partner_block_ends_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.partner_pairs p set ended_at = pg_catalog.now()
  where p.ended_at is null
    and ((p.user_a = new.blocker_id and p.user_b = new.blocked_id) or (p.user_a = new.blocked_id and p.user_b = new.blocker_id));
  return new;
end;
$$;

create trigger partner_block_ends_pair
  after insert on public.blocks
  for each row execute function public.partner_block_ends_pair();

-- ───────────────────────── Notificación de pareja ─────────────────────────

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('schedule_reminder', 'schedule_started', 'devotional_reminder', 'event_reminder', 'event_started', 'partner_paired'));

-- ───────────────────────── Programa (liderazgo) ─────────────────────────
-- Códigos: not_authenticated, not_leader, not_member, invalid_mode, invalid_labels, labels_required, adult_required, program_inactive,
-- invalid_label, no_pair, not_in_pair, pair_ended, invalid_request, too_many_requests, request_not_found, invalid_status, account_required

create function public.configure_partner_program(p_community_id uuid, p_mode text, p_active boolean, p_labels text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_labels text[];
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  if p_mode not in ('random', 'group') then raise exception 'invalid_mode' using errcode = 'P0001'; end if;

  -- Etiquetas sin repetir (sin importar mayúsculas) y sin espacios de más
  select coalesce(pg_catalog.array_agg(l.v order by l.first_pos), '{}') into v_labels
  from (
    select (pg_catalog.array_agg(pg_catalog.btrim(t.v) order by t.ord))[1] as v, pg_catalog.min(t.ord) as first_pos
    from pg_catalog.unnest(coalesce(p_labels, '{}')) with ordinality as t(v, ord)
    group by pg_catalog.lower(pg_catalog.btrim(t.v))
  ) l;
  if not public.valid_partner_labels(v_labels) then raise exception 'invalid_labels' using errcode = 'P0001'; end if;
  if p_mode = 'group' and p_active and pg_catalog.cardinality(v_labels) < 1 then raise exception 'labels_required' using errcode = 'P0001'; end if;

  insert into public.partner_programs (community_id, mode, labels, active, created_by)
  values (p_community_id, p_mode, v_labels, p_active, (select auth.uid()))
  on conflict (community_id) do update set mode = excluded.mode, labels = excluded.labels, active = excluded.active;
end;
$$;

-- ───────────────────────── Anotarse, pausar, salir ─────────────────────────

create function public.join_partner_program(p_community_id uuid, p_group_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_prog  public.partner_programs;
  v_label text := nullif(pg_catalog.btrim(coalesce(p_group_label, '')), '');
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_permanent_user() then raise exception 'account_required' using errcode = 'P0001'; end if;
  if not public.is_community_member(p_community_id) then raise exception 'not_member' using errcode = 'P0001'; end if;
  -- Solo personas adultas (decisión del propietario)
  if not exists (select 1 from public.profiles p where p.id = uid and p.adult_confirmed_at is not null) then
    raise exception 'adult_required' using errcode = 'P0001';
  end if;

  select * into v_prog from public.partner_programs g where g.community_id = p_community_id and g.active;
  if not found then raise exception 'program_inactive' using errcode = 'P0001'; end if;
  if v_prog.mode = 'group' then
    if v_label is null or not (v_label = any (v_prog.labels)) then raise exception 'invalid_label' using errcode = 'P0001'; end if;
  else
    v_label := null;
  end if;

  insert into public.partner_signups (community_id, user_id, group_label, paused) values (p_community_id, uid, v_label, false)
  on conflict (community_id, user_id) do update set group_label = excluded.group_label, paused = false;
end;
$$;

create function public.set_partner_paused(p_community_id uuid, p_paused boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.partner_signups s set paused = p_paused where s.community_id = p_community_id and s.user_id = (select auth.uid());
$$;

create function public.leave_partner_program(p_community_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.partner_signups s where s.community_id = p_community_id and s.user_id = (select auth.uid());
$$;

-- ───────────────────────── Peticiones, oración y revisión ─────────────────────────

-- Comprueba que la persona forma parte de la pareja y que sigue vigente
create function public.partner_pair_for_me(p_pair_id uuid)
returns public.partner_pairs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_pair public.partner_pairs;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_pair from public.partner_pairs p where p.id = p_pair_id and (p.user_a = uid or p.user_b = uid);
  if not found then raise exception 'not_in_pair' using errcode = 'P0001'; end if;
  if v_pair.ended_at is not null then raise exception 'pair_ended' using errcode = 'P0001'; end if;
  return v_pair;
end;
$$;

create function public.add_partner_request(p_pair_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content text := pg_catalog.btrim(coalesce(p_content, ''));
  v_id uuid;
begin
  perform public.partner_pair_for_me(p_pair_id);
  if pg_catalog.char_length(v_content) not between 1 and 200 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  insert into public.partner_requests (pair_id, author_id, content) values (p_pair_id, (select auth.uid()), v_content) returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_partner_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.partner_requests r where r.id = p_request_id and r.author_id = (select auth.uid());
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
end;
$$;

create function public.set_partner_praying(p_pair_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.partner_pair_for_me(p_pair_id);
  if p_on then
    insert into public.partner_prayers (pair_id, user_id) values (p_pair_id, (select auth.uid())) on conflict (pair_id, user_id) do nothing;
  else
    delete from public.partner_prayers x where x.pair_id = p_pair_id and x.user_id = (select auth.uid());
  end if;
end;
$$;

create function public.submit_partner_checkin(p_pair_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  perform public.partner_pair_for_me(p_pair_id);
  if p_status not in ('good', 'ok', 'hard') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 140 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  insert into public.partner_checkins (pair_id, user_id, status, note) values (p_pair_id, (select auth.uid()), p_status, v_note)
  on conflict (pair_id, user_id) do update set status = excluded.status, note = excluded.note, created_at = pg_catalog.now();
end;
$$;

-- ───────────────────────── Emparejar ─────────────────────────

-- Empareja a quienes se anotaron para la semana `p_week` (lunes, UTC). Evita repetir pareja en las últimas 4 semanas y nunca junta
-- a dos personas con un bloqueo entre ellas (en cualquier sentido). Con `mode = 'group'` solo dentro de la misma etiqueta.
-- Idempotente: no hace nada si el programa ya emparejó esa semana. Quien queda sin pareja (número impar o sin opciones) espera.
create function public.pair_program(p_community_id uuid, p_week date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog   public.partner_programs;
  v_users  uuid[];
  v_labels text[];
  v_used   boolean[];
  n        int;
  i        int;
  j        int;
  v_pairs  int := 0;
  v_pair   uuid;
  v_name_a text;
  v_name_b text;
begin
  select * into v_prog from public.partner_programs g where g.community_id = p_community_id and g.active for update;
  if not found or v_prog.last_paired_week is not distinct from p_week then return 0; end if;

  -- Candidatas: anotadas, sin pausa, que siguen en la comunidad y confirmaron ser adultas; en orden aleatorio
  select coalesce(pg_catalog.array_agg(c.user_id), '{}'), coalesce(pg_catalog.array_agg(c.group_label), '{}')
    into v_users, v_labels
  from (
    select s.user_id, s.group_label
    from public.partner_signups s
    join public.community_members m on m.community_id = s.community_id and m.user_id = s.user_id
    join public.profiles pr on pr.id = s.user_id and pr.adult_confirmed_at is not null
    where s.community_id = p_community_id and not s.paused
    order by pg_catalog.random()
  ) c;

  n := coalesce(pg_catalog.cardinality(v_users), 0);
  v_used := pg_catalog.array_fill(false, array[greatest(n, 1)]);

  for i in 1 .. n loop
    continue when v_used[i];
    for j in i + 1 .. n loop
      continue when v_used[j];
      continue when v_prog.mode = 'group' and v_labels[i] is distinct from v_labels[j];
      -- Con un bloqueo entre ellas (en cualquier sentido), nunca
      continue when exists (
        select 1 from public.blocks b
        where (b.blocker_id = v_users[i] and b.blocked_id = v_users[j]) or (b.blocker_id = v_users[j] and b.blocked_id = v_users[i])
      );
      -- Ni repetir pareja de las últimas 4 semanas
      continue when exists (
        select 1 from public.partner_pairs p
        where p.community_id = p_community_id and p.week_start > p_week - 28
          and ((p.user_a = v_users[i] and p.user_b = v_users[j]) or (p.user_a = v_users[j] and p.user_b = v_users[i]))
      );

      insert into public.partner_pairs (community_id, week_start, user_a, user_b) values (p_community_id, p_week, v_users[i], v_users[j])
      returning id into v_pair;
      v_used[i] := true;
      v_used[j] := true;
      v_pairs := v_pairs + 1;

      select coalesce(nullif(pg_catalog.btrim(m.display_name), ''), 'tu compañero') into v_name_a from public.community_members m where m.community_id = p_community_id and m.user_id = v_users[i];
      select coalesce(nullif(pg_catalog.btrim(m.display_name), ''), 'tu compañero') into v_name_b from public.community_members m where m.community_id = p_community_id and m.user_id = v_users[j];
      insert into public.notifications (user_id, kind, title, body, url, dedupe_key) values
        (v_users[i], 'partner_paired', 'Tienes compañero de oración', pg_catalog.left('Esta semana oras con ' || v_name_b || '. Escribe tus peticiones para esta persona.', 300),
         '/comunidades/' || p_community_id::text || '/companero', 'partner:' || v_prog.community_id::text || ':' || p_week::text),
        (v_users[j], 'partner_paired', 'Tienes compañero de oración', pg_catalog.left('Esta semana oras con ' || v_name_a || '. Escribe tus peticiones para esta persona.', 300),
         '/comunidades/' || p_community_id::text || '/companero', 'partner:' || v_prog.community_id::text || ':' || p_week::text)
      on conflict (user_id, dedupe_key) do nothing;
      exit;
    end loop;
  end loop;

  update public.partner_programs g set last_paired_week = p_week where g.community_id = p_community_id;
  return v_pairs;
end;
$$;

-- Cada lunes (06:00 UTC) empareja todos los programas activos
create function public.run_partner_pairing(p_week date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week  date := coalesce(p_week, pg_catalog.date_trunc('week', pg_catalog.now() at time zone 'UTC')::date);
  v_total int := 0;
  c       record;
begin
  for c in select g.community_id from public.partner_programs g where g.active loop
    v_total := v_total + public.pair_program(c.community_id, v_week);
  end loop;
  return v_total;
end;
$$;

-- El liderazgo puede emparejar "ahora" la semana en curso (por ejemplo, al abrir el programa a mitad de semana)
create function public.pair_partners_now(p_community_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'not_leader' using errcode = 'P0001'; end if;
  return public.pair_program(p_community_id, pg_catalog.date_trunc('week', pg_catalog.now() at time zone 'UTC')::date);
end;
$$;

select cron.schedule('partner-pairing', '0 6 * * 1', $$select public.run_partner_pairing()$$);

-- ───────────────────────── Lo que ve cada persona ─────────────────────────

-- Todo lo necesario para la pantalla, en una llamada. De la pareja solo viaja el NOMBRE (y su id para poder reportar o bloquear: es el
-- mismo que ya figura en la lista de miembros).
create function public.partner_overview(p_community_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  v_prog   public.partner_programs;
  v_signup public.partner_signups;
  v_pair   public.partner_pairs;
  v_other  uuid;
  v_adult  boolean;
  v_leader boolean;
  v_stats  jsonb := null;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.is_community_member(p_community_id) then raise exception 'not_member' using errcode = 'P0001'; end if;

  select * into v_prog from public.partner_programs g where g.community_id = p_community_id;
  select * into v_signup from public.partner_signups s where s.community_id = p_community_id and s.user_id = uid;
  select (p.adult_confirmed_at is not null) into v_adult from public.profiles p where p.id = uid;
  v_leader := public.is_community_leader(p_community_id);

  if v_leader then
    -- Solo agregados: cuántas personas hay, nunca quiénes
    v_stats := pg_catalog.jsonb_build_object(
      'signups', (select pg_catalog.count(*) from public.partner_signups s where s.community_id = p_community_id),
      'paused', (select pg_catalog.count(*) from public.partner_signups s where s.community_id = p_community_id and s.paused),
      'pairs_this_week', (select pg_catalog.count(*) from public.partner_pairs p where p.community_id = p_community_id and p.ended_at is null
                          and p.week_start = pg_catalog.date_trunc('week', pg_catalog.now() at time zone 'UTC')::date)
    );
  end if;

  if v_signup.user_id is not null then
    select * into v_pair from public.partner_pairs p
    where p.community_id = p_community_id and (p.user_a = uid or p.user_b = uid)
    order by p.week_start desc limit 1;
  end if;

  if v_pair.id is not null then v_other := case when v_pair.user_a = uid then v_pair.user_b else v_pair.user_a end; end if;

  return pg_catalog.jsonb_build_object(
    'program', case when v_prog.community_id is null then null else pg_catalog.jsonb_build_object('active', v_prog.active, 'mode', v_prog.mode, 'labels', v_prog.labels) end,
    'adult_confirmed', coalesce(v_adult, false),
    'is_leader', v_leader,
    'stats', v_stats,
    'signup', case when v_signup.user_id is null then null else pg_catalog.jsonb_build_object('group_label', v_signup.group_label, 'paused', v_signup.paused) end,
    'pair', case when v_pair.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_pair.id,
      'week_start', v_pair.week_start,
      'ended', v_pair.ended_at is not null,
      'partner_id', v_other,
      'partner_name', coalesce((select nullif(pg_catalog.btrim(m.display_name), '') from public.community_members m where m.community_id = p_community_id and m.user_id = v_other), 'Tu compañero'),
      'my_requests', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'content', r.content) order by r.created_at), '[]'::jsonb) from public.partner_requests r where r.pair_id = v_pair.id and r.author_id = uid),
      -- Lo de la pareja se oculta si hay un bloqueo entre ambas
      'partner_requests', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'content', r.content) order by r.created_at), '[]'::jsonb)
                           from public.partner_requests r where r.pair_id = v_pair.id and r.author_id = v_other and not public.is_blocked_between(v_other)),
      'i_pray', exists (select 1 from public.partner_prayers x where x.pair_id = v_pair.id and x.user_id = uid),
      'partner_prays', exists (select 1 from public.partner_prayers x where x.pair_id = v_pair.id and x.user_id = v_other) and not public.is_blocked_between(v_other),
      'my_checkin', (select pg_catalog.jsonb_build_object('status', c.status, 'note', c.note) from public.partner_checkins c where c.pair_id = v_pair.id and c.user_id = uid),
      'partner_checkin', case when public.is_blocked_between(v_other) then null else
        (select pg_catalog.jsonb_build_object('status', c.status, 'note', c.note) from public.partner_checkins c where c.pair_id = v_pair.id and c.user_id = v_other) end
    ) end
  );
end;
$$;

-- ───────────────────────── RLS y permisos ─────────────────────────

alter table public.partner_programs enable row level security;
alter table public.partner_signups enable row level security;
alter table public.partner_pairs enable row level security;
alter table public.partner_requests enable row level security;
alter table public.partner_prayers enable row level security;
alter table public.partner_checkins enable row level security;

-- El programa lo ven las personas de la comunidad; lo demás, solo quien forma parte
create policy "partner_programs_select_members" on public.partner_programs for select to authenticated using (public.is_community_member(community_id));
create policy "partner_signups_select_own" on public.partner_signups for select to authenticated using (user_id = (select auth.uid()));
create policy "partner_pairs_select_mine" on public.partner_pairs for select to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));
create policy "partner_requests_select" on public.partner_requests for select to authenticated
  using (public.in_partner_pair(pair_id) and (author_id = (select auth.uid()) or not public.is_blocked_between(author_id)));
create policy "partner_prayers_select" on public.partner_prayers for select to authenticated
  using (public.in_partner_pair(pair_id) and (user_id = (select auth.uid()) or not public.is_blocked_between(user_id)));
create policy "partner_checkins_select" on public.partner_checkins for select to authenticated
  using (public.in_partner_pair(pair_id) and (user_id = (select auth.uid()) or not public.is_blocked_between(user_id)));

revoke all on public.partner_programs, public.partner_signups, public.partner_pairs, public.partner_requests, public.partner_prayers, public.partner_checkins
  from anon, authenticated;
grant select on public.partner_programs, public.partner_signups, public.partner_pairs, public.partner_requests, public.partner_prayers, public.partner_checkins to authenticated;

revoke all on function
  public.confirm_adult(), public.valid_partner_labels(text[]), public.in_partner_pair(uuid), public.partner_requests_before_insert(),
  public.partner_signup_cleanup(), public.partner_block_ends_pair(), public.configure_partner_program(uuid, text, boolean, text[]),
  public.join_partner_program(uuid, text), public.set_partner_paused(uuid, boolean), public.leave_partner_program(uuid),
  public.partner_pair_for_me(uuid), public.add_partner_request(uuid, text), public.delete_partner_request(uuid),
  public.set_partner_praying(uuid, boolean), public.submit_partner_checkin(uuid, text, text), public.pair_program(uuid, date),
  public.run_partner_pairing(date), public.pair_partners_now(uuid), public.partner_overview(uuid)
from public, anon, authenticated;

grant execute on function
  public.confirm_adult(), public.valid_partner_labels(text[]), public.in_partner_pair(uuid), public.configure_partner_program(uuid, text, boolean, text[]),
  public.join_partner_program(uuid, text), public.set_partner_paused(uuid, boolean), public.leave_partner_program(uuid),
  public.add_partner_request(uuid, text), public.delete_partner_request(uuid), public.set_partner_praying(uuid, boolean),
  public.submit_partner_checkin(uuid, text, text), public.pair_partners_now(uuid), public.partner_overview(uuid)
to authenticated;
grant execute on function public.pair_program(uuid, date), public.run_partner_pairing(date) to service_role;
