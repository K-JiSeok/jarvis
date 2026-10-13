-- JARVIS PHASE 18 · 중국 도매 소싱 (추가만 — 기존 테이블 · 함수 · Score V1 · Profit 변경 없음)
--
-- 1) sourcing_queries         상품별 도매 검색어 (원문 · 중국어 · 영어 · 사전 버전 · 사전에 없는 말 · 묶음 수량)
-- 2) supply_offers            도매 공급 후보 (사이트 · 상품 ID 기준 1행). 페이지에 보인 값만 — 모르면 NULL
-- 3) supply_offer_snapshots   공급 후보 가격 · 수량 구간 · 배송비 이력 (하루 1행)
-- 4) product_supply_links     쿠팡 상품 ↔ 공급 후보 (매칭 판정 · 도착 원가 계산 결과 · 사용자 선택). 한 상품에 여러 후보
-- 5) fx_rates                 원가 계산에 쓴 환율 (출처 · 기준일)
--
-- 모두 owner_id + RLS 4정책 + owner_id 포함 복합 FK.

-- 1) sourcing_queries ------------------------------------------------------------
create table public.sourcing_queries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id   uuid not null,
  original     text not null,
  query_zh     text,
  query_en     text,
  query_ko     text,
  mapped       jsonb not null default '[]'::jsonb check (jsonb_typeof(mapped) = 'array'),
  unmapped     text[] not null default '{}',
  pack_qty     integer check (pack_qty > 0),
  cavities     integer check (cavities > 0),
  method       text not null check (method in ('DICTIONARY', 'MANUAL')),
  dict_version text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint sourcing_queries_owner_id_id_key unique (owner_id, id),
  constraint sourcing_queries_owner_product_key unique (owner_id, product_id),
  constraint sourcing_queries_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade
);

-- 2) supply_offers ---------------------------------------------------------------
create table public.supply_offers (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  site              text not null check (site in ('ALIBABA', '1688', 'TAOBAO')),
  site_product_id   text not null check (site_product_id ~ '^\d{6,20}$'),
  url               text not null,
  title             text not null,
  image_urls        text[] not null default '{}',
  category_path     text,
  -- 사이트 기준 통화 가격 (Alibaba JSON-LD = USD) — 보통 최저 구간
  base_price        numeric(14, 4) check (base_price > 0),
  base_currency     text check (base_currency ~ '^[A-Z]{3}$'),
  -- 화면 수량 구간 [{minQty, maxQty, amount, currency}] — 표시 통화
  tiers             jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  tiers_converted   boolean not null default false,
  moq               integer check (moq > 0),
  supplier_name     text,
  supplier_url      text,
  supplier_meta     jsonb not null default '{}'::jsonb,
  attributes        jsonb not null default '{}'::jsonb,
  material          text,
  size_text         text,
  colors            text[] not null default '{}',
  brand             text,
  model             text,
  weight_kg         numeric(10, 4) check (weight_kg > 0),
  package_size_text text,
  -- 사이트 표시 배송비 {perQty, amount, currency, text} — 주소 · 시점 기준, 확정 운임 아님
  shipping          jsonb,
  issues            text[] not null default '{}',
  source_type       source_type_t not null,
  confidence        confidence_t not null,
  first_seen_at     timestamptz not null default now(),
  last_captured_at  timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint supply_offers_owner_id_id_key unique (owner_id, id),
  constraint supply_offers_owner_site_product_key unique (owner_id, site, site_product_id),
  constraint supply_offers_price_currency_check check ((base_price is null) = (base_currency is null))
);

-- 3) supply_offer_snapshots ------------------------------------------------------
create table public.supply_offer_snapshots (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  offer_id      uuid not null,
  captured_on   date not null,
  captured_at   timestamptz not null,
  base_price    numeric(14, 4) check (base_price > 0),
  base_currency text,
  tiers         jsonb not null default '[]'::jsonb,
  moq           integer check (moq > 0),
  shipping      jsonb,

  constraint supply_offer_snapshots_offer_day_key unique (owner_id, offer_id, captured_on),
  constraint supply_offer_snapshots_offer_fk foreign key (owner_id, offer_id)
    references public.supply_offers (owner_id, id) on delete cascade
);

-- 4) product_supply_links --------------------------------------------------------
create table public.product_supply_links (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id   uuid not null,
  offer_id     uuid not null,
  -- 연결 경로: 확장 프로그램에서 이 상품을 찾다가 저장(TARGET) · 자동 매칭 제안(AUTO) · 직접 연결(USER)
  origin       text not null check (origin in ('TARGET', 'AUTO', 'USER')),
  match_level  text not null check (match_level in ('HIGH', 'SIMILAR', 'UNCLEAR')),
  match        jsonb not null default '{}'::jsonb,
  -- 사용자 판단 (자동이 바꾸지 않는다)
  user_status  text not null default 'CANDIDATE' check (user_status in ('CANDIDATE', 'SELECTED', 'REJECTED')),
  landed       jsonb,
  landed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint product_supply_links_owner_id_id_key unique (owner_id, id),
  constraint product_supply_links_product_offer_key unique (owner_id, product_id, offer_id),
  constraint product_supply_links_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint product_supply_links_offer_fk foreign key (owner_id, offer_id)
    references public.supply_offers (owner_id, id) on delete cascade
);

create index product_supply_links_product_idx on public.product_supply_links (owner_id, product_id);

-- 5) fx_rates --------------------------------------------------------------------
create table public.fx_rates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  krw         numeric(14, 6) not null check (krw > 0),
  source      text not null,
  rate_date   date not null,
  fetched_at  timestamptz not null default now(),

  constraint fx_rates_owner_currency_day_source_key unique (owner_id, currency, rate_date, source)
);

-- updated_at --------------------------------------------------------------------
create trigger set_updated_at before update on public.sourcing_queries for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.supply_offers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.product_supply_links for each row execute function public.set_updated_at();

comment on table public.supply_offers is '도매 공급 후보 (PHASE 18) — 확장 프로그램이 사용자가 연 상품 페이지에서 읽은 값만';
comment on table public.product_supply_links is '쿠팡 상품 ↔ 공급 후보 (PHASE 18) — 매칭 판정 · 도착 원가(추정 포함) · 사용자 선택';

-- RLS --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sourcing_queries', 'supply_offers', 'supply_offer_snapshots', 'product_supply_links', 'fx_rates']
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
