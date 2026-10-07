-- public 스키마 지문: 로컬(PGlite)과 원격(Supabase)의 스키마가 같은지 비교한다.
-- 종류별로 (개수, md5(정의 전체)) 를 반환한다. 다르면 해당 종류만 상세 비교한다.
with objs as (
  select 'function' as kind, p.proname as name, md5(p.prosrc || coalesce(array_to_string(p.proconfig, ','), '')) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'view', c.relname, md5(pg_get_viewdef(c.oid) || coalesce(array_to_string(c.reloptions, ','), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
  union all
  select 'column', c.relname || '.' || a.attname,
         md5(format_type(a.atttypid, a.atttypmod) || a.attnotnull::text || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || a.attgenerated::text || a.attidentity::text)
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint', c.relname || '.' || k.conname, md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  union all
  select 'domain_check', t.typname || '.' || k.conname, md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_type t on t.oid = k.contypid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  union all
  select 'index', indexname, md5(indexdef) from pg_indexes where schemaname = 'public'
  union all
  select 'policy', tablename || '.' || policyname,
         md5(cmd::text || array_to_string(roles, ',') || coalesce(qual, '') || coalesce(with_check, ''))
  from pg_policies where schemaname = 'public'
  union all
  select 'trigger', c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'comment', c.relname || coalesce('.' || a.attname, ''), md5(d.description)
  from pg_description d join pg_class c on c.oid = d.objoid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
  where n.nspname = 'public' and d.classoid = 'pg_class'::regclass
  union all
  select 'seed', version, md5(weights::text || thresholds::text || coalesce(factor_definitions::text, '') || is_active::text)
  from public.scoring_versions
)
select kind, count(*) as n, md5(string_agg(name || '=' || def, '|' order by name)) as hash
from objs group by kind order by kind;
