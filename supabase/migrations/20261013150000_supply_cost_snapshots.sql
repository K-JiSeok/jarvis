-- JARVIS PHASE 19 · 선택한 공급 후보의 원가 · 수익성 계산 이력 (추가만)
--
-- supply_cost_snapshots: 사용자가 [선택]한 공급 후보로 계산한 결과를 계산 시점 그대로 쌓는다.
--   - 원가 구성(확인 · 추정 · 미확인) · 환율 · 판매가 기준 · 확인 비용만 계산 / 추정 포함 범위 / 산출 불가 사유 · 엔진 버전
--   - 입력이 같으면 다시 쌓지 않는다 (input_hash UNIQUE). 공급가 · 환율 · 판매가가 바뀌면 새 행 → 과거 결과는 그대로
--   - UPDATE 금지 (트리거) — 조용히 덮어쓰지 않는다. 삭제는 사용자만 (RLS)
--
-- profit_scenarios 를 쓰지 않는 이유: 상품의 첫 시나리오는 자동으로 대표가 되고 대표 시나리오는 Score V1 마진 입력이다.
--   공급 원가(추정 포함)를 V1 마진에 연결하는 것은 승인 전 정책이라 별도 테이블에 둔다. Profit Engine · 기존 테이블 변경 없음.

create table public.supply_cost_snapshots (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id        uuid not null,
  offer_id          uuid not null,
  link_id           uuid not null,
  input_hash        text not null,
  -- 판매가 기준 · 수수료율 출처 · 주문 수량 · 적용 단가 · 환율
  sale_price        bigint,
  fee_rate          numeric(6, 4),
  fee_source        text not null check (fee_source in ('CATEGORY', 'ESTIMATED_RANGE')),
  order_qty         integer not null check (order_qty > 0),
  units_per_listing numeric(10, 4),
  unit_price        jsonb not null,
  fx                jsonb,
  -- 비용 줄 [{key, label, status CONFIRMED/ESTIMATED/UNKNOWN, min, max, basis}]
  lines             jsonb not null check (jsonb_typeof(lines) = 'array'),
  landed_min        bigint,
  landed_max        bigint,
  -- 1) 확인된 비용만 2) 추정 포함 (나쁜 경우 · 좋은 경우) 3) 산출 불가 사유
  confirmed_only    jsonb not null,
  estimated         jsonb,
  insufficient      text[] not null default '{}',
  target_prices     jsonb not null default '[]'::jsonb,
  confidence        confidence_t not null,
  match_level       text not null check (match_level in ('HIGH', 'SIMILAR', 'UNCLEAR')),
  engine            jsonb not null,
  computed_at       timestamptz not null default now(),

  constraint supply_cost_snapshots_owner_id_id_key unique (owner_id, id),
  constraint supply_cost_snapshots_link_input_key unique (owner_id, link_id, input_hash),
  constraint supply_cost_snapshots_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint supply_cost_snapshots_offer_fk foreign key (owner_id, offer_id)
    references public.supply_offers (owner_id, id) on delete cascade,
  constraint supply_cost_snapshots_link_fk foreign key (owner_id, link_id)
    references public.product_supply_links (owner_id, id) on delete cascade
);

create index supply_cost_snapshots_product_idx on public.supply_cost_snapshots (owner_id, product_id, computed_at desc);

create function public.prevent_supply_cost_snapshot_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'supply_cost_snapshots 는 수정할 수 없습니다 (계산 이력 보존 — 새 행으로 쌓습니다)' using errcode = '55000';
end;
$$;
revoke execute on function public.prevent_supply_cost_snapshot_update() from public, anon;

create trigger prevent_supply_cost_snapshot_update before update on public.supply_cost_snapshots
  for each row execute function public.prevent_supply_cost_snapshot_update();

comment on table public.supply_cost_snapshots is '선택한 공급 후보의 원가 · 수익성 계산 이력 (PHASE 19) — 수정 금지, 입력이 바뀌면 새 행';

alter table public.supply_cost_snapshots enable row level security;
create policy supply_cost_snapshots_select_own on public.supply_cost_snapshots for select to authenticated using (owner_id = (select auth.uid()));
create policy supply_cost_snapshots_insert_own on public.supply_cost_snapshots for insert to authenticated with check (owner_id = (select auth.uid()));
create policy supply_cost_snapshots_update_own on public.supply_cost_snapshots for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy supply_cost_snapshots_delete_own on public.supply_cost_snapshots for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.supply_cost_snapshots from anon;
grant select, insert, update, delete on public.supply_cost_snapshots to authenticated;
