-- JARVIS PHASE 2 · 0011 RLS / 권한
--
-- * 모든 테이블 RLS 활성화.
-- * 사용자 데이터 18개 테이블: authenticated 에게 SELECT / INSERT / UPDATE / DELETE 를
--   owner_id = (select auth.uid()) 조건으로 허용. INSERT / UPDATE 는 WITH CHECK 도 같은 조건.
-- * scoring_versions: 전역 설정. authenticated 는 SELECT 만. 변경은 마이그레이션 / service_role 만.
-- * anon: 정책 없음 + 권한 REVOKE (추가 방어선). 앞으로 public 에 만드는 객체에도 기본 권한을 주지 않는다.
-- * service_role 은 RLS 를 우회한다. 서버 코드에서만 쓰고 owner_id 를 직접 지정해야 한다.

do $$
declare
  t text;
begin
  foreach t in array array[
    'categories',
    'keywords',
    'keyword_snapshots',
    'products',
    'product_snapshots',
    'keyword_product_ranks',
    'competitors',
    'profit_scenarios',
    'profit_calculations',
    'opportunity_scores',
    'product_risks',
    'watchlist',
    'watchlist_events',
    'my_listings',
    'sales_results',
    'predictions',
    'import_jobs',
    'import_rows'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- scoring_versions -------------------------------------------------------------
alter table public.scoring_versions enable row level security;

create policy scoring_versions_select_all on public.scoring_versions
  for select to authenticated using (true);

revoke insert, update, delete, truncate on public.scoring_versions from authenticated;

-- anon 차단 ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- RPC 로 쓰는 함수는 authenticated / service_role 에게만 실행 권한
grant execute on function public.upsert_product_snapshot(jsonb) to authenticated, service_role;
grant execute on function public.upsert_keyword_snapshot(jsonb) to authenticated, service_role;
grant execute on function public.rollback_import(uuid) to authenticated, service_role;
grant execute on function public.source_priority(text) to authenticated, service_role;
grant execute on function public.confidence_rank(text) to authenticated, service_role;
