-- JARVIS PHASE 2 · 0007 관심상품: watchlist, watchlist_events
--
-- status = 진행 단계, outcome = 성과 판정 (SUCCESS / FAILED 는 상태가 아니라 결과)
-- 상태 변경 이력은 log_watchlist_status() 트리거가 watchlist_events 에 자동 기록한다 (0010).

-- 13) watchlist ---------------------------------------------------------------
create table public.watchlist (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id        uuid not null,
  keyword_id        uuid,
  status            text not null default 'WATCHING' check (
    status in ('WATCHING', 'SOURCING', 'TESTING', 'SELLING', 'PAUSED', 'SOLD_OUT', 'STOPPED', 'DROPPED')
  ),
  outcome           text check (outcome in ('SUCCESS', 'BREAK_EVEN', 'FAILED')),
  memo              text,
  priority          smallint check (priority between 1 and 5),
  tags              text[] not null default '{}',
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint watchlist_owner_id_id_key unique (owner_id, id),
  constraint watchlist_owner_product_key unique (owner_id, product_id),
  constraint watchlist_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  constraint watchlist_keyword_fk foreign key (owner_id, keyword_id)
    references public.keywords (owner_id, id) on delete set null (keyword_id)
);

create index watchlist_owner_status_idx on public.watchlist (owner_id, status);

comment on column public.watchlist.keyword_id is '발견 키워드';
comment on column public.watchlist.outcome is '성과 판정. NULL = 미판정';

-- 14) watchlist_events --------------------------------------------------------
create table public.watchlist_events (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  watchlist_id uuid not null,
  from_status  text,
  to_status    text not null,
  note         text,
  changed_at   timestamptz not null default now(),

  constraint watchlist_events_watchlist_fk foreign key (owner_id, watchlist_id)
    references public.watchlist (owner_id, id) on delete cascade
);

create index watchlist_events_watchlist_changed_idx on public.watchlist_events (watchlist_id, changed_at);

comment on column public.watchlist_events.from_status is '관심상품 최초 등록 시 NULL';
comment on column public.watchlist_events.note is '같은 트랜잭션에서 set_config(''jarvis.watchlist_note'', ''메모'', true) 로 전달';
