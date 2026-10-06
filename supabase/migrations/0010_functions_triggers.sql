-- JARVIS PHASE 2 · 0010 함수 / 트리거
--   set_updated_at()            updated_at 자동 갱신
--   log_watchlist_status()      watchlist 상태 변경 → watchlist_events, status_changed_at
--   upsert_product_snapshot()   스냅샷 UPSERT (NULL 은 기존 값 유지)          (사전 점검 B-2)
--   upsert_keyword_snapshot()   〃
--   rollback_import()           import 롤백 (충돌 시 전체 중단 + 충돌 목록)   (사전 점검 B-3)
--
-- 모든 함수는 SECURITY INVOKER (기본값) + search_path = '' → RLS 가 그대로 적용되고 이름 탈취를 막는다.

-- set_updated_at --------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.keywords
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.competitors
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profit_scenarios
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.watchlist
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.my_listings
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sales_results
  for each row execute function public.set_updated_at();

-- log_watchlist_status --------------------------------------------------------
-- BEFORE UPDATE : 상태가 바뀌면 status_changed_at = now()
-- AFTER INSERT  : 최초 등록 이벤트 (from_status = NULL)
-- AFTER UPDATE  : 상태가 바뀐 경우에만 이벤트 기록
-- 메모는 같은 트랜잭션에서 set_config('jarvis.watchlist_note', '메모', true) 로 넘기면 note 에 들어간다.
create function public.log_watchlist_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_note text := nullif(current_setting('jarvis.watchlist_note', true), '');
begin
  if tg_when = 'BEFORE' then
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.watchlist_events (owner_id, watchlist_id, from_status, to_status, note, changed_at)
    values (new.owner_id, new.id, null, new.status, v_note, new.status_changed_at);
  elsif new.status is distinct from old.status then
    insert into public.watchlist_events (owner_id, watchlist_id, from_status, to_status, note, changed_at)
    values (new.owner_id, new.id, old.status, new.status, v_note, new.status_changed_at);
  end if;
  return null;
end;
$$;

create trigger log_watchlist_status_before before update of status on public.watchlist
  for each row execute function public.log_watchlist_status();
create trigger log_watchlist_status_after after insert or update of status on public.watchlist
  for each row execute function public.log_watchlist_status();

-- upsert_product_snapshot(jsonb) -------------------------------------------------------
-- 상품 스냅샷 1건을 (product_id, captured_on, source_type) 기준으로 UPSERT 한다. (사전 점검 B-2)
--  * 새 값이 NULL 이면 기존 non-null 값을 유지하고, non-null 이면 새 값으로 갱신한다.
--  * captured_on 이 없으면 captured_at 의 Asia/Seoul 날짜로 채운다.
--  * captured_at 은 더 최신 시각으로, confidence 는 새 값으로, metric_meta 는 키 단위 병합.
--  * import_job_id 는 "마지막으로 쓴 import" (수동 갱신이면 NULL) → rollback_import 충돌 검사에 쓴다.
--  * is_excluded / excluded_reason 은 payload 에 키가 있을 때만 바꾼다 (재수집이 수동 제외를 풀지 않도록).
--  * 정의되지 않은 키가 있으면 오류 (오타로 값이 조용히 버려지는 것 방지).
--  * 반환: {"action": "INSERTED" | "UPDATED" | "SKIPPED", "row": 결과 행, "previous": 변경 전 행}
--    → import_rows.result / previous_values 에 그대로 기록한다.
--  * SECURITY INVOKER: 호출자의 RLS 가 그대로 적용된다.
create function public.upsert_product_snapshot(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed constant text[] := array[
    'owner_id',
    'product_id',
    'captured_on',
    'captured_at',
    'source_type',
    'confidence',
    'product_name_observed',
    'price',
    'original_price',
    'discount_rate',
    'delivery_type',
    'seller_type_observed',
    'review_count',
    'rating',
    'category_rank',
    'option_count',
    'views_28d',
    'sales_period_days',
    'sales_actual',
    'sales_estimated',
    'revenue_actual',
    'revenue_estimated',
    'conversion_rate',
    'metric_meta',
    'import_job_id',
    'is_excluded',
    'excluded_reason'
  ];
  v_unknown text[];
  r public.product_snapshots;
  v_prev public.product_snapshots;
  v_row public.product_snapshots;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'upsert_product_snapshot: payload must be a JSON object' using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_unknown
  from jsonb_object_keys(p) as k
  where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'upsert_product_snapshot: unknown keys %', v_unknown using errcode = '22023';
  end if;

  r := jsonb_populate_record(null::public.product_snapshots, p);
  if r.product_id is null or r.source_type is null or r.confidence is null or r.captured_at is null then
    raise exception 'upsert_product_snapshot: product_id, source_type, confidence, captured_at are required' using errcode = '23502';
  end if;
  r.captured_on := coalesce(r.captured_on, (r.captured_at at time zone 'Asia/Seoul')::date);
  r.owner_id := coalesce(r.owner_id, auth.uid());

  select * into v_prev
  from public.product_snapshots s
  where s.product_id = r.product_id and s.captured_on = r.captured_on and s.source_type = r.source_type
  for update;

  if not found then
    insert into public.product_snapshots (
      owner_id,
      product_id,
      captured_on,
      captured_at,
      source_type,
      confidence,
      product_name_observed,
      price,
      original_price,
      discount_rate,
      delivery_type,
      seller_type_observed,
      review_count,
      rating,
      category_rank,
      option_count,
      views_28d,
      sales_period_days,
      sales_actual,
      sales_estimated,
      revenue_actual,
      revenue_estimated,
      conversion_rate,
      metric_meta,
      import_job_id,
      is_excluded,
      excluded_reason
    ) values (
      r.owner_id,
      r.product_id,
      r.captured_on,
      r.captured_at,
      r.source_type,
      r.confidence,
      r.product_name_observed,
      r.price,
      r.original_price,
      r.discount_rate,
      r.delivery_type,
      r.seller_type_observed,
      r.review_count,
      r.rating,
      r.category_rank,
      r.option_count,
      r.views_28d,
      r.sales_period_days,
      r.sales_actual,
      r.sales_estimated,
      r.revenue_actual,
      r.revenue_estimated,
      r.conversion_rate,
      coalesce(r.metric_meta, '{}'::jsonb),
      r.import_job_id,
      coalesce(r.is_excluded, false),
      r.excluded_reason
    )
    on conflict (product_id, captured_on, source_type) do nothing
    returning * into v_row;

    if v_row.id is not null then
      return jsonb_build_object('action', 'INSERTED', 'row', to_jsonb(v_row), 'previous', null);
    end if;

    -- 동시에 다른 트랜잭션이 먼저 넣은 경우: 다시 읽어서 갱신 경로로
    select * into v_prev
    from public.product_snapshots s
    where s.product_id = r.product_id and s.captured_on = r.captured_on and s.source_type = r.source_type
    for update;
  end if;

  update public.product_snapshots s set
    captured_at = greatest(s.captured_at, r.captured_at),
    confidence = r.confidence,
    product_name_observed = coalesce(r.product_name_observed, s.product_name_observed),
    price = coalesce(r.price, s.price),
    original_price = coalesce(r.original_price, s.original_price),
    discount_rate = coalesce(r.discount_rate, s.discount_rate),
    delivery_type = coalesce(r.delivery_type, s.delivery_type),
    seller_type_observed = coalesce(r.seller_type_observed, s.seller_type_observed),
    review_count = coalesce(r.review_count, s.review_count),
    rating = coalesce(r.rating, s.rating),
    category_rank = coalesce(r.category_rank, s.category_rank),
    option_count = coalesce(r.option_count, s.option_count),
    views_28d = coalesce(r.views_28d, s.views_28d),
    sales_period_days = coalesce(r.sales_period_days, s.sales_period_days),
    sales_actual = coalesce(r.sales_actual, s.sales_actual),
    sales_estimated = coalesce(r.sales_estimated, s.sales_estimated),
    revenue_actual = coalesce(r.revenue_actual, s.revenue_actual),
    revenue_estimated = coalesce(r.revenue_estimated, s.revenue_estimated),
    conversion_rate = coalesce(r.conversion_rate, s.conversion_rate),
    metric_meta = s.metric_meta || coalesce(r.metric_meta, '{}'::jsonb),
    import_job_id = r.import_job_id,
    is_excluded = case when p ? 'is_excluded' then coalesce(r.is_excluded, false) else s.is_excluded end,
    excluded_reason = case when p ? 'excluded_reason' then r.excluded_reason else s.excluded_reason end
  where s.id = v_prev.id
    and (
      r.confidence is distinct from s.confidence
      or coalesce(r.product_name_observed, s.product_name_observed) is distinct from s.product_name_observed
      or coalesce(r.price, s.price) is distinct from s.price
      or coalesce(r.original_price, s.original_price) is distinct from s.original_price
      or coalesce(r.discount_rate, s.discount_rate) is distinct from s.discount_rate
      or coalesce(r.delivery_type, s.delivery_type) is distinct from s.delivery_type
      or coalesce(r.seller_type_observed, s.seller_type_observed) is distinct from s.seller_type_observed
      or coalesce(r.review_count, s.review_count) is distinct from s.review_count
      or coalesce(r.rating, s.rating) is distinct from s.rating
      or coalesce(r.category_rank, s.category_rank) is distinct from s.category_rank
      or coalesce(r.option_count, s.option_count) is distinct from s.option_count
      or coalesce(r.views_28d, s.views_28d) is distinct from s.views_28d
      or coalesce(r.sales_period_days, s.sales_period_days) is distinct from s.sales_period_days
      or coalesce(r.sales_actual, s.sales_actual) is distinct from s.sales_actual
      or coalesce(r.sales_estimated, s.sales_estimated) is distinct from s.sales_estimated
      or coalesce(r.revenue_actual, s.revenue_actual) is distinct from s.revenue_actual
      or coalesce(r.revenue_estimated, s.revenue_estimated) is distinct from s.revenue_estimated
      or coalesce(r.conversion_rate, s.conversion_rate) is distinct from s.conversion_rate
      or (s.metric_meta || coalesce(r.metric_meta, '{}'::jsonb)) is distinct from s.metric_meta
      or r.import_job_id is distinct from s.import_job_id
      or (p ? 'is_excluded' and coalesce(r.is_excluded, false) is distinct from s.is_excluded)
      or (p ? 'excluded_reason' and r.excluded_reason is distinct from s.excluded_reason)
    )
  returning * into v_row;

  if not found then
    return jsonb_build_object('action', 'SKIPPED', 'row', to_jsonb(v_prev), 'previous', to_jsonb(v_prev));
  end if;

  return jsonb_build_object('action', 'UPDATED', 'row', to_jsonb(v_row), 'previous', to_jsonb(v_prev));
end;
$$;

-- upsert_keyword_snapshot(jsonb) -------------------------------------------------------
-- 키워드 스냅샷 1건을 (keyword_id, captured_on, source_type) 기준으로 UPSERT 한다. (사전 점검 B-2)
--  * 새 값이 NULL 이면 기존 non-null 값을 유지하고, non-null 이면 새 값으로 갱신한다.
--  * captured_on 이 없으면 captured_at 의 Asia/Seoul 날짜로 채운다.
--  * captured_at 은 더 최신 시각으로, confidence 는 새 값으로, metric_meta 는 키 단위 병합.
--  * import_job_id 는 "마지막으로 쓴 import" (수동 갱신이면 NULL) → rollback_import 충돌 검사에 쓴다.
--  * is_excluded / excluded_reason 은 payload 에 키가 있을 때만 바꾼다 (재수집이 수동 제외를 풀지 않도록).
--  * 정의되지 않은 키가 있으면 오류 (오타로 값이 조용히 버려지는 것 방지).
--  * 반환: {"action": "INSERTED" | "UPDATED" | "SKIPPED", "row": 결과 행, "previous": 변경 전 행}
--    → import_rows.result / previous_values 에 그대로 기록한다.
--  * SECURITY INVOKER: 호출자의 RLS 가 그대로 적용된다.
create function public.upsert_keyword_snapshot(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed constant text[] := array[
    'owner_id',
    'keyword_id',
    'captured_on',
    'captured_at',
    'source_type',
    'confidence',
    'search_volume',
    'search_volume_previous',
    'search_growth_rate',
    'coupang_product_count',
    'competition_intensity',
    'wing_ratio',
    'rocket_ratio',
    'average_price',
    'average_reviews',
    'brand_concentration',
    'sample_size',
    'ad_bid',
    'metric_meta',
    'import_job_id',
    'is_excluded',
    'excluded_reason'
  ];
  v_unknown text[];
  r public.keyword_snapshots;
  v_prev public.keyword_snapshots;
  v_row public.keyword_snapshots;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'upsert_keyword_snapshot: payload must be a JSON object' using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_unknown
  from jsonb_object_keys(p) as k
  where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'upsert_keyword_snapshot: unknown keys %', v_unknown using errcode = '22023';
  end if;

  r := jsonb_populate_record(null::public.keyword_snapshots, p);
  if r.keyword_id is null or r.source_type is null or r.confidence is null or r.captured_at is null then
    raise exception 'upsert_keyword_snapshot: keyword_id, source_type, confidence, captured_at are required' using errcode = '23502';
  end if;
  r.captured_on := coalesce(r.captured_on, (r.captured_at at time zone 'Asia/Seoul')::date);
  r.owner_id := coalesce(r.owner_id, auth.uid());

  select * into v_prev
  from public.keyword_snapshots s
  where s.keyword_id = r.keyword_id and s.captured_on = r.captured_on and s.source_type = r.source_type
  for update;

  if not found then
    insert into public.keyword_snapshots (
      owner_id,
      keyword_id,
      captured_on,
      captured_at,
      source_type,
      confidence,
      search_volume,
      search_volume_previous,
      search_growth_rate,
      coupang_product_count,
      competition_intensity,
      wing_ratio,
      rocket_ratio,
      average_price,
      average_reviews,
      brand_concentration,
      sample_size,
      ad_bid,
      metric_meta,
      import_job_id,
      is_excluded,
      excluded_reason
    ) values (
      r.owner_id,
      r.keyword_id,
      r.captured_on,
      r.captured_at,
      r.source_type,
      r.confidence,
      r.search_volume,
      r.search_volume_previous,
      r.search_growth_rate,
      r.coupang_product_count,
      r.competition_intensity,
      r.wing_ratio,
      r.rocket_ratio,
      r.average_price,
      r.average_reviews,
      r.brand_concentration,
      r.sample_size,
      r.ad_bid,
      coalesce(r.metric_meta, '{}'::jsonb),
      r.import_job_id,
      coalesce(r.is_excluded, false),
      r.excluded_reason
    )
    on conflict (keyword_id, captured_on, source_type) do nothing
    returning * into v_row;

    if v_row.id is not null then
      return jsonb_build_object('action', 'INSERTED', 'row', to_jsonb(v_row), 'previous', null);
    end if;

    -- 동시에 다른 트랜잭션이 먼저 넣은 경우: 다시 읽어서 갱신 경로로
    select * into v_prev
    from public.keyword_snapshots s
    where s.keyword_id = r.keyword_id and s.captured_on = r.captured_on and s.source_type = r.source_type
    for update;
  end if;

  update public.keyword_snapshots s set
    captured_at = greatest(s.captured_at, r.captured_at),
    confidence = r.confidence,
    search_volume = coalesce(r.search_volume, s.search_volume),
    search_volume_previous = coalesce(r.search_volume_previous, s.search_volume_previous),
    search_growth_rate = coalesce(r.search_growth_rate, s.search_growth_rate),
    coupang_product_count = coalesce(r.coupang_product_count, s.coupang_product_count),
    competition_intensity = coalesce(r.competition_intensity, s.competition_intensity),
    wing_ratio = coalesce(r.wing_ratio, s.wing_ratio),
    rocket_ratio = coalesce(r.rocket_ratio, s.rocket_ratio),
    average_price = coalesce(r.average_price, s.average_price),
    average_reviews = coalesce(r.average_reviews, s.average_reviews),
    brand_concentration = coalesce(r.brand_concentration, s.brand_concentration),
    sample_size = coalesce(r.sample_size, s.sample_size),
    ad_bid = coalesce(r.ad_bid, s.ad_bid),
    metric_meta = s.metric_meta || coalesce(r.metric_meta, '{}'::jsonb),
    import_job_id = r.import_job_id,
    is_excluded = case when p ? 'is_excluded' then coalesce(r.is_excluded, false) else s.is_excluded end,
    excluded_reason = case when p ? 'excluded_reason' then r.excluded_reason else s.excluded_reason end
  where s.id = v_prev.id
    and (
      r.confidence is distinct from s.confidence
      or coalesce(r.search_volume, s.search_volume) is distinct from s.search_volume
      or coalesce(r.search_volume_previous, s.search_volume_previous) is distinct from s.search_volume_previous
      or coalesce(r.search_growth_rate, s.search_growth_rate) is distinct from s.search_growth_rate
      or coalesce(r.coupang_product_count, s.coupang_product_count) is distinct from s.coupang_product_count
      or coalesce(r.competition_intensity, s.competition_intensity) is distinct from s.competition_intensity
      or coalesce(r.wing_ratio, s.wing_ratio) is distinct from s.wing_ratio
      or coalesce(r.rocket_ratio, s.rocket_ratio) is distinct from s.rocket_ratio
      or coalesce(r.average_price, s.average_price) is distinct from s.average_price
      or coalesce(r.average_reviews, s.average_reviews) is distinct from s.average_reviews
      or coalesce(r.brand_concentration, s.brand_concentration) is distinct from s.brand_concentration
      or coalesce(r.sample_size, s.sample_size) is distinct from s.sample_size
      or coalesce(r.ad_bid, s.ad_bid) is distinct from s.ad_bid
      or (s.metric_meta || coalesce(r.metric_meta, '{}'::jsonb)) is distinct from s.metric_meta
      or r.import_job_id is distinct from s.import_job_id
      or (p ? 'is_excluded' and coalesce(r.is_excluded, false) is distinct from s.is_excluded)
      or (p ? 'excluded_reason' and r.excluded_reason is distinct from s.excluded_reason)
    )
  returning * into v_row;

  if not found then
    return jsonb_build_object('action', 'SKIPPED', 'row', to_jsonb(v_prev), 'previous', to_jsonb(v_prev));
  end if;

  return jsonb_build_object('action', 'UPDATED', 'row', to_jsonb(v_row), 'previous', to_jsonb(v_prev));
end;
$$;

-- rollback_import(job_id) -----------------------------------------------------
-- import 1건을 되돌린다. (사전 점검 B-3)
--  1) 충돌 검사 (하나라도 있으면 아무것도 바꾸지 않고 {"ok": false, "conflicts": [...]} 반환)
--     UNSUPPORTED_TARGET      target_table/target_id 가 없거나 롤백 대상 테이블이 아님
--     MISSING_PREVIOUS_VALUES UPDATED 인데 previous_values 가 없음
--     TARGET_MISSING          UPDATED 대상 행이 이미 없음 (복원 불가)
--     LATER_IMPORT            롤백되지 않은 다른 import 가 이후에 같은 행을 INSERT/UPDATE 함
--     MODIFIED_AFTER_IMPORT   import 이후 다른 경로로 수정됨 (import_job_id 가 다르거나 updated_at > finished_at)
--     REFERENCED              이 import 가 만든 행을, 이 import 가 만들지 않은 행이 참조함 (삭제 시 CASCADE 피해)
--  2) 충돌이 없으면: UPDATED 행을 previous_values 로 복원 → INSERTED 행을 하위 테이블부터 삭제
--     → import_jobs.status = 'ROLLED_BACK'.  SKIPPED / FAILED 행은 건드리지 않는다.
--  부분 롤백은 하지 않는다.
create function public.rollback_import(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- 롤백 가능한 대상 테이블. 배열 순서 = 삭제 순서 (하위 → 상위)
  v_tables constant text[] := array[
    'keyword_product_ranks',
    'product_snapshots',
    'keyword_snapshots',
    'competitors',
    'sales_results',
    'profit_scenarios',
    'products',
    'keywords',
    'categories'
  ];
  v_job public.import_jobs;
  v_row public.import_rows;
  v_fk record;
  v_conflicts jsonb := '[]'::jsonb;
  v_exists boolean;
  v_flag boolean;
  v_count bigint;
  v_other uuid;
  v_cols text;
  v_select text;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_restored integer := 0;
begin
  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'rollback_import: import job % not found', p_job_id using errcode = 'P0002';
  end if;
  if v_job.status = 'ROLLED_BACK' then
    raise exception 'rollback_import: import job % is already rolled back', p_job_id using errcode = '55000';
  end if;
  if v_job.status not in ('SUCCEEDED', 'PARTIAL', 'FAILED') or v_job.finished_at is null then
    raise exception 'rollback_import: import job % is not finished (status %)', p_job_id, v_job.status
      using errcode = '55000';
  end if;

  -- 1) 충돌 검사 ---------------------------------------------------------------
  for v_row in
    select * from public.import_rows
    where import_job_id = p_job_id and result in ('INSERTED', 'UPDATED')
    order by id
  loop
    if v_row.target_table is null or v_row.target_id is null
       or not (v_row.target_table = any (v_tables)) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'UNSUPPORTED_TARGET', 'row_number', v_row.row_number,
        'target_table', v_row.target_table, 'target_id', v_row.target_id);
      continue;
    end if;

    execute format('select exists (select 1 from public.%I where id::text = $1)', v_row.target_table)
      into v_exists using v_row.target_id;

    if v_row.result = 'UPDATED' then
      if v_row.previous_values is null then
        v_conflicts := v_conflicts || jsonb_build_object(
          'code', 'MISSING_PREVIOUS_VALUES', 'row_number', v_row.row_number,
          'target_table', v_row.target_table, 'target_id', v_row.target_id);
      end if;
      if not v_exists then
        v_conflicts := v_conflicts || jsonb_build_object(
          'code', 'TARGET_MISSING', 'row_number', v_row.row_number,
          'target_table', v_row.target_table, 'target_id', v_row.target_id);
        continue;
      end if;
    elsif not v_exists then
      continue; -- 이 import 가 만든 행이 이미 없다: 할 일 없음
    end if;

    -- 다른 import 가 이후에 같은 행을 건드림
    v_other := null;
    select o.import_job_id into v_other
    from public.import_rows o
    join public.import_jobs oj on oj.id = o.import_job_id
    where o.target_table = v_row.target_table
      and o.target_id = v_row.target_id
      and o.import_job_id <> p_job_id
      and o.result in ('INSERTED', 'UPDATED')
      and oj.status <> 'ROLLED_BACK'
      and o.id > v_row.id
    limit 1;
    if v_other is not null then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'LATER_IMPORT', 'row_number', v_row.row_number,
        'target_table', v_row.target_table, 'target_id', v_row.target_id,
        'other_import_job_id', v_other);
    end if;

    -- import 이후 다른 경로로 수정됨
    v_flag := false;
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = format('public.%I', v_row.target_table)::regclass
        and a.attname = 'import_job_id' and not a.attisdropped
    ) then
      execute format(
        'select exists (select 1 from public.%I where id::text = $1 and import_job_id is distinct from $2)',
        v_row.target_table)
        into v_flag using v_row.target_id, p_job_id;
    end if;
    if not v_flag and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = format('public.%I', v_row.target_table)::regclass
        and a.attname = 'updated_at' and not a.attisdropped
    ) then
      execute format(
        'select exists (select 1 from public.%I where id::text = $1 and updated_at > $2)',
        v_row.target_table)
        into v_flag using v_row.target_id, v_job.finished_at;
    end if;
    if v_flag then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'MODIFIED_AFTER_IMPORT', 'row_number', v_row.row_number,
        'target_table', v_row.target_table, 'target_id', v_row.target_id);
    end if;

    -- 이 import 가 만든 행을 다른 데이터가 참조함
    if v_row.result = 'INSERTED' then
      for v_fk in
        select cl.relname as child_table, att.attname as child_column
        from pg_catalog.pg_constraint c
        cross join lateral unnest(c.conkey, c.confkey) as k (child_attnum, parent_attnum)
        join pg_catalog.pg_attribute pa
          on pa.attrelid = c.confrelid and pa.attnum = k.parent_attnum and pa.attname = 'id'
        join pg_catalog.pg_attribute att
          on att.attrelid = c.conrelid and att.attnum = k.child_attnum
        join pg_catalog.pg_class cl on cl.oid = c.conrelid
        join pg_catalog.pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
        where c.contype = 'f'
          and c.confrelid = format('public.%I', v_row.target_table)::regclass
      loop
        execute format(
          'select count(*) from public.%I t
           where t.%I::text = $1
             and not exists (
               select 1 from public.import_rows ir
               where ir.import_job_id = $2 and ir.result = %L
                 and ir.target_table = %L and ir.target_id = t.id::text)',
          v_fk.child_table, v_fk.child_column, 'INSERTED', v_fk.child_table)
          into v_count using v_row.target_id, p_job_id;
        if v_count > 0 then
          v_conflicts := v_conflicts || jsonb_build_object(
            'code', 'REFERENCED', 'row_number', v_row.row_number,
            'target_table', v_row.target_table, 'target_id', v_row.target_id,
            'referenced_by', v_fk.child_table, 'column', v_fk.child_column, 'count', v_count);
        end if;
      end loop;
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'import_job_id', p_job_id, 'conflicts', v_conflicts);
  end if;

  -- 2-a) UPDATED 복원 (나중에 쓴 것부터) --------------------------------------
  for v_row in
    select * from public.import_rows
    where import_job_id = p_job_id and result = 'UPDATED'
    order by id desc
  loop
    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(format('x.%I', a.attname), ', ' order by a.attnum)
    into v_cols, v_select
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', v_row.target_table)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attidentity = ''
      and a.attname not in ('id', 'owner_id')
      and v_row.previous_values ? a.attname;

    if v_cols is not null then
      execute format(
        'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) x) where t.id::text = $2',
        v_row.target_table, v_cols, v_select, v_row.target_table)
        using v_row.previous_values, v_row.target_id;
      get diagnostics v_n = row_count;
      v_restored := v_restored + v_n;
    end if;
  end loop;

  -- 2-b) INSERTED 삭제 (하위 → 상위) -------------------------------------------
  foreach v_table in array v_tables loop
    execute format(
      'delete from public.%I t
       where exists (
         select 1 from public.import_rows ir
         where ir.import_job_id = $1 and ir.result = %L
           and ir.target_table = %L and ir.target_id = t.id::text)',
      v_table, 'INSERTED', v_table)
      using p_job_id;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  update public.import_jobs set status = 'ROLLED_BACK' where id = p_job_id;

  return jsonb_build_object(
    'ok', true, 'import_job_id', p_job_id,
    'restored_rows', v_restored, 'deleted_rows', v_deleted);
end;
$$;
