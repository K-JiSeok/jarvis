-- JARVIS PHASE 2 · 0005 수익성: profit_scenarios(입력), profit_calculations(결과)
--
-- 입력과 계산 결과를 분리한다. 결과 행은 formula_version 과 inputs_snapshot(계산 당시 입력 사본)을 갖고,
-- 재계산하면 새 행을 INSERT 하고 이전 행은 is_current = false 로 내린다.

-- 8) profit_scenarios ---------------------------------------------------------
create table public.profit_scenarios (
  id                         uuid primary key default gen_random_uuid(),
  owner_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id                 uuid not null,
  name                       text not null default '기본',
  is_primary                 boolean not null default false,
  sale_price                 bigint,
  vat_included               boolean not null default true,
  unit_cost_amount           numeric(14, 2),
  unit_cost_currency         char(3) not null default 'KRW',
  exchange_rate              numeric(12, 4) not null default 1 check (exchange_rate > 0),
  intl_shipping_per_unit     bigint,
  domestic_shipping_per_unit bigint,
  coupang_fee_rate           numeric(6, 4) check (coupang_fee_rate between 0 and 1),
  logistics_fee_per_unit     bigint,
  ad_cost_rate               numeric(6, 4) check (ad_cost_rate between 0 and 1),
  ad_cost_per_unit           bigint,
  other_cost_per_unit        bigint,
  fixed_cost_total           bigint,
  expected_monthly_units     integer,
  source_type                public.source_type_t not null default 'MANUAL',
  confidence                 public.confidence_t not null default 'B',
  memo                       text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint profit_scenarios_owner_id_id_key unique (owner_id, id),
  -- profit_calculations 가 같은 상품의 시나리오만 참조하도록 하는 복합 FK 대상
  constraint profit_scenarios_owner_product_id_key unique (owner_id, product_id, id),
  constraint profit_scenarios_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade
);

-- 상품당 대표 시나리오 1개
create unique index profit_scenarios_primary_key on public.profit_scenarios (product_id) where is_primary;
create index profit_scenarios_product_idx on public.profit_scenarios (product_id);

comment on column public.profit_scenarios.coupang_fee_rate is 'NULL 이면 categories.coupang_fee_rate 기본값을 쓴다';
comment on column public.profit_scenarios.ad_cost_rate is '광고비 (매출 대비 비율). ad_cost_per_unit 과 둘 중 하나를 입력';
comment on column public.profit_scenarios.fixed_cost_total is '초기 고정비 (손익분기 판매량 계산용)';

-- 9) profit_calculations ------------------------------------------------------
create table public.profit_calculations (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scenario_id          uuid not null,
  product_id           uuid not null,
  formula_version      text not null,
  inputs_snapshot      jsonb not null,
  unit_cost_krw        bigint,
  coupang_fee_amount   bigint,
  ad_cost_amount       bigint,
  total_cost_per_unit  bigint,
  net_profit_per_unit  bigint,
  net_margin_rate      numeric(7, 4),
  roi                  numeric(9, 4),
  break_even_units     integer,
  monthly_net_profit   bigint,
  is_current           boolean not null default true,
  calculated_at        timestamptz not null default now(),

  constraint profit_calculations_owner_id_id_key unique (owner_id, id),
  constraint profit_calculations_scenario_fk foreign key (owner_id, product_id, scenario_id)
    references public.profit_scenarios (owner_id, product_id, id) on delete cascade,
  constraint profit_calculations_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade
);

create unique index profit_calculations_current_key on public.profit_calculations (scenario_id) where is_current;
create index profit_calculations_product_calculated_idx on public.profit_calculations (product_id, calculated_at desc);

comment on column public.profit_calculations.inputs_snapshot is '계산 당시 입력값 전체 사본 (적용된 수수료율·환율 포함)';
comment on column public.profit_calculations.break_even_units is 'fixed_cost_total 이 없으면 NULL';
