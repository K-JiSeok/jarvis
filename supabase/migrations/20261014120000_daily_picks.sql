-- JARVIS PHASE 24 · 매일 오전 추천 상품 (추가만 — 기존 테이블 변경 없음)
--
-- daily_picks: 매일 오전 예약 작업(Claude)이 고른 상품 최대 3개 · 근거 · 위험 · 소싱 가이드 · 판단에 쓴 숫자 사본.
--   추천은 매입 결정이 아니다. 사용자가 [후보로 선택](관심상품) 하거나 [관심 없음] 으로 답한다 (status).
--   같은 날 다시 고르면 그 날 행을 바꾼다 (pick_date + rank UNIQUE) — 과거 날짜 행은 그대로 남는다.

create table public.daily_picks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pick_date    date not null,
  rank         smallint not null check (rank between 1 and 3),
  product_id   uuid not null,
  title        text not null,
  reason       text not null,
  risks        text[] not null default '{}',
  -- {targetCost, searchTerms[], bundle, note}
  sourcing     jsonb not null default '{}'::jsonb check (jsonb_typeof(sourcing) = 'object'),
  -- 판단에 쓴 값 사본 (판매가 · 추정 판매 · 매출 · 쓸 수 있는 원가 · 등급 · 근거 · 기준 버전)
  metrics      jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  picked_by    text not null check (picked_by in ('CLAUDE_SCHEDULED', 'CLAUDE_MANUAL', 'RULE')),
  status       text not null default 'NEW' check (status in ('NEW', 'SHORTLISTED', 'DISMISSED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint daily_picks_owner_id_id_key unique (owner_id, id),
  constraint daily_picks_day_rank_key unique (owner_id, pick_date, rank),
  constraint daily_picks_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade
);
create index daily_picks_owner_day_idx on public.daily_picks (owner_id, pick_date desc);
create trigger set_updated_at before update on public.daily_picks for each row execute function public.set_updated_at();
comment on table public.daily_picks is '매일 오전 추천 상품 (PHASE 24) — 추천이지 매입 결정이 아니다. 판단에 쓴 숫자 사본 보관';

alter table public.daily_picks enable row level security;
create policy daily_picks_select_own on public.daily_picks for select to authenticated using (owner_id = (select auth.uid()));
create policy daily_picks_insert_own on public.daily_picks for insert to authenticated with check (owner_id = (select auth.uid()));
create policy daily_picks_update_own on public.daily_picks for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy daily_picks_delete_own on public.daily_picks for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.daily_picks from anon;
grant select, insert, update, delete on public.daily_picks to authenticated;
