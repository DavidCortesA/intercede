-- La auditoría de la Fase 8 marcaba como "ejecutable sin sesión" la función de event trigger que la plataforma de
-- Supabase instala en el proyecto remoto (rls_auto_enable). Las funciones de trigger y de event trigger no se pueden
-- llamar directamente: se excluyen igual que las de trigger.
create or replace function public.security_audit()
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
  -- 4) Funciones que se pueden llamar sin sesión (rol anon). Las de trigger y de event trigger (p. ej. la que
  --    instala la plataforma de Supabase para activar RLS en tablas nuevas) no se pueden llamar directamente.
  select 'anon_can_execute', (p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text,
         'El rol anon puede ejecutarla'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype not in ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)
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
