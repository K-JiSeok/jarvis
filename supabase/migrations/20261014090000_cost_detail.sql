-- JARVIS PHASE 20 · 로켓그로스 비용 · 수입 원가 상세 계산 (추가만 — 기존 테이블 · profit-v1 · Score V1 변경 없음)
--
-- 1) cost_rate_cards           비용 요율표. 요율을 코드에 고정하지 않고 행으로 둔다 (적용 시작일 · 출처 · 확인일 · 확인 방식)
--      owner_id NULL = 시스템 행: 공식 페이지(WING · 판매자 도움말)를 사람이 읽어 옮긴 값 (OFFICIAL_MANUAL). 모든 로그인 사용자가 읽기만 한다
--      owner_id = 사용자: 사용자가 직접 입력 · 붙여 넣은 요율 (USER_ENTERED) — 본인만. 같은 종류 · 범위면 사용자 행이 우선
--      수정 금지 (트리거) — 요율이 바뀌면 새 적용 시작일의 새 행. 과거 계산은 계산 당시 요율 사본을 따로 갖고 있어 바뀌지 않는다
-- 2) cost_settings             사용자별 반복 비용 설정 (포워더 kg 단가 · 구매대행 · 통관 · 국내 운송 · 검품 · 광고 · 과세 유형)
--      항목마다 근거 구분: QUOTE(실제 견적) · USER(사용자 기준값) · DEFAULT_ESTIMATE(추정 기본값)
-- 3) product_cost_inputs       상품별 입력: 카테고리 확인 · 포장 크기/무게 · 할인 · 예상 보관일 · 반품률 · 관세 · 주문 수량 · 설정 덮어쓰기
-- 4) product_cost_calculations 상세 원가 · 수익성 계산 이력 (엔진 cost-detail-v1) — 수정 금지, 입력이 같으면 다시 쌓지 않는다

-- 1) cost_rate_cards -------------------------------------------------------------
create table public.cost_rate_cards (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('SALES_FEE', 'SIZE_RULE', 'RG_INOUT', 'RG_DELIVERY', 'RG_STORAGE', 'RG_RETURN_PICKUP', 'RG_RESTOCK', 'RG_RELEASE')),
  -- 적용 범위: 판매 수수료 = 쿠팡 대분류 (예: 주방용품) · 입출고/배송/반품 회수 = WING 비용 분류 (예: 주방 > 밀폐저장용기) · '*' = 전체
  scope         text not null check (length(scope) between 1 and 100),
  rates         jsonb not null check (jsonb_typeof(rates) = 'object'),
  vat_basis     text not null check (vat_basis in ('EXCLUDED', 'INCLUDED')),
  valid_from    date not null,
  valid_to      date,
  -- 할인(프로모션) 가격이 끝나는 날 — 이후에는 기본 비용
  promo_until   date,
  source_url    text,
  source_label  text not null,
  checked_on    date not null,
  verification  text not null check (verification in ('OFFICIAL_MANUAL', 'USER_ENTERED')),
  note          text,
  created_at    timestamptz not null default now(),

  constraint cost_rate_cards_valid_range check (valid_to is null or valid_to >= valid_from),
  -- 시스템 행은 공식 확인값만, 사용자 행은 사용자 입력만
  constraint cost_rate_cards_owner_verification check ((owner_id is null) = (verification = 'OFFICIAL_MANUAL'))
);

create unique index cost_rate_cards_version_key on public.cost_rate_cards (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, scope, valid_from, checked_on);
create index cost_rate_cards_lookup_idx on public.cost_rate_cards (kind, scope, valid_from desc);

create function public.prevent_cost_rate_card_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'cost_rate_cards 는 수정할 수 없습니다 (요율이 바뀌면 새 적용 시작일의 행을 추가합니다)' using errcode = '55000';
end;
$$;
revoke execute on function public.prevent_cost_rate_card_update() from public, anon;
create trigger prevent_cost_rate_card_update before update on public.cost_rate_cards
  for each row execute function public.prevent_cost_rate_card_update();

comment on table public.cost_rate_cards is '비용 요율표 (PHASE 20). owner_id NULL = 공식 페이지 수기 확인 시스템 행 (읽기 전용) · 사용자 행 = 직접 입력. 수정 금지 — 새 버전 행 추가';

-- 2) cost_settings ---------------------------------------------------------------
create table public.cost_settings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- {key: {value, basis QUOTE/USER/DEFAULT_ESTIMATE, vatIncluded, source, date}} — 없는 항목 = 미설정(UNKNOWN), 0 은 0
  items       jsonb not null default '{}'::jsonb check (jsonb_typeof(items) = 'object'),
  tax_type    text not null default 'UNKNOWN' check (tax_type in ('GENERAL', 'SIMPLIFIED', 'UNKNOWN')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint cost_settings_owner_key unique (owner_id)
);
comment on table public.cost_settings is '사용자별 반복 비용 설정 (PHASE 20) — 항목마다 실제 견적 · 사용자 기준값 · 추정 기본값 구분';
comment on column public.cost_settings.tax_type is '사업자 과세 유형. UNKNOWN 이면 부가세 처리를 확정하지 않는다 (확인 비용 기준 이익 산출 불가)';

-- 3) product_cost_inputs ---------------------------------------------------------
create table public.product_cost_inputs (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id         uuid not null,
  -- 카테고리: 판매 수수료 대분류 · 세부 경로 · WING 비용 분류 — 사용자가 확인했을 때만 confirmed
  sales_scope        text,
  sales_path         text,
  fee_group          text,
  category_confirmed boolean not null default false,
  -- 판매 단위 포장 후 실측 (cm · kg)
  length_cm          numeric(8, 2) check (length_cm > 0),
  width_cm           numeric(8, 2) check (width_cm > 0),
  height_cm          numeric(8, 2) check (height_cm > 0),
  weight_kg          numeric(8, 3) check (weight_kg > 0),
  -- 판매가: 비우면 최근 관측가. 판매자 할인(쿠폰) 금액은 수수료 · 비용 구간 기준가에서 뺀다
  sale_price         bigint check (sale_price > 0),
  seller_discount    bigint check (seller_discount >= 0),
  storage_days       integer check (storage_days between 1 and 730),
  return_rate        numeric(6, 4) check (return_rate between 0 and 1),
  hs_code            text check (hs_code ~ '^[0-9]{4,10}$'),
  tariff_rate        numeric(6, 4) check (tariff_rate between 0 and 1),
  tariff_basis       text,
  tariff_confirmed   boolean not null default false,
  order_qty          integer check (order_qty > 0),
  units_per_listing  numeric(10, 4) check (units_per_listing > 0),
  -- 공급 원가 직접 입력 (견적 등, 개당 원) — 선택한 공급 후보보다 우선
  unit_cost_krw      bigint check (unit_cost_krw >= 0),
  unit_cost_basis    text check (unit_cost_basis in ('QUOTE', 'USER')),
  -- 이 상품만 다른 비용 (cost_settings.items 와 같은 모양) — 기본 설정은 바꾸지 않는다
  overrides          jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  memo               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint product_cost_inputs_owner_id_id_key unique (owner_id, id),
  constraint product_cost_inputs_product_key unique (owner_id, product_id),
  constraint product_cost_inputs_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint product_cost_inputs_discount_check check (seller_discount is null or sale_price is null or seller_discount < sale_price)
);
comment on table public.product_cost_inputs is '상품별 상세 원가 입력 (PHASE 20) — 비운 칸 = 모름 (0 으로 계산하지 않음)';

-- 4) product_cost_calculations ---------------------------------------------------
create table public.product_cost_calculations (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id         uuid not null,
  link_id            uuid,
  engine             text not null,
  input_hash         text not null,
  -- 계산 당시 입력 전체 사본 (적용 요율 행 사본 · 설정 · 상품 입력 · 공급 단가 · 환율 · 판매가)
  inputs             jsonb not null,
  result             jsonb not null,
  status             text not null,
  sale_price         bigint,
  confirmed_profit   bigint,
  estimated_low      bigint,
  estimated_high     bigint,
  computed_at        timestamptz not null default now(),

  constraint product_cost_calculations_owner_id_id_key unique (owner_id, id),
  constraint product_cost_calculations_input_key unique (owner_id, product_id, input_hash),
  constraint product_cost_calculations_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint product_cost_calculations_link_fk foreign key (owner_id, link_id)
    references public.product_supply_links (owner_id, id) on delete set null (link_id)
);
create index product_cost_calculations_product_idx on public.product_cost_calculations (owner_id, product_id, computed_at desc);

create function public.prevent_product_cost_calculation_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 연결 삭제(FK SET NULL)만 허용
  if new.link_id is null and old.link_id is not null
     and (to_jsonb(new) - 'link_id') = (to_jsonb(old) - 'link_id') then
    return new;
  end if;
  raise exception 'product_cost_calculations 는 수정할 수 없습니다 (계산 이력 보존 — 새 행으로 쌓습니다)' using errcode = '55000';
end;
$$;
revoke execute on function public.prevent_product_cost_calculation_update() from public, anon;
create trigger prevent_product_cost_calculation_update before update on public.product_cost_calculations
  for each row execute function public.prevent_product_cost_calculation_update();
comment on table public.product_cost_calculations is '상세 원가 · 수익성 계산 이력 (PHASE 20, cost-detail-v1) — 수정 금지, 입력이 바뀌면 새 행';

create trigger set_updated_at before update on public.cost_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.product_cost_inputs for each row execute function public.set_updated_at();

-- RLS ---------------------------------------------------------------------------
alter table public.cost_rate_cards enable row level security;
create policy cost_rate_cards_select_own on public.cost_rate_cards for select to authenticated using (owner_id is null or owner_id = (select auth.uid()));
create policy cost_rate_cards_insert_own on public.cost_rate_cards for insert to authenticated with check (owner_id = (select auth.uid()));
create policy cost_rate_cards_update_own on public.cost_rate_cards for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy cost_rate_cards_delete_own on public.cost_rate_cards for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.cost_rate_cards from anon;
grant select, insert, update, delete on public.cost_rate_cards to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['cost_settings', 'product_cost_inputs', 'product_cost_calculations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

