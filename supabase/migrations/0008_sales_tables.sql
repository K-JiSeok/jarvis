-- JARVIS PHASE 2 · 0008 실제 판매: my_listings, sales_results, predictions
--
-- * 분석한 상품(reference_product_id) ≠ 내가 등록한 상품(own_product_id)
-- * 판매 결정 시점의 점수·수익성 계산을 baseline_* 로 고정 (점수·계산 행은 불변)
-- * 실적(sales_results)과 예측(predictions)은 절대 같은 테이블에 섞지 않는다.

-- 15) my_listings -------------------------------------------------------------
create table public.my_listings (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  watchlist_id            uuid,
  reference_product_id    uuid not null,
  own_product_id          uuid,
  listing_name            text not null,
  sku                     text,
  channel                 text not null default 'COUPANG',
  fulfillment_type        text check (fulfillment_type in ('ROCKET_GROWTH', 'SELLER_DELIVERY')),
  status                  text not null default 'PREPARING' check (status in ('PREPARING', 'ACTIVE', 'PAUSED', 'ENDED')),
  launch_date             date,
  ended_on                date,
  baseline_score_id       uuid,
  baseline_profit_calc_id uuid,
  memo                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint my_listings_owner_id_id_key unique (owner_id, id),
  constraint my_listings_watchlist_fk foreign key (owner_id, watchlist_id)
    references public.watchlist (owner_id, id) on delete set null (watchlist_id),
  constraint my_listings_reference_product_fk foreign key (owner_id, reference_product_id)
    references public.products (owner_id, id),
  constraint my_listings_own_product_fk foreign key (owner_id, own_product_id)
    references public.products (owner_id, id),
  constraint my_listings_baseline_score_fk foreign key (owner_id, baseline_score_id)
    references public.opportunity_scores (owner_id, id),
  constraint my_listings_baseline_profit_calc_fk foreign key (owner_id, baseline_profit_calc_id)
    references public.profit_calculations (owner_id, id)
);

create unique index my_listings_own_product_key on public.my_listings (own_product_id) where own_product_id is not null;
create index my_listings_reference_product_idx on public.my_listings (reference_product_id);
create index my_listings_watchlist_idx on public.my_listings (watchlist_id);

comment on column public.my_listings.reference_product_id is '분석했던 상품 (경쟁 상품일 수 있음)';
comment on column public.my_listings.own_product_id is '내가 등록한 쿠팡 상품 (등록 전 NULL, products.is_own_product = true)';
comment on column public.my_listings.baseline_score_id is '판매 결정 시점 기회점수 (예측 vs 실제 학습 기준)';
comment on column public.my_listings.baseline_profit_calc_id is '판매 결정 시점 수익성 계산';

-- 16) sales_results -----------------------------------------------------------
-- net_profit / net_margin_rate 는 원본 금액에서 DB가 계산한다 (STORED generated column).
-- 생성 컬럼은 다른 생성 컬럼을 참조할 수 없어서 net_margin_rate 에는 같은 식을 풀어 쓴다. (사전 점검 B-4)
-- 비용 중 하나라도 NULL(모름)이면 결과도 NULL.
create table public.sales_results (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  listing_id      uuid not null,
  period_type     text not null check (period_type in ('DAY', 'WEEK', 'MONTH')),
  period_start    date not null,
  period_end      date not null,
  units_sold      integer,
  returned_units  integer,
  gross_revenue   bigint,
  ad_spend        bigint,
  cogs            bigint,
  logistics_cost  bigint,
  coupang_fees    bigint,
  other_costs     bigint,
  net_profit      bigint generated always as (
    gross_revenue - (ad_spend + cogs + logistics_cost + coupang_fees + other_costs)
  ) stored,
  net_margin_rate numeric(7, 4) generated always as (
    round(
      (gross_revenue - (ad_spend + cogs + logistics_cost + coupang_fees + other_costs))::numeric
        / nullif(gross_revenue, 0),
      4
    )
  ) stored,
  source_type     public.source_type_t not null,
  confidence      public.confidence_t not null,
  import_job_id   uuid,
  memo            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sales_results_listing_fk foreign key (owner_id, listing_id)
    references public.my_listings (owner_id, id) on delete cascade,
  constraint sales_results_import_job_fk foreign key (owner_id, import_job_id)
    references public.import_jobs (owner_id, id) on delete set null (import_job_id),
  constraint sales_results_period_order check (period_end >= period_start),
  constraint sales_results_natural_key unique (listing_id, period_type, period_start, source_type)
);

create index sales_results_listing_period_idx on public.sales_results (listing_id, period_start);
create index sales_results_import_job_idx on public.sales_results (import_job_id);

comment on column public.sales_results.cogs is '실제 원가 합계';
comment on column public.sales_results.net_profit is 'GENERATED: gross_revenue − (ad_spend + cogs + logistics_cost + coupang_fees + other_costs)';
comment on column public.sales_results.net_margin_rate is 'GENERATED: net_profit ÷ gross_revenue (gross_revenue = 0 이면 NULL)';

-- 17) predictions -------------------------------------------------------------
-- JARVIS 가 특정 시점(predicted_at)에 특정 미래 기간(target_period)에 대해 낸 예측. 수정하지 않고 새 행으로 쌓는다.
create table public.predictions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id            uuid not null,
  listing_id            uuid,
  opportunity_score_id  uuid,
  profit_calculation_id uuid,
  model_version         text not null,
  predicted_at          timestamptz not null default now(),
  target_period_start   date not null,
  target_period_end     date not null,
  sales_predicted       integer,
  revenue_predicted     bigint,
  net_profit_predicted  bigint,
  net_margin_predicted  numeric(7, 4),
  assumptions           jsonb,
  created_at            timestamptz not null default now(),

  constraint predictions_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint predictions_listing_fk foreign key (owner_id, listing_id)
    references public.my_listings (owner_id, id) on delete set null (listing_id),
  constraint predictions_score_fk foreign key (owner_id, opportunity_score_id)
    references public.opportunity_scores (owner_id, id) on delete set null (opportunity_score_id),
  constraint predictions_profit_calc_fk foreign key (owner_id, profit_calculation_id)
    references public.profit_calculations (owner_id, id) on delete set null (profit_calculation_id),
  constraint predictions_period_order check (target_period_end >= target_period_start)
);

create index predictions_product_target_idx on public.predictions (product_id, target_period_start);
create index predictions_listing_target_idx on public.predictions (listing_id, target_period_start);
