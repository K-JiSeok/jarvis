-- JARVIS PHASE 2 · 0002 마스터 테이블: categories, keywords, products
--
-- 공통 규칙
--  * owner_id 는 모든 사용자 테이블에 있고 RLS 기준이 된다 (0011).
--  * 다른 테이블이 참조하는 테이블은 UNIQUE (owner_id, id) 를 갖는다.
--    자식은 (owner_id, 부모_id) 복합 FK로 참조해서 다른 사용자의 행을 참조할 수 없게 한다. (사전 점검 B-1)
--  * 선택적 참조의 ON DELETE SET NULL 은 참조 컬럼만 비운다: SET NULL (부모_id). owner_id는 유지 (PG15+)
--  * 마스터는 soft 상태값을 쓴다. 쿠팡에서 사라진 상품도 행을 지우지 않는다.

-- 1) categories ---------------------------------------------------------------
create table public.categories (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  coupang_category_id text,
  name                text not null,
  parent_id           uuid,
  depth               smallint,
  path                text,
  coupang_fee_rate    numeric(6, 4) check (coupang_fee_rate between 0 and 1),
  is_active           boolean not null default true,
  source_type         public.source_type_t not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint categories_owner_id_id_key unique (owner_id, id),
  constraint categories_owner_coupang_category_key unique (owner_id, coupang_category_id),
  constraint categories_parent_fk foreign key (owner_id, parent_id)
    references public.categories (owner_id, id) on delete set null (parent_id),
  constraint categories_parent_not_self check (parent_id is null or parent_id <> id)
);

create index categories_parent_id_idx on public.categories (parent_id);

comment on table public.categories is '쿠팡 카테고리 트리. 카테고리별 기본 수수료율을 수익성 계산 기본값으로 쓴다.';
comment on column public.categories.path is '표시·검색용 경로. 예: 생활용품>욕실용품>수건';

-- 2) keywords -----------------------------------------------------------------
create table public.keywords (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword            text not null,
  normalized_keyword text not null,
  category_id        uuid,
  is_tracking        boolean not null default true,
  memo               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint keywords_owner_id_id_key unique (owner_id, id),
  constraint keywords_owner_normalized_key unique (owner_id, normalized_keyword),
  constraint keywords_category_fk foreign key (owner_id, category_id)
    references public.categories (owner_id, id) on delete set null (category_id)
);

create index keywords_category_id_idx on public.keywords (category_id);

comment on column public.keywords.normalized_keyword is '중복 판정 키. 소문자 + 앞뒤 공백 제거 + 연속 공백 1개로 정리한 값 (앱에서 생성).';
comment on column public.keywords.is_tracking is '정기 수집 대상 여부';

-- 4) products -----------------------------------------------------------------
create table public.products (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  coupang_product_id     text not null,
  coupang_item_id        text,
  coupang_vendor_item_id text,
  product_url            text,
  product_name           text not null,
  brand                  text,
  category_id            uuid,
  seller_type            text check (seller_type in ('COUPANG_RETAIL', 'ROCKET_GROWTH_SELLER', 'WING_SELLER', 'UNKNOWN')),
  option_count           smallint,
  is_coupang_pb          boolean,
  is_own_product         boolean not null default false,
  lifecycle_status       text not null default 'ACTIVE' check (lifecycle_status in ('ACTIVE', 'UNAVAILABLE', 'DELETED')),
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  deleted_detected_at    timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint products_owner_id_id_key unique (owner_id, id),
  constraint products_owner_coupang_product_key unique (owner_id, coupang_product_id),
  constraint products_category_fk foreign key (owner_id, category_id)
    references public.categories (owner_id, id) on delete set null (category_id)
);

create index products_category_id_idx on public.products (category_id);
create index products_owner_status_last_seen_idx on public.products (owner_id, lifecycle_status, last_seen_at desc);
create index products_brand_idx on public.products (brand);
create index products_product_name_trgm_idx on public.products using gin (product_name extensions.gin_trgm_ops);

comment on table public.products is '쿠팡 상품 1개 = 1행 (productId 단위). 변하는 수치는 product_snapshots 에 쌓는다.';
comment on column public.products.coupang_product_id is '쿠팡 productId. 숫자지만 text로 저장한다.';
comment on column public.products.product_name is '최신 관측 상품명. 관측 당시 이름은 product_snapshots.product_name_observed';
comment on column public.products.is_coupang_pb is '쿠팡 PB 여부. NULL = 모름';
comment on column public.products.is_own_product is '내가 판매하는 상품 (my_listings.own_product_id)';
