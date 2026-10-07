-- JARVIS PHASE 5 마무리 · upsert_*_snapshot() 교차 사용자 처리 수정
--
-- 문제: 다른 사용자의 기존 (대상, 수집일, 출처) 행을 대상으로 호출하면
--   INSERT … ON CONFLICT DO NOTHING 이 복합 FK 검사보다 먼저 걸리고, RLS 때문에 재조회도 비어
--   오류 없이 빈 행 + SKIPPED 를 반환했다 (데이터 변경은 없었음).
-- 수정: 그 경우에만 SQLSTATE 42501(insufficient_privilege) 예외를 던진다.
--   그 밖의 동작(NULL 보존, 같은 날짜·출처 UPSERT, SKIPPED 판정, 반환 형식, SECURITY INVOKER, search_path)은 그대로다.
--   CREATE OR REPLACE 이므로 기존 GRANT(authenticated, service_role / anon·public 회수)는 유지된다.

create or replace function public.upsert_product_snapshot(p jsonb)
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

    -- 충돌한 행이 보이지 않는다 = RLS 로 가려진 다른 사용자의 행. 빈 SKIPPED 대신 권한 오류로 끝낸다
    if not found then
      raise exception 'upsert_product_snapshot: 대상 행에 접근할 수 없습니다 (다른 사용자의 데이터) — product_id=%, captured_on=%, source_type=%',
        r.product_id, r.captured_on, r.source_type
        using errcode = '42501';
    end if;
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

create or replace function public.upsert_keyword_snapshot(p jsonb)
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

    -- 충돌한 행이 보이지 않는다 = RLS 로 가려진 다른 사용자의 행. 빈 SKIPPED 대신 권한 오류로 끝낸다
    if not found then
      raise exception 'upsert_keyword_snapshot: 대상 행에 접근할 수 없습니다 (다른 사용자의 데이터) — keyword_id=%, captured_on=%, source_type=%',
        r.keyword_id, r.captured_on, r.source_type
        using errcode = '42501';
    end if;
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
