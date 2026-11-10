-- Fase 4 — Expulsar a una persona de la sala (el anfitrión) y bloquearle el reingreso.
--
-- La expulsión en el audio la hace el servidor con LiveKit (removeParticipant). Aquí queda el
-- registro en la base: la persona sale (left_at) y se marca como expulsada (removed_at) para que
-- join_room no la deje volver a entrar con el mismo enlace.

alter table public.room_members add column removed_at timestamptz;

comment on column public.room_members.removed_at is
  'Si no es nulo, el anfitrión expulsó a esta persona y no puede volver a entrar a la sala.';

create or replace function public.join_room(p_code text, p_display_name text)
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

  -- Expulsado por el anfitrión: no vuelve a entrar
  if found and v_member.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;

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

create function public.remove_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  perform 1 from public.rooms r
  where r.id = p_room_id and r.host_id = uid and r.status = 'open' for update;
  if not found then raise exception 'not_host' using errcode = 'P0001'; end if;

  if p_user_id = uid then raise exception 'cannot_remove_self' using errcode = 'P0001'; end if;

  -- El anfitrión nunca se expulsa (rm.role <> 'host'); solo personas que están dentro.
  update public.room_members rm
  set left_at = coalesce(rm.left_at, pg_catalog.now()), removed_at = pg_catalog.now()
  where rm.room_id = p_room_id and rm.user_id = p_user_id and rm.role <> 'host';

  if not found then raise exception 'member_not_found' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
