-- JARVIS PHASE 2 · 0004 시계열 / 관계: keyword_snapshots, product_snapshots, keyword_product_ranks, competitors
--
-- 스냅샷 원칙 (설계 Part A 10)
--  * 스냅샷 1행 = (대상, 수집일 KST, 출처). 같은 날 같은 출처는 UPSERT → upsert_*_snapshot() (0010)
--  * 출처·신뢰도는 행 단위가 기본. 항목별로 다르면 metric_meta 에 {"컬럼명": {"source": .., "confidence": ..}}
--  * NULL = 모름, 0 = 실제 0
--  * 예측값(sales_predicted, revenue_predicted)은 스냅샷에 두지 않는다 → predictions (0008)
--  * 잘못된 행은 지우지 않고 is_excluded 로 현재값 계산에서 제외한다.

-- 3) keyword_snapshots --------------------------------------------------------
create table public.keyword_snapshots (
  id                     bigint generated always as identity primary key,
  owner_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword_id             uuid not null,
  captured_on            date not null,
  captured_at            timestamptz not null,
  source_type            public.source_type_t not null,
  confidence             public.confidence_t not null,
  search_volume          integer,
  search_volume_previous integer,
  search_growth_rate     numeric(8, 4),
  coupang_product_count  integer,
  competition_intensity  numeric(12, 4),
  wing_ratio             numeric(6, 4) check (wing_ratio between 0 and 1),
  rocket_ratio           numeric(6, 4) check (rocket_ratio between 0 and 1),
  average_price          bigint,
  average_reviews        numeric(12, 2),
  brand_concentration    numeric(6, 4) check (brand_concentration between 0 and 1),
  sample_size            smallint,
  ad_bid                 bigint,
  metric_meta            jsonb not null default '{}'::jsonb,
  import_job_id          uuid,
  is_excluded            boolean not null default false,
  excluded_reason        text,
  created_at             timestamptz not null default now(),

  constraint keyword_snapshots_keyword_fk foreign key (owner_id, keyword_id)
    references public.keywords (owner_id, id) on delete cascade,
  constraint keyword_snapshots_import_job_fk foreign key (owner_id, import_job_id)
    references public.import_jobs (owner_id, id) on delete set null (import_job_id),
  constraint keyword_snapshots_keyword_day_source_key unique (keyword_id, captured_on, source_type)
);

create index keyword_snapshots_keyword_captured_idx on public.keyword_snapshots (keyword_id, captured_on desc);
create index keyword_snapshots_import_job_idx on public.keyword_snapshots (import_job_id);

comment on column public.keyword_snapshots.captured_on is '수집일 (Asia/Seoul 기준 날짜)';
comment on column public.keyword_snapshots.competition_intensity is '쿠팡 상품 수 ÷ 월 검색량';
comment on column public.keyword_snapshots.brand_concentration is '상위 N개 중 최다 브랜드 점유율';
comment on column public.keyword_snapshots.sample_size is '평균·비율 계산에 쓴 상위 상품 수 N';
comment on column public.keyword_snapshots.import_job_id is '이 행을 마지막으로 쓴 import (수동 갱신이면 NULL)';

-- 5) product_snapshots --------------------------------------------------------
create table public.product_snapshots (
  id                    bigint generated always as identity primary key,
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id            uuid not null,
  captured_on           date not null,
  captured_at           timestamptz not null,
  source_type           public.source_type_t not null,
  confidence            public.confidence_t not null,
  product_name_observed text,
  price                 bigint,
  original_price        bigint,
  discount_rate         numeric(6, 4) check (discount_rate between 0 and 1),
  delivery_type         text check (
    delivery_type in ('ROCKET', 'ROCKET_GROWTH', 'ROCKET_FRESH', 'SELLER_DELIVERY', 'OVERSEAS', 'OTHER')
  ),
  seller_type_observed  text check (
    seller_type_observed in ('COUPANG_RETAIL', 'ROCKET_GROWTH_SELLER', 'WING_SELLER', 'UNKNOWN')
  ),
  review_count          integer,
  rating                numeric(3, 2) check (rating between 0 and 5),
  category_rank         integer,
  option_count          smallint,
  views_28d             integer,
  sales_period_days     smallint check (sales_period_days > 0),
  sales_actual          integer,
  sales_estimated       integer,
  revenue_actual        bigint,
  revenue_estimated     bigint,
  conversion_rate       numeric(6, 4) check (conversion_rate between 0 and 1),
  metric_meta           jsonb not null default '{}'::jsonb,
  import_job_id         uuid,
  is_excluded           boolean not null default false,
  excluded_reason       text,
  created_at            timestamptz not null default now(),

  constraint product_snapshots_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint product_snapshots_import_job_fk foreign key (owner_id, import_job_id)
    references public.import_jobs (owner_id, id) on delete set null (import_job_id),
  constraint product_snapshots_product_day_source_key unique (product_id, captured_on, source_type)
);

create index product_snapshots_product_captured_idx on public.product_snapshots (product_id, captured_on desc);
create index product_snapshots_owner_captured_idx on public.product_snapshots (owner_id, captured_on desc);
create index product_snapshots_import_job_idx on public.product_snapshots (import_job_id);

comment on column public.product_snapshots.captured_on is '수집일 (Asia/Seoul 기준 날짜)';
comment on column public.product_snapshots.product_name_observed is '관측 당시 상품명 (이름 변경 이력)';
comment on column public.product_snapshots.category_rank is '카테고리 랭킹. 키워드 검색 순위는 keyword_product_ranks';
comment on column public.product_snapshots.sales_period_days is '판매량·매출 집계 기간 (일). 예: 28, 30';
comment on column public.product_snapshots.sales_actual is '실제 판매량 (출처가 실제값을 줄 때만)';
comment on column public.product_snapshots.sales_estimated is '추정 판매량 (외부 도구·역산)';
comment on column public.product_snapshots.import_job_id is '이 행을 마지막으로 쓴 import (수동 갱신이면 NULL)';

-- 6) keyword_product_ranks ----------------------------------------------------
create table public.keyword_product_ranks (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword_id    uuid not null,
  product_id    uuid not null,
  captured_on   date not null,
  captured_at   timestamptz not null,
  source_type   public.source_type_t not null,
  confidence    public.confidence_t not null,
  rank_position integer not null check (rank_position > 0),
  is_ad         boolean not null default false,
  page          smallint,
  import_job_id uuid,
  created_at    timestamptz not null default now(),

  constraint keyword_product_ranks_keyword_fk foreign key (owner_id, keyword_id)
    references public.keywords (owner_id, id) on delete cascade,
  constraint keyword_product_ranks_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint keyword_product_ranks_import_job_fk foreign key (owner_id, import_job_id)
    references public.import_jobs (owner_id, id) on delete set null (import_job_id),
  constraint keyword_product_ranks_natural_key unique (keyword_id, product_id, captured_on, source_type, is_ad)
);

create index keyword_product_ranks_keyword_rank_idx on public.keyword_product_ranks (keyword_id, captured_on desc, rank_position);
create index keyword_product_ranks_product_captured_idx on public.keyword_product_ranks (product_id, captured_on desc);
create index keyword_product_ranks_import_job_idx on public.keyword_product_ranks (import_job_id);

-- 7) competitors --------------------------------------------------------------
create table public.competitors (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id            uuid not null,
  competitor_product_id uuid not null,
  keyword_id            uuid,
  relation_type         text not null check (relation_type in ('SAME_PRODUCT', 'SIMILAR', 'SUBSTITUTE')),
  source_type           public.source_type_t not null,
  memo                  text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint competitors_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint competitors_competitor_product_fk foreign key (owner_id, competitor_product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint competitors_keyword_fk foreign key (owner_id, keyword_id)
    references public.keywords (owner_id, id) on delete set null (keyword_id),
  constraint competitors_not_self check (product_id <> competitor_product_id),
  constraint competitors_pair_key unique (product_id, competitor_product_id)
);

create index competitors_competitor_product_idx on public.competitors (competitor_product_id);
create index competitors_keyword_idx on public.competitors (keyword_id);
