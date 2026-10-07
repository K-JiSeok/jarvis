-- JARVIS PHASE 2-2 DB 검증 스크립트
--
-- 사용법
--  * 로컬:    npm run db:verify   (PGlite 에 마이그레이션 적용 후 이 파일 실행)
--  * Supabase: 마이그레이션 적용 후 SQL Editor 에 이 파일 전체를 붙여넣고 실행
--
-- 전체가 BEGIN … ROLLBACK 이다. 테스트 사용자·데이터는 아무것도 남지 않는다.
-- 실패하면 "FAIL <항목>: ..." 오류로 즉시 멈춘다 (트랜잭션은 커밋되지 않는다).
-- 성공하면 마지막 SELECT 가 통과 항목 목록을 반환한다.

begin;

-- ---------------------------------------------------------------------------
-- 테스트 헬퍼 (pg_temp: 이 세션에서만 존재)
-- ---------------------------------------------------------------------------
select set_config('jv.passed', '', true);

create function pg_temp.jv_pass(p_label text) returns void language plpgsql as $f$
begin
  perform set_config('jv.passed', current_setting('jv.passed', true) || p_label || E'\n', true);
end;
$f$;

create function pg_temp.jv_assert(p_label text, p_cond boolean, p_detail text default '') returns void
language plpgsql as $f$
begin
  if not coalesce(p_cond, false) then
    raise exception 'FAIL %: %', p_label, p_detail;
  end if;
  perform pg_temp.jv_pass(p_label);
end;
$f$;

create function pg_temp.jv_expect_error(p_label text, p_sql text, p_state text) returns void
language plpgsql as $f$
declare
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is null then
    raise exception 'FAIL %: expected error % but statement succeeded', p_label, p_state;
  end if;
  if v_state <> p_state then
    raise exception 'FAIL %: expected error % but got % (%)', p_label, p_state, v_state, v_msg;
  end if;
  perform pg_temp.jv_pass(p_label);
end;
$f$;

create function pg_temp.jv_set(p_name text, p_value text) returns void language sql as $f$
  select set_config('jv.' || p_name, p_value, true);
$f$;

create function pg_temp.jv(p_name text) returns uuid language sql as $f$
  select current_setting('jv.' || p_name)::uuid;
$f$;

-- 테스트 사용자 A / B
select pg_temp.jv_set('user_a', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.jv_set('user_b', 'b0000000-0000-4000-8000-00000000000b');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'jarvis-verify-a@example.invalid'),
  ('b0000000-0000-4000-8000-00000000000b', 'jarvis-verify-b@example.invalid');

-- ===========================================================================
-- S. 구조 검증 (postgres)
-- ===========================================================================
do $$
declare
  v_expected text[] := array[
    'categories', 'keywords', 'keyword_snapshots', 'products', 'product_snapshots',
    'keyword_product_ranks', 'competitors', 'profit_scenarios', 'profit_calculations',
    'scoring_versions', 'opportunity_scores', 'product_risks', 'watchlist', 'watchlist_events',
    'my_listings', 'sales_results', 'predictions', 'import_jobs', 'import_rows'];
  v_owner_tables text[] := array_remove(v_expected, 'scoring_versions');
  v_actual text[];
  v_n integer;
  t text;
begin
  select array_agg(tablename::text order by tablename) into v_actual
  from pg_tables where schemaname = 'public';
  perform pg_temp.jv_assert('S01 테이블 19개',
    v_actual = (select array_agg(x order by x) from unnest(v_expected) x),
    format('actual: %s', v_actual));

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and c.relname in ('v_product_latest', 'v_keyword_latest', 'v_current_scores', 'v_prediction_vs_actual')
    and 'security_invoker=true' = any (c.reloptions);
  perform pg_temp.jv_assert('S02 뷰 4개 (security_invoker)', v_n = 4, format('%s', v_n));

  select count(*) into v_n from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'd'
    and t.typname in ('source_type_t', 'confidence_t', 'verdict_t', 'risk_type_t', 'risk_level_t');
  perform pg_temp.jv_assert('S03 DOMAIN 5개', v_n = 5, format('%s', v_n));

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  perform pg_temp.jv_assert('S04 RLS 활성화 19개', v_n = 19, format('%s', v_n));

  foreach t in array v_owner_tables loop
    select count(*) into v_n from pg_policies
    where schemaname = 'public' and tablename = t and 'authenticated' = any (roles)
      and (qual like '%owner_id = ( SELECT auth.uid()%' or with_check like '%owner_id = ( SELECT auth.uid()%');
    if v_n <> 4 then
      raise exception 'FAIL S05 owner 정책: % 에 정책 %개', t, v_n;
    end if;
  end loop;
  perform pg_temp.jv_pass('S05 owner_id 정책 18개 테이블 × 4 (select/insert/update/delete)');

  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'scoring_versions';
  perform pg_temp.jv_assert('S06 scoring_versions 정책 = SELECT 1개', v_n = 1
    and exists (select 1 from pg_policies where tablename = 'scoring_versions' and cmd = 'SELECT'));

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v')
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  perform pg_temp.jv_assert('S07 anon 테이블/뷰 권한 없음', v_n = 0, format('%s개에 권한 있음', v_n));

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.jv_assert('S08 anon 함수 실행 권한 없음', v_n = 0, format('%s개', v_n));

  perform pg_temp.jv_assert('S09 authenticated 는 scoring_versions 쓰기 권한 없음',
    not has_table_privilege('authenticated', 'public.scoring_versions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.scoring_versions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.scoring_versions', 'DELETE')
    and has_table_privilege('authenticated', 'public.scoring_versions', 'SELECT'));

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in
    ('set_updated_at', 'log_watchlist_status', 'upsert_product_snapshot', 'upsert_keyword_snapshot', 'rollback_import')
    and not p.prosecdef;
  perform pg_temp.jv_assert('S10 함수 5개 (모두 SECURITY INVOKER)', v_n = 5, format('%s', v_n));

  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where tg.tgname = 'set_updated_at' and c.relname in
    ('categories', 'keywords', 'products', 'competitors', 'profit_scenarios', 'watchlist', 'my_listings', 'sales_results');
  perform pg_temp.jv_assert('S11 updated_at 트리거 8개', v_n = 8, format('%s', v_n));

  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where c.relname = 'watchlist' and tg.tgname like 'log_watchlist_status%';
  perform pg_temp.jv_assert('S12 watchlist 상태 트리거 2개 (before/after)', v_n = 2, format('%s', v_n));

  -- 핵심 UNIQUE
  perform pg_temp.jv_assert('S13 핵심 UNIQUE 제약',
    (select count(*) from pg_constraint where contype = 'u' and conname in (
      'products_owner_coupang_product_key', 'keywords_owner_normalized_key',
      'product_snapshots_product_day_source_key', 'keyword_snapshots_keyword_day_source_key',
      'keyword_product_ranks_natural_key', 'watchlist_owner_product_key',
      'import_jobs_owner_idempotency_key', 'sales_results_natural_key')) = 8);

  perform pg_temp.jv_assert('S14 현재 점수 UNIQUE = NULLS NOT DISTINCT + 부분 인덱스',
    exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
            where c.relname = 'opportunity_scores_current_key' and i.indisunique
              and i.indnullsnotdistinct and i.indpred is not null));

  perform pg_temp.jv_assert('S15 file_hash 부분 UNIQUE',
    exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
            where c.relname = 'import_jobs_file_hash_succeeded_key' and i.indisunique and i.indpred is not null));

  -- B-1: public 테이블끼리의 FK 는 scoring_version 을 빼고 모두 owner_id 를 포함한 복합 FK
  select count(*) into v_n
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace pn on pn.oid = parent.relnamespace and pn.nspname = 'public'
  where c.contype = 'f'
    and parent.relname <> 'scoring_versions'
    and not exists (
      select 1 from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      where a.attname = 'owner_id');
  perform pg_temp.jv_assert('S16 복합 FK (owner_id 포함) — 예외 없음', v_n = 0, format('owner_id 없는 FK %s개', v_n));

  select count(*) into v_n from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relname = 'sales_results' and a.attname in ('net_profit', 'net_margin_rate') and a.attgenerated = 's';
  perform pg_temp.jv_assert('S17 sales_results 생성 컬럼 2개 (STORED)', v_n = 2);

  -- v1 seed = src/config/scoring-weights.ts
  perform pg_temp.jv_assert('S18 scoring v1 가중치 = scoring-weights.ts',
    (select weights from public.scoring_versions where version = 'v1') = '{
      "demand": 15, "salesVolume": 15, "salesGrowth": 10, "competition": 15, "wingEntry": 10,
      "reviewBarrier": 10, "conversion": 5, "margin": 15, "marketStability": 5}'::jsonb);
  perform pg_temp.jv_assert('S19 scoring v1 가중치 합계 100',
    (select sum(value::int) from public.scoring_versions, jsonb_each_text(weights) where version = 'v1') = 100);
  perform pg_temp.jv_assert('S20 scoring v1 판정 기준 80/60 + 활성',
    (select thresholds = '{"strongBuy": 80, "review": 60}'::jsonb and is_active
     from public.scoring_versions where version = 'v1'));
  perform pg_temp.jv_assert('S21 scoring v1 컬럼 매핑 9개',
    (select count(*) from public.scoring_versions, jsonb_each(factor_definitions) f
     where version = 'v1' and f.value ? 'column') = 9);

  -- 결정 ①: 순이익률 컬럼 numeric(12,4)
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and numeric_precision = 12 and numeric_scale = 4
    and (table_name, column_name) in (('sales_results', 'net_margin_rate'),
                                      ('profit_calculations', 'net_margin_rate'),
                                      ('predictions', 'net_margin_predicted'));
  perform pg_temp.jv_assert('S22 순이익률 컬럼 3개 numeric(12,4)', v_n = 3, format('%s', v_n));

  -- 결정 ②: 수정 방지 트리거 3개
  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where (c.relname, tg.tgname) in (('scoring_versions', 'prevent_scoring_version_mutation'),
                                   ('opportunity_scores', 'prevent_opportunity_score_mutation'),
                                   ('predictions', 'prevent_prediction_mutation'));
  perform pg_temp.jv_assert('S23 수정 방지 트리거 3개', v_n = 3, format('%s', v_n));
end;
$$;

-- ===========================================================================
-- A. 사용자 A 로 기능 검증
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('jv.user_a'), 'role', 'authenticated')::text, true);

-- F. 전체 흐름: category → keyword → keyword_snapshot → product → product_snapshot
--             → profit_scenario → profit_calculation → opportunity_score → product_risk → watchlist
do $$
declare
  v_cat uuid; v_kw uuid; v_p1 uuid; v_scn uuid; v_calc uuid; v_score uuid; v_wl uuid;
  v_res jsonb;
begin
  insert into public.categories (coupang_category_id, name, depth, path, coupang_fee_rate, source_type)
  values ('TEST-1001', '[TEST] 주방용품', 1, '[TEST] 주방용품', 0.108, 'MANUAL') returning id into v_cat;

  insert into public.keywords (keyword, normalized_keyword, category_id)
  values ('[TEST] 실리콘 트레이', '[test] 실리콘 트레이', v_cat) returning id into v_kw;

  v_res := public.upsert_keyword_snapshot(jsonb_build_object(
    'keyword_id', v_kw, 'captured_at', '2026-10-06T10:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B',
    'search_volume', 12000, 'coupang_product_count', 8000, 'wing_ratio', 0.42));
  perform pg_temp.jv_assert('F01 keyword_snapshot INSERT (upsert 함수)', v_res ->> 'action' = 'INSERTED', v_res::text);

  insert into public.products (coupang_product_id, product_name, brand, category_id, seller_type)
  values ('TEST-900001', '[TEST] 상품 1', '테스트브랜드', v_cat, 'WING_SELLER') returning id into v_p1;

  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-06T10:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 29900, 'review_count', 1200, 'views_28d', 15000,
    'sales_period_days', 28, 'sales_estimated', 500, 'revenue_estimated', 14950000));
  perform pg_temp.jv_assert('F02 product_snapshot INSERT (upsert 함수)',
    v_res ->> 'action' = 'INSERTED' and (v_res -> 'row' ->> 'captured_on') = '2026-10-06', v_res::text);

  insert into public.profit_scenarios (product_id, is_primary, sale_price, unit_cost_amount, unit_cost_currency, exchange_rate,
    intl_shipping_per_unit, domestic_shipping_per_unit, logistics_fee_per_unit, ad_cost_rate, fixed_cost_total)
  values (v_p1, true, 29900, 32.5, 'CNY', 190.0, 1500, 3000, 2500, 0.1, 500000) returning id into v_scn;

  insert into public.profit_calculations (scenario_id, product_id, formula_version, inputs_snapshot,
    net_profit_per_unit, net_margin_rate, roi, break_even_units)
  values (v_scn, v_p1, 'profit-v1', '{"sale_price": 29900}', 6200, 0.2074, 0.75, 81) returning id into v_calc;

  insert into public.opportunity_scores (product_id, scoring_version, total_score, demand_score, sales_score,
    growth_score, competition_score, wing_score, review_barrier_score, conversion_score, margin_score,
    stability_score, verdict, input_refs)
  values (v_p1, 'v1', 82.5, 80, 85, 70, 75, 90, 60, 50, 95, 80, 'STRONG_BUY',
    jsonb_build_object('profit_calculation_id', v_calc)) returning id into v_score;

  insert into public.product_risks (product_id, opportunity_score_id, risk_type, risk_level, description, source_type)
  values (v_p1, v_score, 'REVIEW_OVERLOAD', 'MEDIUM', '[TEST] 상위 리뷰 평균 1,000건 이상', 'CALCULATED');

  insert into public.watchlist (product_id, keyword_id, memo) values (v_p1, v_kw, '[TEST]') returning id into v_wl;

  perform pg_temp.jv_assert('F03 전체 흐름 연결 (10단계)',
    (select count(*) from public.product_risks r
     join public.opportunity_scores s on s.id = r.opportunity_score_id
     join public.products p on p.id = s.product_id
     join public.categories c on c.id = p.category_id
     join public.watchlist w on w.product_id = p.id
     join public.keywords k on k.id = w.keyword_id
     join public.keyword_snapshots ks on ks.keyword_id = k.id
     join public.product_snapshots ps on ps.product_id = p.id
     join public.profit_scenarios sc on sc.product_id = p.id
     join public.profit_calculations pc on pc.scenario_id = sc.id
     where p.id = v_p1) = 1);

  perform pg_temp.jv_assert('F04 owner_id 기본값 = auth.uid()',
    (select owner_id from public.products where id = v_p1) = pg_temp.jv('user_a'));

  perform pg_temp.jv_set('cat', v_cat::text);
  perform pg_temp.jv_set('kw', v_kw::text);
  perform pg_temp.jv_set('p1', v_p1::text);
  perform pg_temp.jv_set('score_v1', v_score::text);
  perform pg_temp.jv_set('calc', v_calc::text);
  perform pg_temp.jv_set('wl', v_wl::text);
end;
$$;

-- W. watchlist 이벤트 트리거
do $$
declare
  v_wl uuid := pg_temp.jv('wl');
  v_e record;
begin
  select * into v_e from public.watchlist_events where watchlist_id = v_wl;
  perform pg_temp.jv_assert('W01 등록 시 이벤트 (NULL → WATCHING)',
    v_e.from_status is null and v_e.to_status = 'WATCHING'
    and (select count(*) from public.watchlist_events where watchlist_id = v_wl) = 1);

  update public.watchlist set status_changed_at = '2000-01-01' where id = v_wl;
  perform set_config('jarvis.watchlist_note', '[TEST] 샘플 요청', true);
  update public.watchlist set status = 'SOURCING' where id = v_wl;
  perform set_config('jarvis.watchlist_note', '', true);

  select * into v_e from public.watchlist_events where watchlist_id = v_wl order by id desc limit 1;
  perform pg_temp.jv_assert('W02 상태 변경 이벤트 (WATCHING → SOURCING, note)',
    v_e.from_status = 'WATCHING' and v_e.to_status = 'SOURCING' and v_e.note = '[TEST] 샘플 요청');
  perform pg_temp.jv_assert('W03 status_changed_at 자동 갱신',
    (select status_changed_at from public.watchlist where id = v_wl) > '2000-01-01');

  update public.watchlist set status = 'SOURCING', memo = '[TEST] 메모만 변경' where id = v_wl;
  perform pg_temp.jv_assert('W04 상태가 같으면 이벤트 없음',
    (select count(*) from public.watchlist_events where watchlist_id = v_wl) = 2);
end;
$$;

-- P. 스냅샷 / 현재값 뷰 / UPSERT
do $$
declare
  v_p1 uuid := pg_temp.jv('p1');
  v_res jsonb;
  v_l record;
begin
  -- 두 날짜 저장 + 최신값
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T10:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 28900, 'review_count', 1350, 'views_28d', 17000,
    'sales_period_days', 28, 'sales_estimated', 620, 'revenue_estimated', 17918000));
  perform pg_temp.jv_assert('P01 2026-10-06 / 2026-10-07 두 행 저장',
    (select count(*) from public.product_snapshots where product_id = v_p1) = 2);

  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P02 뷰 = 최신 날짜 값',
    v_l.price = 28900 and v_l.price_captured_on = '2026-10-07' and v_l.review_count = 1350
    and v_l.sales_estimated = 620 and v_l.sales_estimated_period_days = 28 and v_l.snapshot_count = 2,
    row_to_json(v_l)::text);

  -- 같은 날짜: confidence A 가 B 를 이긴다 (항목별: page 는 리뷰 수가 없음)
  perform public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T11:00:00+09:00',
    'source_type', 'COUPANG_PAGE', 'confidence', 'A', 'price', 28800));
  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P03 같은 날짜 confidence A > B',
    v_l.price = 28800 and v_l.price_source = 'COUPANG_PAGE' and v_l.price_confidence = 'A');
  perform pg_temp.jv_assert('P04 항목별 선택 (NULL 항목은 다른 스냅샷 값)',
    v_l.review_count = 1350 and v_l.review_count_source = 'EXTENSION');

  -- confidence 가 우선: MANUAL B 는 COUPANG_PAGE A 를 못 이긴다
  perform public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T12:00:00+09:00',
    'source_type', 'MANUAL', 'confidence', 'B', 'price', 27000));
  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P05 confidence 가 출처보다 우선 (A COUPANG_PAGE > B MANUAL)', v_l.price = 28800);

  -- 같은 confidence 면 출처 우선순위: WING_SESSION(2) > COUPANG_PAGE(4)
  perform public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T13:00:00+09:00',
    'source_type', 'WING_SESSION', 'confidence', 'A', 'price', 28700));
  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P06 같은 confidence → 출처 우선순위 (WING_SESSION > COUPANG_PAGE)',
    v_l.price = 28700 and v_l.price_source = 'WING_SESSION');

  -- is_excluded 행은 현재값에서 빠진다
  perform public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T13:00:00+09:00',
    'source_type', 'WING_SESSION', 'confidence', 'A', 'is_excluded', true, 'excluded_reason', '[TEST] 오입력'));
  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P07 is_excluded 행 제외', v_l.price = 28800);

  -- metric_meta 항목별 출처 덮어쓰기
  perform public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T14:00:00+09:00',
    'source_type', 'OFFICIAL_API', 'confidence', 'B', 'conversion_rate', 0.05,
    'metric_meta', '{"conversion_rate": {"source": "CALCULATED", "confidence": "C"}}'::jsonb));
  select * into v_l from public.v_product_latest where product_id = v_p1;
  perform pg_temp.jv_assert('P08 metric_meta 항목별 source/confidence',
    v_l.conversion_rate = 0.05 and v_l.conversion_rate_source = 'CALCULATED' and v_l.conversion_rate_confidence = 'C');

  -- UPSERT: 같은 날짜 + 같은 출처
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T18:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B', 'price', null, 'review_count', 1400));
  perform pg_temp.jv_assert('P09 같은 날짜+출처 → UPDATED, 행 수 그대로',
    v_res ->> 'action' = 'UPDATED'
    and (select count(*) from public.product_snapshots
         where product_id = v_p1 and captured_on = '2026-10-07' and source_type = 'EXTENSION') = 1);
  perform pg_temp.jv_assert('P10 새 값 NULL → 기존 값 유지 / non-null → 갱신',
    (v_res -> 'row' ->> 'price')::bigint = 28900 and (v_res -> 'row' ->> 'review_count')::int = 1400
    and (v_res -> 'row' ->> 'views_28d')::int = 17000
    and (v_res -> 'previous' ->> 'review_count')::int = 1350, v_res::text);
  perform pg_temp.jv_assert('P11 captured_at 은 최신 시각으로',
    (v_res -> 'row' ->> 'captured_at')::timestamptz = '2026-10-07T18:00:00+09:00');

  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T18:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B', 'review_count', 1400));
  perform pg_temp.jv_assert('P12 변경 없는 재전송 → SKIPPED', v_res ->> 'action' = 'SKIPPED', v_res::text);

  -- 0 은 실제 0 으로 저장 (NULL 과 구분)
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T19:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B', 'sales_actual', 0));
  perform pg_temp.jv_assert('P13 0 은 0 으로 저장', (v_res -> 'row' ->> 'sales_actual')::int = 0);

  -- captured_on 미지정 → captured_at 의 KST 날짜 (UTC 16:30 = KST 다음날 01:30)
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-07T16:30:00Z',
    'source_type', 'COUPANG_PAGE', 'confidence', 'A', 'price', 28600));
  perform pg_temp.jv_assert('P14 captured_on = KST 날짜', (v_res -> 'row' ->> 'captured_on') = '2026-10-08');

  -- 키워드 스냅샷도 같은 규칙
  v_res := public.upsert_keyword_snapshot(jsonb_build_object(
    'keyword_id', pg_temp.jv('kw'), 'captured_at', '2026-10-06T20:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B', 'search_volume', null, 'ad_bid', 350));
  perform pg_temp.jv_assert('P15 키워드 스냅샷 UPSERT (NULL 유지)',
    v_res ->> 'action' = 'UPDATED' and (v_res -> 'row' ->> 'search_volume')::int = 12000
    and (v_res -> 'row' ->> 'ad_bid')::int = 350);

  perform public.upsert_keyword_snapshot(jsonb_build_object(
    'keyword_id', pg_temp.jv('kw'), 'captured_at', '2026-10-07T09:00:00+09:00',
    'source_type', 'EXTENSION', 'confidence', 'B', 'search_volume', 13500));
  perform pg_temp.jv_assert('P16 v_keyword_latest 최신값 + 항목별 선택',
    (select search_volume = 13500 and search_volume_captured_on = '2026-10-07'
       and wing_ratio = 0.42 and wing_ratio_captured_on = '2026-10-06'
     from public.v_keyword_latest where keyword_id = pg_temp.jv('kw')));
end;
$$;

select pg_temp.jv_expect_error('P17 정의되지 않은 키 → 오류',
  format($q$select public.upsert_product_snapshot('{"product_id": "%s", "captured_at": "2026-10-07T10:00:00+09:00", "source_type": "EXTENSION", "confidence": "B", "sales_estimate": 1}')$q$, pg_temp.jv('p1')),
  '22023');
select pg_temp.jv_expect_error('P18 필수값 누락 → 오류',
  format($q$select public.upsert_product_snapshot('{"product_id": "%s", "source_type": "EXTENSION", "confidence": "B"}')$q$, pg_temp.jv('p1')),
  '23502');

-- V. 점수 버전
select pg_temp.jv_expect_error('V01 같은 (상품, 키워드 NULL, v1) 현재 점수 2개 금지 (NULLS NOT DISTINCT)',
  format($q$insert into public.opportunity_scores (product_id, scoring_version, total_score, verdict, input_refs)
            values ('%s', 'v1', 70, 'REVIEW', '{}')$q$, pg_temp.jv('p1')),
  '23505');

do $$
declare
  v_p1 uuid := pg_temp.jv('p1');
begin
  -- 재계산: 이전 행 is_current = false, 새 행 INSERT
  update public.opportunity_scores set is_current = false where id = pg_temp.jv('score_v1');
  insert into public.opportunity_scores (product_id, scoring_version, total_score, verdict, input_refs)
  values (v_p1, 'v1', 78, 'REVIEW', '{}');
  perform pg_temp.jv_assert('V02 v1 재계산 → 과거 행 보존 + 현재 1개',
    (select count(*) from public.opportunity_scores where product_id = v_p1 and scoring_version = 'v1') = 2
    and (select count(*) from public.opportunity_scores where product_id = v_p1 and scoring_version = 'v1' and is_current) = 1);
end;
$$;

-- v2 버전 등록은 service role / 마이그레이션만 가능 → 일반 사용자 차단 확인 후 postgres 로 등록
select pg_temp.jv_expect_error('V03 authenticated 는 scoring_versions INSERT 불가',
  $q$insert into public.scoring_versions (version, weights, thresholds) values ('v2-test', '{}', '{}')$q$,
  '42501');
reset role;
insert into public.scoring_versions (version, weights, thresholds, description, is_active)
values ('v2-test', '{"demand": 20}', '{"strongBuy": 85, "review": 65}', '[TEST]', false);
set local role authenticated;

do $$
declare
  v_p1 uuid := pg_temp.jv('p1');
begin
  insert into public.opportunity_scores (product_id, scoring_version, total_score, verdict, input_refs)
  values (v_p1, 'v2-test', 66, 'REVIEW', '{}');
  perform pg_temp.jv_assert('V04 v1 과 v2 현재 점수 동시 존재',
    (select count(*) from public.opportunity_scores where product_id = v_p1 and is_current) = 2
    and (select count(*) from public.opportunity_scores where product_id = v_p1 and scoring_version = 'v1') = 2);
  perform pg_temp.jv_assert('V05 v_current_scores = 활성 버전(v1) 현재 점수만',
    (select count(*) from public.v_current_scores where product_id = v_p1) = 1
    and (select scoring_version from public.v_current_scores where product_id = v_p1) = 'v1');
end;
$$;

-- C. CHECK / DOMAIN
select pg_temp.jv_expect_error('C01 source_type DOMAIN 위반',
  $q$insert into public.categories (name, source_type) values ('[TEST] x', 'FOO')$q$, '23514');
select pg_temp.jv_expect_error('C02 confidence DOMAIN 위반',
  format($q$select public.upsert_product_snapshot('{"product_id": "%s", "captured_at": "2026-10-07T10:00:00+09:00", "source_type": "EXTENSION", "confidence": "D"}')$q$, pg_temp.jv('p1')),
  '23514');
select pg_temp.jv_expect_error('C03 rating 0~5',
  format($q$select public.upsert_product_snapshot('{"product_id": "%s", "captured_at": "2026-10-09T10:00:00+09:00", "source_type": "EXTENSION", "confidence": "B", "rating": 6}')$q$, pg_temp.jv('p1')),
  '23514');
select pg_temp.jv_expect_error('C04 경쟁상품 자기 자신 금지',
  format($q$insert into public.competitors (product_id, competitor_product_id, relation_type, source_type) values ('%s', '%s', 'SIMILAR', 'MANUAL')$q$,
    pg_temp.jv('p1'), pg_temp.jv('p1')),
  '23514');
select pg_temp.jv_expect_error('C05 watchlist status 값 제한 (SUCCESS 는 outcome)',
  format($q$update public.watchlist set status = 'SUCCESS' where id = '%s'$q$, pg_temp.jv('wl')), '23514');
select pg_temp.jv_expect_error('C06 total_score 0~100',
  format($q$insert into public.opportunity_scores (product_id, keyword_id, scoring_version, total_score, verdict, input_refs) values ('%s', '%s', 'v1', 101, 'STRONG_BUY', '{}')$q$,
    pg_temp.jv('p1'), pg_temp.jv('kw')),
  '23514');
select pg_temp.jv_expect_error('C07 verdict DOMAIN 위반',
  format($q$insert into public.opportunity_scores (product_id, keyword_id, scoring_version, total_score, verdict, input_refs) values ('%s', '%s', 'v1', 50, 'BUY', '{}')$q$,
    pg_temp.jv('p1'), pg_temp.jv('kw')),
  '23514');
select pg_temp.jv_expect_error('C08 risk_type DOMAIN 위반',
  format($q$insert into public.product_risks (product_id, risk_type, risk_level, description, source_type) values ('%s', 'OTHER', 'LOW', 'x', 'MANUAL')$q$,
    pg_temp.jv('p1')),
  '23514');
select pg_temp.jv_expect_error('C09 products UNIQUE (owner_id, coupang_product_id)',
  $q$insert into public.products (coupang_product_id, product_name) values ('TEST-900001', '[TEST] 중복')$q$, '23505');
select pg_temp.jv_expect_error('C10 keywords UNIQUE (owner_id, normalized_keyword)',
  $q$insert into public.keywords (keyword, normalized_keyword) values ('[TEST] 실리콘  트레이', '[test] 실리콘 트레이')$q$, '23505');
select pg_temp.jv_expect_error('C11 watchlist UNIQUE (owner_id, product_id)',
  format($q$insert into public.watchlist (product_id) values ('%s')$q$, pg_temp.jv('p1')), '23505');
select pg_temp.jv_expect_error('C12 같은 상품 점수 위험 FK (다른 상품 점수 참조 금지)',
  format($q$with p2 as (insert into public.products (coupang_product_id, product_name) values ('TEST-900099', '[TEST] 다른 상품') returning id)
            insert into public.product_risks (product_id, opportunity_score_id, risk_type, risk_level, description, source_type)
            select p2.id, '%s', 'PRICE_WAR', 'LOW', 'x', 'CALCULATED' from p2$q$, pg_temp.jv('score_v1')),
  '23503');

-- K. 키워드 순위 UNIQUE
do $$
begin
  insert into public.keyword_product_ranks (keyword_id, product_id, captured_on, captured_at, source_type, confidence, rank_position, is_ad)
  values (pg_temp.jv('kw'), pg_temp.jv('p1'), '2026-10-07', now(), 'EXTENSION', 'B', 3, false),
         (pg_temp.jv('kw'), pg_temp.jv('p1'), '2026-10-07', now(), 'EXTENSION', 'B', 1, true);
  perform pg_temp.jv_assert('K01 같은 날 광고/자연 순위 각각 저장', true);
end;
$$;
select pg_temp.jv_expect_error('K02 keyword_product_ranks UNIQUE (keyword, product, 날짜, 출처, is_ad)',
  format($q$insert into public.keyword_product_ranks (keyword_id, product_id, captured_on, captured_at, source_type, confidence, rank_position, is_ad)
            values ('%s', '%s', '2026-10-07', now(), 'EXTENSION', 'B', 5, false)$q$, pg_temp.jv('kw'), pg_temp.jv('p1')),
  '23505');

-- I. Import 중복 방지
do $$
declare
  v_j1 uuid; v_j2 uuid;
begin
  insert into public.import_jobs (channel, import_type, source_type, file_name, file_hash, status, started_at, finished_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'test.csv', 'sha256-TEST-1', 'SUCCEEDED', now(), now())
  returning id into v_j1;
  insert into public.import_jobs (channel, import_type, source_type, file_name, file_hash)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'test (1).csv', 'sha256-TEST-1')
  returning id into v_j2;
  perform pg_temp.jv_set('dup_job', v_j2::text);
  perform pg_temp.jv_assert('I01 같은 해시의 대기(PENDING) job 생성은 허용 (앱이 경고)', v_j2 is not null);

  insert into public.import_jobs (channel, import_type, source_type, file_hash, dry_run, status)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'sha256-TEST-1', true, 'SUCCEEDED');
  perform pg_temp.jv_assert('I02 dry run 은 같은 해시도 허용', true);

  insert into public.import_jobs (channel, import_type, source_type, idempotency_key)
  values ('EXTENSION', 'MIXED', 'EXTENSION', 'ext-batch-TEST-1');
end;
$$;
select pg_temp.jv_expect_error('I03 같은 file_hash 두 번째 성공 처리 차단',
  format($q$update public.import_jobs set status = 'SUCCEEDED' where id = '%s'$q$, pg_temp.jv('dup_job')), '23505');
select pg_temp.jv_expect_error('I04 같은 idempotency_key 재전송 차단',
  $q$insert into public.import_jobs (channel, import_type, source_type, idempotency_key) values ('EXTENSION', 'MIXED', 'EXTENSION', 'ext-batch-TEST-1')$q$,
  '23505');

-- R. rollback_import
do $$
declare
  v_p1 uuid := pg_temp.jv('p1');
  v_job uuid; v_job2 uuid; v_job3 uuid; v_job4 uuid; v_job5 uuid;
  v_p2 uuid; v_p3 uuid; v_p5 uuid;
  v_res jsonb;
  v_snap_id bigint;
begin
  -- R1: 상품 1개 신규 + 스냅샷 1개 신규 + 기존 스냅샷 1개 갱신
  insert into public.import_jobs (channel, import_type, source_type, status, started_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'PROCESSING', now()) returning id into v_job;

  insert into public.products (coupang_product_id, product_name) values ('TEST-900002', '[TEST] 상품 2') returning id into v_p2;
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id)
  values (v_job, 1, '{}', 'INSERTED', 'products', v_p2::text);

  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p2, 'captured_at', '2026-10-08T10:00:00+09:00', 'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 15900, 'import_job_id', v_job));
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id, previous_values)
  values (v_job, 2, '{}', v_res ->> 'action', 'product_snapshots', v_res -> 'row' ->> 'id', v_res -> 'previous');

  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-06T10:00:00+09:00', 'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 30500, 'import_job_id', v_job));
  v_snap_id := (v_res -> 'row' ->> 'id')::bigint;
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id, previous_values)
  values (v_job, 3, '{}', v_res ->> 'action', 'product_snapshots', v_snap_id::text, v_res -> 'previous');
  insert into public.import_rows (import_job_id, row_number, payload, result, error_message)
  values (v_job, 4, '{"bad": true}', 'FAILED', '[TEST] 필수 컬럼 없음');

  update public.import_jobs set status = 'PARTIAL', finished_at = now() where id = v_job;

  v_res := public.rollback_import(v_job);
  perform pg_temp.jv_assert('R01 롤백 성공 (삭제 2, 복원 1)',
    (v_res ->> 'ok')::boolean and (v_res ->> 'deleted_rows')::int = 2 and (v_res ->> 'restored_rows')::int = 1, v_res::text);
  perform pg_temp.jv_assert('R02 INSERTED 상품·스냅샷 삭제',
    not exists (select 1 from public.products where id = v_p2)
    and not exists (select 1 from public.product_snapshots where product_id = v_p2));
  perform pg_temp.jv_assert('R03 UPDATED 스냅샷 previous_values 로 복원',
    (select price = 29900 and import_job_id is null from public.product_snapshots where id = v_snap_id));
  perform pg_temp.jv_assert('R04 job 상태 ROLLED_BACK',
    (select status from public.import_jobs where id = v_job) = 'ROLLED_BACK');
  perform pg_temp.jv_set('rolled_job', v_job::text);

  -- R2: import 가 만든 상품을 다른 데이터(관심상품)가 참조 → 전체 중단
  insert into public.import_jobs (channel, import_type, source_type, status, started_at, finished_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'SUCCEEDED', now(), now()) returning id into v_job2;
  insert into public.products (coupang_product_id, product_name) values ('TEST-900003', '[TEST] 상품 3') returning id into v_p3;
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id)
  values (v_job2, 1, '{}', 'INSERTED', 'products', v_p3::text);
  insert into public.watchlist (product_id) values (v_p3);

  v_res := public.rollback_import(v_job2);
  perform pg_temp.jv_assert('R05 참조 충돌 → 중단 + 충돌 목록 (REFERENCED by watchlist)',
    not (v_res ->> 'ok')::boolean
    and exists (select 1 from jsonb_array_elements(v_res -> 'conflicts') c
                where c ->> 'code' = 'REFERENCED' and c ->> 'referenced_by' = 'watchlist'), v_res::text);
  perform pg_temp.jv_assert('R06 충돌 시 아무것도 바뀌지 않음',
    exists (select 1 from public.products where id = v_p3)
    and (select status from public.import_jobs where id = v_job2) = 'SUCCEEDED');

  -- R3 → R4: 이후 다른 import 가 같은 행을 갱신
  insert into public.import_jobs (channel, import_type, source_type, status, started_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'PROCESSING', now()) returning id into v_job3;
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-09T10:00:00+09:00', 'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 27900, 'import_job_id', v_job3));
  v_snap_id := (v_res -> 'row' ->> 'id')::bigint;
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id, previous_values)
  values (v_job3, 1, '{}', v_res ->> 'action', 'product_snapshots', v_snap_id::text, v_res -> 'previous');
  update public.import_jobs set status = 'SUCCEEDED', finished_at = now() where id = v_job3;

  insert into public.import_jobs (channel, import_type, source_type, status, started_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'PROCESSING', now()) returning id into v_job4;
  v_res := public.upsert_product_snapshot(jsonb_build_object(
    'product_id', v_p1, 'captured_at', '2026-10-09T15:00:00+09:00', 'source_type', 'EXTENSION', 'confidence', 'B',
    'price', 27500, 'import_job_id', v_job4));
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id, previous_values)
  values (v_job4, 1, '{}', v_res ->> 'action', 'product_snapshots', v_snap_id::text, v_res -> 'previous');
  update public.import_jobs set status = 'SUCCEEDED', finished_at = now() where id = v_job4;

  v_res := public.rollback_import(v_job3);
  perform pg_temp.jv_assert('R07 이후 import 가 같은 행 갱신 → LATER_IMPORT 충돌',
    not (v_res ->> 'ok')::boolean
    and exists (select 1 from jsonb_array_elements(v_res -> 'conflicts') c
                where c ->> 'code' = 'LATER_IMPORT' and (c ->> 'other_import_job_id')::uuid = v_job4), v_res::text);
  perform pg_temp.jv_assert('R08 충돌 시 스냅샷 그대로',
    (select price from public.product_snapshots where id = v_snap_id) = 27500);

  v_res := public.rollback_import(v_job4);
  perform pg_temp.jv_assert('R09 나중 import 먼저 롤백 → R3 값으로 복원',
    (v_res ->> 'ok')::boolean
    and (select price = 27900 and import_job_id = v_job3 from public.product_snapshots where id = v_snap_id), v_res::text);
  v_res := public.rollback_import(v_job3);
  perform pg_temp.jv_assert('R10 그다음 R3 롤백 성공 → 스냅샷 삭제',
    (v_res ->> 'ok')::boolean and not exists (select 1 from public.product_snapshots where id = v_snap_id), v_res::text);

  -- R5: import 이후 앱에서 직접 수정 (updated_at > finished_at)
  insert into public.import_jobs (channel, import_type, source_type, status, started_at, finished_at)
  values ('FILE', 'PRODUCT_SNAPSHOTS', 'EXTENSION', 'SUCCEEDED', now() - interval '2 hours', now() - interval '1 hour')
  returning id into v_job5;
  insert into public.products (coupang_product_id, product_name) values ('TEST-900005', '[TEST] 상품 5') returning id into v_p5;
  insert into public.import_rows (import_job_id, row_number, payload, result, target_table, target_id)
  values (v_job5, 1, '{}', 'INSERTED', 'products', v_p5::text);
  update public.products set product_name = '[TEST] 상품 5 (수정)' where id = v_p5;
  v_res := public.rollback_import(v_job5);
  perform pg_temp.jv_assert('R11 import 이후 직접 수정 → MODIFIED_AFTER_IMPORT 충돌',
    not (v_res ->> 'ok')::boolean
    and exists (select 1 from jsonb_array_elements(v_res -> 'conflicts') c where c ->> 'code' = 'MODIFIED_AFTER_IMPORT'),
    v_res::text);
end;
$$;

select pg_temp.jv_expect_error('R12 이미 롤백된 job 재롤백 → 오류',
  format($q$select public.rollback_import('%s')$q$, pg_temp.jv('rolled_job')), '55000');

-- G. 실제 판매 / 생성 컬럼 / 예측 vs 실제
do $$
declare
  v_p1 uuid := pg_temp.jv('p1');
  v_listing uuid;
  v_pred uuid;
  d integer;
  v_r record;
begin
  insert into public.my_listings (watchlist_id, reference_product_id, listing_name, status, launch_date,
    baseline_score_id, baseline_profit_calc_id)
  values (pg_temp.jv('wl'), v_p1, '[TEST] 내 상품', 'ACTIVE', '2026-10-01', pg_temp.jv('score_v1'), pg_temp.jv('calc'))
  returning id into v_listing;

  for d in 0..6 loop
    insert into public.sales_results (listing_id, period_type, period_start, period_end, units_sold, gross_revenue,
      ad_spend, cogs, logistics_cost, coupang_fees, other_costs, source_type, confidence)
    values (v_listing, 'DAY', date '2026-10-01' + d, date '2026-10-01' + d, 10, 299000,
      30000, 120000, 25000, 32000, 2000, 'WING_SESSION', 'A');
  end loop;
  -- 같은 기간을 WEEK 로도 입력 (광고비 모름 → 순이익 NULL)
  insert into public.sales_results (listing_id, period_type, period_start, period_end, units_sold, gross_revenue,
    ad_spend, cogs, logistics_cost, coupang_fees, other_costs, source_type, confidence)
  values (v_listing, 'WEEK', '2026-10-01', '2026-10-07', 70, 2093000, null, 840000, 175000, 224000, 14000, 'MANUAL', 'B');
  -- 예측 기간을 벗어나는 월 실적은 합산 대상이 아님
  insert into public.sales_results (listing_id, period_type, period_start, period_end, units_sold, gross_revenue,
    ad_spend, cogs, logistics_cost, coupang_fees, other_costs, source_type, confidence)
  values (v_listing, 'MONTH', '2026-10-01', '2026-10-31', 300, 8970000, 900000, 3600000, 750000, 960000, 60000, 'WING_SESSION', 'A');

  select net_profit, net_margin_rate into v_r from public.sales_results
  where listing_id = v_listing and period_type = 'DAY' and period_start = '2026-10-01';
  perform pg_temp.jv_assert('G01 생성 컬럼 net_profit / net_margin_rate',
    v_r.net_profit = 90000 and v_r.net_margin_rate = 0.3010, row_to_json(v_r)::text);
  perform pg_temp.jv_assert('G02 비용 NULL → 순이익 NULL (모름)',
    (select net_profit is null and net_margin_rate is null from public.sales_results
     where listing_id = v_listing and period_type = 'WEEK'));

  insert into public.predictions (product_id, listing_id, opportunity_score_id, model_version,
    target_period_start, target_period_end, sales_predicted, revenue_predicted, net_profit_predicted, net_margin_predicted)
  values (v_p1, v_listing, pg_temp.jv('score_v1'), 'pred-v1-test', '2026-10-01', '2026-10-07', 80, 2392000, 720000, 0.3010)
  returning id into v_pred;

  select * into v_r from public.v_prediction_vs_actual where prediction_id = v_pred and period_type = 'DAY';
  perform pg_temp.jv_assert('G03 예측 vs 실제 (DAY 7행 합산, 기간 완전 포함)',
    v_r.result_rows = 7 and v_r.coverage_days = 7 and v_r.is_complete
    and v_r.sales_actual = 70 and v_r.sales_error = -10 and v_r.sales_abs_error = 10 and v_r.sales_error_rate = -0.1429
    and v_r.revenue_actual = 2093000 and v_r.net_profit_actual = 630000 and v_r.net_profit_error = -90000,
    row_to_json(v_r)::text);
  perform pg_temp.jv_assert('G04 period_type / 출처별로 따로 집계 (이중 합산 없음)',
    (select count(*) from public.v_prediction_vs_actual where prediction_id = v_pred) = 2
    and (select net_profit_actual is null and sales_actual = 70 from public.v_prediction_vs_actual
         where prediction_id = v_pred and period_type = 'WEEK'));
  perform pg_temp.jv_assert('G05 예측 기간 밖 MONTH 실적 제외',
    not exists (select 1 from public.v_prediction_vs_actual where prediction_id = v_pred and period_type = 'MONTH'));

  perform pg_temp.jv_set('listing', v_listing::text);
end;
$$;

select pg_temp.jv_expect_error('G06 sales_results UNIQUE (listing, period_type, period_start, source)',
  format($q$insert into public.sales_results (listing_id, period_type, period_start, period_end, source_type, confidence)
            values ('%s', 'DAY', '2026-10-01', '2026-10-01', 'WING_SESSION', 'A')$q$, pg_temp.jv('listing')),
  '23505');
select pg_temp.jv_expect_error('G07 기간 역전 금지',
  format($q$insert into public.sales_results (listing_id, period_type, period_start, period_end, source_type, confidence)
            values ('%s', 'DAY', '2026-10-09', '2026-10-08', 'MANUAL', 'B')$q$, pg_temp.jv('listing')),
  '23514');
select pg_temp.jv_expect_error('G08 baseline 점수 행 삭제 차단 (판매 기준 보존)',
  format($q$delete from public.opportunity_scores where id = '%s'$q$, pg_temp.jv('score_v1')), '23503');

-- U. updated_at 트리거 (8개 테이블)
do $$
declare
  t text;
  v_n bigint;
begin
  insert into public.competitors (product_id, competitor_product_id, relation_type, source_type)
  select pg_temp.jv('p1'), id, 'SIMILAR', 'MANUAL' from public.products where coupang_product_id = 'TEST-900003';

  foreach t in array array['categories', 'keywords', 'products', 'competitors', 'profit_scenarios',
                           'watchlist', 'my_listings', 'sales_results'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n = 0 then
      raise exception 'FAIL U01: % 에 테스트 행이 없음', t;
    end if;
    execute format('update public.%I set updated_at = %L', t, '2000-01-01');
    execute format('select count(*) from public.%I where updated_at = %L', t, '2000-01-01') into v_n;
    if v_n <> 0 then
      raise exception 'FAIL U01: % updated_at 이 갱신되지 않음', t;
    end if;
  end loop;
  perform pg_temp.jv_pass('U01 updated_at 자동 갱신 (8개 테이블)');
end;
$$;

-- M. 결정 ① 극단값 저장 / 결정 ② 수정 방지 · DELETE
do $$
declare
  v_listing uuid := pg_temp.jv('listing');
  v_r record;
begin
  -- 하루 매출 9,900원에 광고비 1,000만 원 → 순이익률 약 -1010 (numeric(7,4) 였다면 INSERT 실패)
  insert into public.sales_results (listing_id, period_type, period_start, period_end, units_sold, gross_revenue,
    ad_spend, cogs, logistics_cost, coupang_fees, other_costs, source_type, confidence)
  values (v_listing, 'DAY', '2026-10-20', '2026-10-20', 1, 9900, 10000000, 3000, 2500, 1000, 0, 'MANUAL', 'B')
  returning net_profit, net_margin_rate into v_r;
  perform pg_temp.jv_assert('M01 극단 손실 실적 저장 (net_margin_rate ≈ -1010)',
    v_r.net_profit = -9996600 and v_r.net_margin_rate = -1009.7576, row_to_json(v_r)::text);

  insert into public.profit_calculations (scenario_id, product_id, formula_version, inputs_snapshot, net_margin_rate, is_current)
  select id, product_id, 'profit-v1', '{}', -99999999.9999, false from public.profit_scenarios
  where product_id = pg_temp.jv('p1') limit 1;
  insert into public.predictions (product_id, model_version, target_period_start, target_period_end, net_margin_predicted)
  values (pg_temp.jv('p1'), 'pred-v1-test', '2026-11-01', '2026-11-30', 99999999.9999);
  perform pg_temp.jv_assert('M02 numeric(12,4) 경계값 저장 (±99,999,999.9999)', true);
end;
$$;

select pg_temp.jv_expect_error('M03 opportunity_scores total_score UPDATE 차단',
  format($q$update public.opportunity_scores set total_score = 99 where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M04 opportunity_scores 세부 점수 UPDATE 차단',
  format($q$update public.opportunity_scores set margin_score = 10 where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M05 opportunity_scores verdict UPDATE 차단',
  format($q$update public.opportunity_scores set verdict = 'EXCLUDE' where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M06 opportunity_scores calculated_at UPDATE 차단',
  format($q$update public.opportunity_scores set calculated_at = now() - interval '1 day' where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M07 opportunity_scores scoring_version UPDATE 차단',
  format($q$update public.opportunity_scores set scoring_version = 'v2-test' where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M08 opportunity_scores input_refs UPDATE 차단',
  format($q$update public.opportunity_scores set input_refs = '{}' where id = '%s'$q$, pg_temp.jv('score_v1')), 'P0001');
select pg_temp.jv_expect_error('M09 opportunity_scores keyword_id 다른 값으로 UPDATE 차단',
  format($q$update public.opportunity_scores set keyword_id = '%s' where id = '%s'$q$, pg_temp.jv('kw'), pg_temp.jv('score_v1')), 'P0001');

do $$
declare
  v_n integer;
begin
  update public.opportunity_scores set is_current = false where id = pg_temp.jv('score_v1');
  get diagnostics v_n = row_count;
  perform pg_temp.jv_assert('M10 opportunity_scores is_current UPDATE 허용', v_n = 1);
end;
$$;

select pg_temp.jv_expect_error('M11 predictions UPDATE 차단',
  $q$update public.predictions set sales_predicted = 999 where model_version = 'pred-v1-test'$q$, 'P0001');
select pg_temp.jv_expect_error('M12 predictions 참조 컬럼을 다른 값으로 UPDATE 차단',
  format($q$update public.predictions set opportunity_score_id = null, listing_id = '%s' where listing_id is null and model_version = 'pred-v1-test'$q$,
    pg_temp.jv('listing')),
  'P0001');

-- DELETE: 참조 없는 행은 삭제 가능, 참조되는 baseline 은 FK 가 막음, 참조 대상 삭제 시 SET NULL 은 통과
do $$
declare
  v_kw2 uuid;
  v_score uuid;
  v_n integer;
begin
  delete from public.predictions where model_version = 'pred-v1-test' and target_period_start = '2026-11-01';
  get diagnostics v_n = row_count;
  perform pg_temp.jv_assert('M13 prediction DELETE 허용', v_n = 1);

  delete from public.opportunity_scores where product_id = pg_temp.jv('p1') and scoring_version = 'v2-test';
  get diagnostics v_n = row_count;
  perform pg_temp.jv_assert('M14 참조 없는 opportunity_score DELETE 허용', v_n = 1);

  -- 키워드 삭제 → 점수 keyword_id SET NULL 은 트리거를 통과
  insert into public.keywords (keyword, normalized_keyword) values ('[TEST] 삭제용', '[test] 삭제용') returning id into v_kw2;
  insert into public.opportunity_scores (product_id, keyword_id, scoring_version, total_score, verdict, input_refs, is_current)
  values (pg_temp.jv('p1'), v_kw2, 'v1', 40, 'EXCLUDE', '{}', false) returning id into v_score;
  delete from public.keywords where id = v_kw2;
  perform pg_temp.jv_assert('M15 키워드 삭제 시 점수 keyword_id SET NULL 허용',
    (select keyword_id is null from public.opportunity_scores where id = v_score));

  -- 판매 건 삭제 → 예측 listing_id SET NULL 은 트리거를 통과
  delete from public.my_listings where id = pg_temp.jv('listing');
  perform pg_temp.jv_assert('M16 판매 건 삭제 시 예측 listing_id SET NULL 허용',
    (select count(*) from public.predictions where model_version = 'pred-v1-test' and listing_id is null) >= 1);
end;
$$;

select pg_temp.jv_expect_error('M17 baseline 점수는 여전히 DELETE 불가 (FK)',
  format($q$with l as (insert into public.my_listings (reference_product_id, listing_name, baseline_score_id) values ('%s', '[TEST] 기준 보존', '%s') returning baseline_score_id)
            delete from public.opportunity_scores where id = (select baseline_score_id from l)$q$,
    pg_temp.jv('p1'), pg_temp.jv('score_v1')),
  '23503');

-- scoring_versions 는 postgres(마이그레이션 권한)로도 정의를 못 바꾼다
reset role;
select pg_temp.jv_expect_error('M18 scoring_versions weights UPDATE 차단',
  $q$update public.scoring_versions set weights = jsonb_set(weights, '{margin}', '16') where version = 'v1'$q$, 'P0001');
select pg_temp.jv_expect_error('M19 scoring_versions thresholds UPDATE 차단',
  $q$update public.scoring_versions set thresholds = '{"strongBuy": 70, "review": 50}' where version = 'v1'$q$, 'P0001');
select pg_temp.jv_expect_error('M20 scoring_versions factor_definitions UPDATE 차단',
  $q$update public.scoring_versions set factor_definitions = '{}' where version = 'v1'$q$, 'P0001');
do $$
declare
  v_n integer;
begin
  update public.scoring_versions set description = description || ' ', retired_at = null where version = 'v1';
  get diagnostics v_n = row_count;
  perform pg_temp.jv_assert('M21 scoring_versions description / retired_at 변경은 허용', v_n = 1);

  insert into public.scoring_versions (version, weights, thresholds, description, is_active)
  values ('v3-test', '{"demand": 100}', '{"strongBuy": 80, "review": 60}', '[TEST]', false);
  perform pg_temp.jv_assert('M22 새 scoring version INSERT 가능',
    (select count(*) from public.scoring_versions where version in ('v1', 'v2-test', 'v3-test')) = 3
    and (select weights from public.scoring_versions where version = 'v1') ->> 'margin' = '15');
end;
$$;
set local role authenticated;

-- ===========================================================================
-- B. 사용자 B 로 RLS 검증 (A 의 데이터에 접근 불가)
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', current_setting('jv.user_b'), 'role', 'authenticated')::text, true);

do $$
declare
  t text;
  v_n bigint;
begin
  foreach t in array array[
    'categories', 'keywords', 'keyword_snapshots', 'products', 'product_snapshots',
    'keyword_product_ranks', 'competitors', 'profit_scenarios', 'profit_calculations',
    'opportunity_scores', 'product_risks', 'watchlist', 'watchlist_events',
    'my_listings', 'sales_results', 'predictions', 'import_jobs', 'import_rows',
    'v_product_latest', 'v_keyword_latest', 'v_current_scores', 'v_prediction_vs_actual'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then
      raise exception 'FAIL B01: B 가 % 에서 A 의 행 %개를 봄', t, v_n;
    end if;
  end loop;
  perform pg_temp.jv_pass('B01 SELECT 차단 (18개 테이블 + 4개 뷰)');

  update public.products set product_name = 'hacked';
  get diagnostics v_n = row_count;
  perform pg_temp.jv_assert('B02 UPDATE 차단 (0행)', v_n = 0);

  delete from public.products;
  get diagnostics v_n = row_count;
  delete from public.watchlist;
  perform pg_temp.jv_assert('B03 DELETE 차단 (0행)', v_n = 0);

  perform pg_temp.jv_assert('B04 scoring_versions SELECT 허용',
    (select count(*) from public.scoring_versions) >= 1);

  insert into public.products (coupang_product_id, product_name) values ('TEST-B-1', '[TEST] B 상품');
  perform pg_temp.jv_assert('B05 B 자신의 데이터는 정상 INSERT',
    (select owner_id from public.products where coupang_product_id = 'TEST-B-1') = pg_temp.jv('user_b'));
end;
$$;

select pg_temp.jv_expect_error('B06 INSERT 시 다른 owner_id 지정 차단',
  format($q$insert into public.products (owner_id, coupang_product_id, product_name) values ('%s', 'TEST-B-2', 'x')$q$, pg_temp.jv('user_a')),
  '42501');
select pg_temp.jv_expect_error('B07 UPDATE 로 owner_id 를 A 로 바꾸기 차단',
  format($q$update public.products set owner_id = '%s' where coupang_product_id = 'TEST-B-1'$q$, pg_temp.jv('user_a')),
  '42501');
select pg_temp.jv_expect_error('B08 복합 FK: B 의 스냅샷이 A 의 상품을 참조 불가',
  format($q$select public.upsert_product_snapshot('{"product_id": "%s", "captured_at": "2026-10-10T10:00:00+09:00", "source_type": "EXTENSION", "confidence": "B", "price": 1}')$q$, pg_temp.jv('p1')),
  '23503');
select pg_temp.jv_expect_error('B09 복합 FK: B 의 관심상품이 A 의 상품을 참조 불가',
  format($q$insert into public.watchlist (product_id) values ('%s')$q$, pg_temp.jv('p1')), '23503');
select pg_temp.jv_expect_error('B10 B 는 A 의 import 를 롤백할 수 없음 (not found)',
  format($q$select public.rollback_import('%s')$q$, pg_temp.jv('dup_job')), 'P0002');
select pg_temp.jv_expect_error('B11 scoring_versions 쓰기 차단',
  $q$update public.scoring_versions set weights = '{}'$q$, '42501');

-- A 의 데이터가 그대로인지 (postgres 로 확인)
reset role;
do $$
begin
  perform pg_temp.jv_assert('B12 B 의 시도 후 A 데이터 보존',
    (select count(*) from public.products where owner_id = pg_temp.jv('user_a') and product_name = 'hacked') = 0
    and (select count(*) from public.products where owner_id = pg_temp.jv('user_a')) >= 3
    and (select count(*) from public.watchlist where owner_id = pg_temp.jv('user_a')) = 2);
end;
$$;

-- ===========================================================================
-- N. anon 차단
-- ===========================================================================
set local role anon;
select pg_temp.jv_expect_error('N01 anon products SELECT 거부', $q$select count(*) from public.products$q$, '42501');
select pg_temp.jv_expect_error('N02 anon 뷰 SELECT 거부', $q$select count(*) from public.v_product_latest$q$, '42501');
select pg_temp.jv_expect_error('N03 anon scoring_versions SELECT 거부', $q$select count(*) from public.scoring_versions$q$, '42501');
select pg_temp.jv_expect_error('N04 anon RPC 실행 거부', $q$select public.rollback_import(gen_random_uuid())$q$, '42501');
select pg_temp.jv_expect_error('N05 anon INSERT 거부',
  $q$insert into public.import_jobs (channel, import_type, source_type) values ('API', 'MIXED', 'MANUAL')$q$, '42501');
reset role;

-- ===========================================================================
-- 결과
-- ===========================================================================
select
  (select count(*) from regexp_split_to_table(trim(trailing E'\n' from current_setting('jv.passed')), E'\n')) as passed,
  current_setting('jv.passed') as passed_checks;

rollback;
