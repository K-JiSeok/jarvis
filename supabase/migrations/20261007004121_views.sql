-- JARVIS PHASE 2 · 0009 뷰: v_product_latest, v_keyword_latest, v_current_scores, v_prediction_vs_actual
--
-- 모든 뷰는 security_invoker = true → 조회하는 사용자의 RLS 가 그대로 적용된다.
--
-- "현재 값" 규칙 (설계 Part A 10-4): is_excluded = false 인 스냅샷 중 항목별로
--   ① 최신 captured_on → ② confidence A > B > C → ③ 출처 우선순위
--   (MANUAL > WING_SESSION > OFFICIAL_API > COUPANG_PAGE > EXTENSION > CALCULATED > ESTIMATED)
--   → 동률이면 captured_at, id 최신
-- 항목별 source/confidence 는 metric_meta 덮어쓰기를 먼저 본다.
-- 값이 NULL(모름)인 스냅샷은 그 항목의 후보에서 빠진다. 그래서 항목마다 다른 날짜의 값이 올 수 있고,
-- 각 값의 _source / _confidence / _captured_on 을 함께 반환한다.
-- 판매량·매출은 집계 기간(_period_days)도 같은 스냅샷에서 가져온다.

-- 우선순위 헬퍼 -----------------------------------------------------------------
create function public.source_priority(src text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case src
    when 'MANUAL' then 1
    when 'WING_SESSION' then 2
    when 'OFFICIAL_API' then 3
    when 'COUPANG_PAGE' then 4
    when 'EXTENSION' then 5
    when 'CALCULATED' then 6
    when 'ESTIMATED' then 7
    else 99
  end
$$;

create function public.confidence_rank(conf text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case conf when 'A' then 1 when 'B' then 2 when 'C' then 3 else 99 end
$$;

-- v_product_latest ------------------------------------------------------------
create view public.v_product_latest
with (security_invoker = true)
as
select
  p.id as product_id,
  p.owner_id,
  p.coupang_product_id,
  p.product_name,
  p.brand,
  p.category_id,
  p.seller_type,
  p.is_coupang_pb,
  p.is_own_product,
  p.lifecycle_status,
  p.last_seen_at,
  m.snapshot_count,
  m.latest_captured_on,
  (m.product_name_observed_pick ->> 'v')::text as product_name_observed,
  m.product_name_observed_pick ->> 's' as product_name_observed_source,
  m.product_name_observed_pick ->> 'c' as product_name_observed_confidence,
  (m.product_name_observed_pick ->> 'd')::date as product_name_observed_captured_on,
  (m.price_pick ->> 'v')::bigint as price,
  m.price_pick ->> 's' as price_source,
  m.price_pick ->> 'c' as price_confidence,
  (m.price_pick ->> 'd')::date as price_captured_on,
  (m.original_price_pick ->> 'v')::bigint as original_price,
  m.original_price_pick ->> 's' as original_price_source,
  m.original_price_pick ->> 'c' as original_price_confidence,
  (m.original_price_pick ->> 'd')::date as original_price_captured_on,
  (m.discount_rate_pick ->> 'v')::numeric as discount_rate,
  m.discount_rate_pick ->> 's' as discount_rate_source,
  m.discount_rate_pick ->> 'c' as discount_rate_confidence,
  (m.discount_rate_pick ->> 'd')::date as discount_rate_captured_on,
  (m.delivery_type_pick ->> 'v')::text as delivery_type,
  m.delivery_type_pick ->> 's' as delivery_type_source,
  m.delivery_type_pick ->> 'c' as delivery_type_confidence,
  (m.delivery_type_pick ->> 'd')::date as delivery_type_captured_on,
  (m.seller_type_observed_pick ->> 'v')::text as seller_type_observed,
  m.seller_type_observed_pick ->> 's' as seller_type_observed_source,
  m.seller_type_observed_pick ->> 'c' as seller_type_observed_confidence,
  (m.seller_type_observed_pick ->> 'd')::date as seller_type_observed_captured_on,
  (m.review_count_pick ->> 'v')::integer as review_count,
  m.review_count_pick ->> 's' as review_count_source,
  m.review_count_pick ->> 'c' as review_count_confidence,
  (m.review_count_pick ->> 'd')::date as review_count_captured_on,
  (m.rating_pick ->> 'v')::numeric as rating,
  m.rating_pick ->> 's' as rating_source,
  m.rating_pick ->> 'c' as rating_confidence,
  (m.rating_pick ->> 'd')::date as rating_captured_on,
  (m.category_rank_pick ->> 'v')::integer as category_rank,
  m.category_rank_pick ->> 's' as category_rank_source,
  m.category_rank_pick ->> 'c' as category_rank_confidence,
  (m.category_rank_pick ->> 'd')::date as category_rank_captured_on,
  (m.option_count_pick ->> 'v')::smallint as option_count,
  m.option_count_pick ->> 's' as option_count_source,
  m.option_count_pick ->> 'c' as option_count_confidence,
  (m.option_count_pick ->> 'd')::date as option_count_captured_on,
  (m.views_28d_pick ->> 'v')::integer as views_28d,
  m.views_28d_pick ->> 's' as views_28d_source,
  m.views_28d_pick ->> 'c' as views_28d_confidence,
  (m.views_28d_pick ->> 'd')::date as views_28d_captured_on,
  (m.sales_actual_pick ->> 'v')::integer as sales_actual,
  m.sales_actual_pick ->> 's' as sales_actual_source,
  m.sales_actual_pick ->> 'c' as sales_actual_confidence,
  (m.sales_actual_pick ->> 'd')::date as sales_actual_captured_on,
  (m.sales_actual_pick ->> 'p')::smallint as sales_actual_period_days,
  (m.sales_estimated_pick ->> 'v')::integer as sales_estimated,
  m.sales_estimated_pick ->> 's' as sales_estimated_source,
  m.sales_estimated_pick ->> 'c' as sales_estimated_confidence,
  (m.sales_estimated_pick ->> 'd')::date as sales_estimated_captured_on,
  (m.sales_estimated_pick ->> 'p')::smallint as sales_estimated_period_days,
  (m.revenue_actual_pick ->> 'v')::bigint as revenue_actual,
  m.revenue_actual_pick ->> 's' as revenue_actual_source,
  m.revenue_actual_pick ->> 'c' as revenue_actual_confidence,
  (m.revenue_actual_pick ->> 'd')::date as revenue_actual_captured_on,
  (m.revenue_actual_pick ->> 'p')::smallint as revenue_actual_period_days,
  (m.revenue_estimated_pick ->> 'v')::bigint as revenue_estimated,
  m.revenue_estimated_pick ->> 's' as revenue_estimated_source,
  m.revenue_estimated_pick ->> 'c' as revenue_estimated_confidence,
  (m.revenue_estimated_pick ->> 'd')::date as revenue_estimated_captured_on,
  (m.revenue_estimated_pick ->> 'p')::smallint as revenue_estimated_period_days,
  (m.conversion_rate_pick ->> 'v')::numeric as conversion_rate,
  m.conversion_rate_pick ->> 's' as conversion_rate_source,
  m.conversion_rate_pick ->> 'c' as conversion_rate_confidence,
  (m.conversion_rate_pick ->> 'd')::date as conversion_rate_captured_on
from public.products p
left join lateral (
  select
    count(*) as snapshot_count,
    max(s.captured_on) as latest_captured_on,
    (array_agg(
       jsonb_build_object(
         'v', s.product_name_observed,
         's', coalesce(s.metric_meta -> 'product_name_observed' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'product_name_observed' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'product_name_observed' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'product_name_observed' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.product_name_observed is not null))[1] as product_name_observed_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.price,
         's', coalesce(s.metric_meta -> 'price' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'price' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'price' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'price' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.price is not null))[1] as price_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.original_price,
         's', coalesce(s.metric_meta -> 'original_price' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'original_price' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'original_price' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'original_price' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.original_price is not null))[1] as original_price_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.discount_rate,
         's', coalesce(s.metric_meta -> 'discount_rate' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'discount_rate' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'discount_rate' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'discount_rate' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.discount_rate is not null))[1] as discount_rate_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.delivery_type,
         's', coalesce(s.metric_meta -> 'delivery_type' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'delivery_type' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'delivery_type' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'delivery_type' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.delivery_type is not null))[1] as delivery_type_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.seller_type_observed,
         's', coalesce(s.metric_meta -> 'seller_type_observed' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'seller_type_observed' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'seller_type_observed' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'seller_type_observed' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.seller_type_observed is not null))[1] as seller_type_observed_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.review_count,
         's', coalesce(s.metric_meta -> 'review_count' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'review_count' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'review_count' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'review_count' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.review_count is not null))[1] as review_count_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.rating,
         's', coalesce(s.metric_meta -> 'rating' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'rating' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'rating' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'rating' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.rating is not null))[1] as rating_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.category_rank,
         's', coalesce(s.metric_meta -> 'category_rank' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'category_rank' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'category_rank' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'category_rank' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.category_rank is not null))[1] as category_rank_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.option_count,
         's', coalesce(s.metric_meta -> 'option_count' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'option_count' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'option_count' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'option_count' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.option_count is not null))[1] as option_count_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.views_28d,
         's', coalesce(s.metric_meta -> 'views_28d' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'views_28d' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'views_28d' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'views_28d' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.views_28d is not null))[1] as views_28d_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.sales_actual,
         's', coalesce(s.metric_meta -> 'sales_actual' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'sales_actual' ->> 'confidence', s.confidence),
         'd', s.captured_on,
         'p', s.sales_period_days)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'sales_actual' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'sales_actual' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.sales_actual is not null))[1] as sales_actual_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.sales_estimated,
         's', coalesce(s.metric_meta -> 'sales_estimated' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'sales_estimated' ->> 'confidence', s.confidence),
         'd', s.captured_on,
         'p', s.sales_period_days)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'sales_estimated' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'sales_estimated' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.sales_estimated is not null))[1] as sales_estimated_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.revenue_actual,
         's', coalesce(s.metric_meta -> 'revenue_actual' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'revenue_actual' ->> 'confidence', s.confidence),
         'd', s.captured_on,
         'p', s.sales_period_days)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'revenue_actual' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'revenue_actual' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.revenue_actual is not null))[1] as revenue_actual_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.revenue_estimated,
         's', coalesce(s.metric_meta -> 'revenue_estimated' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'revenue_estimated' ->> 'confidence', s.confidence),
         'd', s.captured_on,
         'p', s.sales_period_days)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'revenue_estimated' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'revenue_estimated' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.revenue_estimated is not null))[1] as revenue_estimated_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.conversion_rate,
         's', coalesce(s.metric_meta -> 'conversion_rate' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'conversion_rate' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'conversion_rate' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'conversion_rate' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.conversion_rate is not null))[1] as conversion_rate_pick
  from public.product_snapshots s
  where s.product_id = p.id
    and not s.is_excluded
) m on true;

comment on view public.v_product_latest is '상품별 현재 값 (항목별 최우선 스냅샷 값 + 출처·신뢰도·수집일)';

-- v_keyword_latest ------------------------------------------------------------
create view public.v_keyword_latest
with (security_invoker = true)
as
select
  k.id as keyword_id,
  k.owner_id,
  k.keyword,
  k.normalized_keyword,
  k.category_id,
  k.is_tracking,
  m.snapshot_count,
  m.latest_captured_on,
  (m.search_volume_pick ->> 'v')::integer as search_volume,
  m.search_volume_pick ->> 's' as search_volume_source,
  m.search_volume_pick ->> 'c' as search_volume_confidence,
  (m.search_volume_pick ->> 'd')::date as search_volume_captured_on,
  (m.search_volume_previous_pick ->> 'v')::integer as search_volume_previous,
  m.search_volume_previous_pick ->> 's' as search_volume_previous_source,
  m.search_volume_previous_pick ->> 'c' as search_volume_previous_confidence,
  (m.search_volume_previous_pick ->> 'd')::date as search_volume_previous_captured_on,
  (m.search_growth_rate_pick ->> 'v')::numeric as search_growth_rate,
  m.search_growth_rate_pick ->> 's' as search_growth_rate_source,
  m.search_growth_rate_pick ->> 'c' as search_growth_rate_confidence,
  (m.search_growth_rate_pick ->> 'd')::date as search_growth_rate_captured_on,
  (m.coupang_product_count_pick ->> 'v')::integer as coupang_product_count,
  m.coupang_product_count_pick ->> 's' as coupang_product_count_source,
  m.coupang_product_count_pick ->> 'c' as coupang_product_count_confidence,
  (m.coupang_product_count_pick ->> 'd')::date as coupang_product_count_captured_on,
  (m.competition_intensity_pick ->> 'v')::numeric as competition_intensity,
  m.competition_intensity_pick ->> 's' as competition_intensity_source,
  m.competition_intensity_pick ->> 'c' as competition_intensity_confidence,
  (m.competition_intensity_pick ->> 'd')::date as competition_intensity_captured_on,
  (m.wing_ratio_pick ->> 'v')::numeric as wing_ratio,
  m.wing_ratio_pick ->> 's' as wing_ratio_source,
  m.wing_ratio_pick ->> 'c' as wing_ratio_confidence,
  (m.wing_ratio_pick ->> 'd')::date as wing_ratio_captured_on,
  (m.rocket_ratio_pick ->> 'v')::numeric as rocket_ratio,
  m.rocket_ratio_pick ->> 's' as rocket_ratio_source,
  m.rocket_ratio_pick ->> 'c' as rocket_ratio_confidence,
  (m.rocket_ratio_pick ->> 'd')::date as rocket_ratio_captured_on,
  (m.average_price_pick ->> 'v')::bigint as average_price,
  m.average_price_pick ->> 's' as average_price_source,
  m.average_price_pick ->> 'c' as average_price_confidence,
  (m.average_price_pick ->> 'd')::date as average_price_captured_on,
  (m.average_reviews_pick ->> 'v')::numeric as average_reviews,
  m.average_reviews_pick ->> 's' as average_reviews_source,
  m.average_reviews_pick ->> 'c' as average_reviews_confidence,
  (m.average_reviews_pick ->> 'd')::date as average_reviews_captured_on,
  (m.brand_concentration_pick ->> 'v')::numeric as brand_concentration,
  m.brand_concentration_pick ->> 's' as brand_concentration_source,
  m.brand_concentration_pick ->> 'c' as brand_concentration_confidence,
  (m.brand_concentration_pick ->> 'd')::date as brand_concentration_captured_on,
  (m.sample_size_pick ->> 'v')::smallint as sample_size,
  m.sample_size_pick ->> 's' as sample_size_source,
  m.sample_size_pick ->> 'c' as sample_size_confidence,
  (m.sample_size_pick ->> 'd')::date as sample_size_captured_on,
  (m.ad_bid_pick ->> 'v')::bigint as ad_bid,
  m.ad_bid_pick ->> 's' as ad_bid_source,
  m.ad_bid_pick ->> 'c' as ad_bid_confidence,
  (m.ad_bid_pick ->> 'd')::date as ad_bid_captured_on
from public.keywords k
left join lateral (
  select
    count(*) as snapshot_count,
    max(s.captured_on) as latest_captured_on,
    (array_agg(
       jsonb_build_object(
         'v', s.search_volume,
         's', coalesce(s.metric_meta -> 'search_volume' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'search_volume' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'search_volume' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'search_volume' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.search_volume is not null))[1] as search_volume_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.search_volume_previous,
         's', coalesce(s.metric_meta -> 'search_volume_previous' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'search_volume_previous' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'search_volume_previous' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'search_volume_previous' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.search_volume_previous is not null))[1] as search_volume_previous_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.search_growth_rate,
         's', coalesce(s.metric_meta -> 'search_growth_rate' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'search_growth_rate' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'search_growth_rate' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'search_growth_rate' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.search_growth_rate is not null))[1] as search_growth_rate_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.coupang_product_count,
         's', coalesce(s.metric_meta -> 'coupang_product_count' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'coupang_product_count' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'coupang_product_count' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'coupang_product_count' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.coupang_product_count is not null))[1] as coupang_product_count_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.competition_intensity,
         's', coalesce(s.metric_meta -> 'competition_intensity' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'competition_intensity' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'competition_intensity' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'competition_intensity' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.competition_intensity is not null))[1] as competition_intensity_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.wing_ratio,
         's', coalesce(s.metric_meta -> 'wing_ratio' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'wing_ratio' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'wing_ratio' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'wing_ratio' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.wing_ratio is not null))[1] as wing_ratio_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.rocket_ratio,
         's', coalesce(s.metric_meta -> 'rocket_ratio' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'rocket_ratio' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'rocket_ratio' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'rocket_ratio' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.rocket_ratio is not null))[1] as rocket_ratio_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.average_price,
         's', coalesce(s.metric_meta -> 'average_price' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'average_price' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'average_price' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'average_price' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.average_price is not null))[1] as average_price_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.average_reviews,
         's', coalesce(s.metric_meta -> 'average_reviews' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'average_reviews' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'average_reviews' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'average_reviews' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.average_reviews is not null))[1] as average_reviews_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.brand_concentration,
         's', coalesce(s.metric_meta -> 'brand_concentration' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'brand_concentration' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'brand_concentration' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'brand_concentration' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.brand_concentration is not null))[1] as brand_concentration_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.sample_size,
         's', coalesce(s.metric_meta -> 'sample_size' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'sample_size' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'sample_size' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'sample_size' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.sample_size is not null))[1] as sample_size_pick,
    (array_agg(
       jsonb_build_object(
         'v', s.ad_bid,
         's', coalesce(s.metric_meta -> 'ad_bid' ->> 'source', s.source_type),
         'c', coalesce(s.metric_meta -> 'ad_bid' ->> 'confidence', s.confidence),
         'd', s.captured_on)
       order by s.captured_on desc,
         public.confidence_rank(coalesce(s.metric_meta -> 'ad_bid' ->> 'confidence', s.confidence)),
         public.source_priority(coalesce(s.metric_meta -> 'ad_bid' ->> 'source', s.source_type)),
         s.captured_at desc, s.id desc
     ) filter (where s.ad_bid is not null))[1] as ad_bid_pick
  from public.keyword_snapshots s
  where s.keyword_id = k.id
    and not s.is_excluded
) m on true;

comment on view public.v_keyword_latest is '키워드별 현재 값 (v_product_latest 와 같은 우선순위 규칙)';

-- v_current_scores ------------------------------------------------------------
create view public.v_current_scores
with (security_invoker = true)
as
select os.*
from public.opportunity_scores os
join public.scoring_versions sv on sv.version = os.scoring_version
where os.is_current
  and sv.is_active;

comment on view public.v_current_scores is '활성 점수 버전의 현재 점수';

-- v_prediction_vs_actual ------------------------------------------------------
-- 예측 기간(target_period) 안에 완전히 들어가는 실적 기간을 합산한다 (기간 일치 또는 포함).
-- 같은 기간이 DAY/MONTH 로, 또는 여러 출처로 중복 저장될 수 있으므로
-- (예측 × period_type × source_type) 단위로 따로 집계한다. (사전 점검 B-5)
-- 합산 대상 중 하나라도 NULL(모름)이면 합계도 NULL.
-- 오차 = 실제 − 예측, 오차율 = 오차 ÷ 실제 (실제 = 0 이면 NULL).
-- 실적이 아직 없는 예측도 보이도록 LEFT JOIN 한다 (period_type 등이 NULL).
create view public.v_prediction_vs_actual
with (security_invoker = true)
as
select
  pr.id as prediction_id,
  pr.owner_id,
  pr.product_id,
  pr.listing_id,
  pr.opportunity_score_id,
  pr.model_version,
  pr.predicted_at,
  pr.target_period_start,
  pr.target_period_end,
  (pr.target_period_end - pr.target_period_start + 1) as target_days,
  a.period_type,
  a.source_type,
  a.result_rows,
  a.coverage_days,
  (a.coverage_days = (pr.target_period_end - pr.target_period_start + 1)) as is_complete,

  pr.sales_predicted,
  a.units_sold as sales_actual,
  a.units_sold - pr.sales_predicted as sales_error,
  abs(a.units_sold - pr.sales_predicted) as sales_abs_error,
  round((a.units_sold - pr.sales_predicted)::numeric / nullif(a.units_sold, 0), 4) as sales_error_rate,

  pr.revenue_predicted,
  a.gross_revenue as revenue_actual,
  a.gross_revenue - pr.revenue_predicted as revenue_error,
  abs(a.gross_revenue - pr.revenue_predicted) as revenue_abs_error,
  round((a.gross_revenue - pr.revenue_predicted)::numeric / nullif(a.gross_revenue, 0), 4) as revenue_error_rate,

  pr.net_profit_predicted,
  a.net_profit as net_profit_actual,
  a.net_profit - pr.net_profit_predicted as net_profit_error,
  abs(a.net_profit - pr.net_profit_predicted) as net_profit_abs_error,
  round((a.net_profit - pr.net_profit_predicted)::numeric / nullif(a.net_profit, 0), 4) as net_profit_error_rate,

  pr.net_margin_predicted,
  round(a.net_profit::numeric / nullif(a.gross_revenue, 0), 4) as net_margin_actual
from public.predictions pr
left join lateral (
  select
    r.period_type,
    r.source_type,
    count(*) as result_rows,
    sum(r.period_end - r.period_start + 1) as coverage_days,
    case when count(r.units_sold) = count(*) then sum(r.units_sold) end as units_sold,
    case when count(r.gross_revenue) = count(*) then sum(r.gross_revenue) end as gross_revenue,
    case when count(r.net_profit) = count(*) then sum(r.net_profit) end as net_profit
  from public.sales_results r
  where r.listing_id = pr.listing_id
    and r.period_start >= pr.target_period_start
    and r.period_end <= pr.target_period_end
  group by r.period_type, r.source_type
) a on true;

comment on view public.v_prediction_vs_actual is '예측 vs 실제. listing_id 가 없는 예측은 실적 행이 붙지 않는다.';
