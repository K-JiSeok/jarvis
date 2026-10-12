-- JARVIS PHASE 17 · 자동 발굴 파이프라인 (추가만 — 기존 테이블 · 함수 · Score V1 · Profit 변경 없음)
--
-- 1) automation_runs       자동 실행 1회 = 1행. 단계별 결과 · 오류 · 요약. 사용자당 RUNNING 1개만 (중복 실행 방지)
-- 2) keyword_candidates    자동 발견 키워드 후보 (네이버 검색광고 키워드 도구의 연관 키워드 — 공식 API).
--                          등록 키워드(keywords)와 분리한다: 후보를 만들었다고 수요가 있다고 보지 않는다
-- 3) product_compliance    판매 가능성 사전 검토 (판매 금지 · 인증 · 브랜드 증빙 · 공급) — 점수와 별도.
--                          자동 판단은 BLOCKED · CLEARED 를 만들지 않는다 (사용자 확인만). 사용자 판단은 자동 실행이 덮어쓰지 않는다
--
-- 모두 owner_id + RLS (기존 18개 테이블과 같은 4개 정책), FK 는 owner_id 를 포함한 복합 FK.

-- 1) automation_runs ------------------------------------------------------------
create table public.automation_runs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  triggered_by text not null check (triggered_by in ('MANUAL', 'EXTENSION_ALARM')),
  status       text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  steps        jsonb not null default '[]'::jsonb,
  summary      jsonb not null default '{}'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),

  constraint automation_runs_owner_id_id_key unique (owner_id, id),
  constraint automation_runs_finished_check check ((status = 'RUNNING') = (finished_at is null))
);

-- 사용자당 실행 중 1개만: 두 번째 INSERT 는 23505 → 중복 실행 거부
create unique index automation_runs_one_running_key on public.automation_runs (owner_id) where status = 'RUNNING';
create index automation_runs_owner_started_idx on public.automation_runs (owner_id, started_at desc);

comment on table public.automation_runs is '자동 발굴 실행 기록 (PHASE 17). steps = 단계별 {name, status, counts, error}';

-- 2) keyword_candidates ---------------------------------------------------------
create table public.keyword_candidates (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword             text not null check (length(btrim(keyword)) between 1 and 100),
  normalized_keyword  text not null,
  source_type         source_type_t not null,
  source_tool         text not null,
  seed_keyword_id     uuid,
  seed_keyword        text not null,
  monthly_pc          integer check (monthly_pc >= 0),
  monthly_mobile      integer check (monthly_mobile >= 0),
  search_volume       integer check (search_volume >= 0),
  below_10            boolean not null default false,
  comp_idx            text,
  status              text not null default 'NEW' check (status in ('NEW', 'PROMOTED', 'DISMISSED')),
  promoted_keyword_id uuid,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  last_seen_on        date not null,
  seen_count          integer not null default 1 check (seen_count >= 1),
  run_id              uuid,

  constraint keyword_candidates_owner_id_id_key unique (owner_id, id),
  constraint keyword_candidates_owner_normalized_key unique (owner_id, normalized_keyword),
  -- 검색량을 모르면(10 미만) 합계는 NULL — 0 으로 채우지 않는다
  constraint keyword_candidates_below10_check check (not below_10 or search_volume is null),
  constraint keyword_candidates_seed_fk foreign key (owner_id, seed_keyword_id)
    references public.keywords (owner_id, id) on delete set null (seed_keyword_id),
  constraint keyword_candidates_promoted_fk foreign key (owner_id, promoted_keyword_id)
    references public.keywords (owner_id, id) on delete set null (promoted_keyword_id),
  constraint keyword_candidates_run_fk foreign key (owner_id, run_id)
    references public.automation_runs (owner_id, id) on delete set null (run_id)
);

create index keyword_candidates_owner_status_idx on public.keyword_candidates (owner_id, status, search_volume desc nulls last);
create index keyword_candidates_seed_day_idx on public.keyword_candidates (owner_id, seed_keyword_id, last_seen_on);

comment on table public.keyword_candidates is '자동 발견 키워드 후보 (PHASE 17). 네이버 검색광고 연관 키워드 = 네이버 검색 수요 참고 지표, 쿠팡 검색량 아님';

-- 3) product_compliance ---------------------------------------------------------
create table public.product_compliance (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id   uuid not null,
  status       text not null check (status in (
                 'BLOCKED', 'REQUIRES_CERTIFICATION', 'REQUIRES_BRAND_PROOF', 'MANUAL_REVIEW', 'CLEARED', 'UNKNOWN')),
  -- 영역별 판단 [{area, status, rule, evidence, source, checkedAt, method}] — 근거 · 출처 · 확인 시점 · 자동/사용자
  findings     jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  decided_by   text not null check (decided_by in ('AUTO', 'USER')),
  rule_version text,
  user_note    text,
  checked_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint product_compliance_owner_id_id_key unique (owner_id, id),
  constraint product_compliance_owner_product_key unique (owner_id, product_id),
  constraint product_compliance_product_fk foreign key (owner_id, product_id)
    references public.products (owner_id, id) on delete cascade,
  -- 자동 판단은 판매 금지 확정 · 확인 완료를 만들 수 없다
  constraint product_compliance_auto_status_check check (decided_by = 'USER' or status not in ('BLOCKED', 'CLEARED'))
);

create trigger set_updated_at before update on public.product_compliance
  for each row execute function public.set_updated_at();

comment on table public.product_compliance is '판매 가능성 사전 검토 (PHASE 17) — 점수와 별도. 법률 판단 · 쿠팡 판매 승인이 아니다';

-- RLS (기존 owner 테이블과 같은 4개 정책) -------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['automation_runs', 'keyword_candidates', 'product_compliance']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',
      t || '_delete_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
