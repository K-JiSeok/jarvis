-- JARVIS PHASE 2 · 0006 점수: scoring_versions, opportunity_scores, product_risks
--
-- 버전 관리 (설계 Part A 14)
--  * scoring_versions 는 전역 설정 (owner_id 없음). 릴리스된 버전은 바꾸지 않고 새 버전을 만든다.
--  * opportunity_scores 는 append-only. 재계산은 새 행 INSERT + 이전 행 is_current = false.
--  * is_current 는 (상품, 키워드 맥락, 버전)마다 1개 → V1 과 V2 현재 점수가 동시에 존재할 수 있다.

-- 10) scoring_versions --------------------------------------------------------
create table public.scoring_versions (
  version            text primary key,
  weights            jsonb not null,
  thresholds         jsonb not null,
  factor_definitions jsonb,
  description        text,
  is_active          boolean not null default false,
  released_at        timestamptz not null default now(),
  retired_at         timestamptz
);

-- 활성 버전은 항상 1개
create unique index scoring_versions_single_active_key on public.scoring_versions ((true)) where is_active;

comment on column public.scoring_versions.weights is '요소별 가중치. 키는 src/config/scoring-weights.ts 의 ScoreFactor 와 동일 (합계 100)';
comment on column public.scoring_versions.factor_definitions is '요소별 라벨·설명·opportunity_scores 컬럼 매핑';

-- 11) opportunity_scores ------------------------------------------------------
create table public.opportunity_scores (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id           uuid not null,
  keyword_id           uuid,
  scoring_version      text not null references public.scoring_versions (version),
  total_score          numeric(5, 2) not null check (total_score between 0 and 100),
  demand_score         numeric(5, 2) check (demand_score between 0 and 100),
  sales_score          numeric(5, 2) check (sales_score between 0 and 100),
  growth_score         numeric(5, 2) check (growth_score between 0 and 100),
  competition_score    numeric(5, 2) check (competition_score between 0 and 100),
  wing_score           numeric(5, 2) check (wing_score between 0 and 100),
  review_barrier_score numeric(5, 2) check (review_barrier_score between 0 and 100),
  conversion_score     numeric(5, 2) check (conversion_score between 0 and 100),
  margin_score         numeric(5, 2) check (margin_score between 0 and 100),
  stability_score      numeric(5, 2) check (stability_score between 0 and 100),
  extra_factor_scores  jsonb not null default '{}'::jsonb,
  verdict              public.verdict_t not null,
  data_confidence      public.confidence_t,
  missing_factors      text[],
  reasons              jsonb not null default '[]'::jsonb,
  input_refs           jsonb not null,
  is_current           boolean not null default true,
  calculated_at        timestamptz not null default now(),

  constraint opportunity_scores_owner_id_id_key unique (owner_id, id),
  -- product_risks 가 같은 상품의 점수만 참조하도록 하는 복합 FK 대상
  constraint opportunity_scores_owner_product_id_key unique (owner_id, product_id, id),
  constraint opportunity_scores_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint opportunity_scores_keyword_fk foreign key (owner_id, keyword_id)
    references public.keywords (owner_id, id) on delete set null (keyword_id)
);

-- (상품, 키워드 맥락, 버전)당 현재 점수 1개. keyword_id NULL(종합 점수)끼리도 중복으로 본다.
create unique index opportunity_scores_current_key
  on public.opportunity_scores (product_id, keyword_id, scoring_version) nulls not distinct
  where is_current;

create index opportunity_scores_product_calculated_idx on public.opportunity_scores (product_id, calculated_at desc);
create index opportunity_scores_current_rank_idx on public.opportunity_scores (owner_id, scoring_version, total_score desc) where is_current;
create index opportunity_scores_keyword_idx on public.opportunity_scores (keyword_id);

comment on column public.opportunity_scores.keyword_id is 'NULL = 키워드 무관 종합 점수';
comment on column public.opportunity_scores.demand_score is '요소 점수는 0~100 정규화 값. 가중합 = total_score';
comment on column public.opportunity_scores.input_refs is '계산에 쓴 snapshot / keyword_snapshot / profit_calculation id (재현·백테스트용)';

-- 12) product_risks -----------------------------------------------------------
create table public.product_risks (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id           uuid not null,
  opportunity_score_id uuid,
  risk_type            public.risk_type_t not null,
  risk_level           public.risk_level_t not null,
  description          text not null,
  evidence             jsonb,
  source_type          public.source_type_t not null,
  is_active            boolean not null default true,
  detected_at          timestamptz not null default now(),
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),

  constraint product_risks_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint product_risks_score_fk foreign key (owner_id, product_id, opportunity_score_id)
    references public.opportunity_scores (owner_id, product_id, id) on delete cascade,
  constraint product_risks_score_type_key unique (opportunity_score_id, risk_type)
);

create index product_risks_active_product_idx on public.product_risks (product_id) where is_active;

comment on column public.product_risks.opportunity_score_id is '계산된 위험이면 해당 점수, 수동 입력이면 NULL';
