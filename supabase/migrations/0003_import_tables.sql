-- JARVIS PHASE 2 · 0003 Import: import_jobs, import_rows
--
-- CSV/Excel 파일과 (향후) 확장프로그램 전송 배치를 같은 구조로 기록한다.
-- 중복 방지: ① file_hash 부분 UNIQUE  ② idempotency_key UNIQUE
--            ③ 대상 테이블 자연키 UPSERT  ④ import_rows 행 단위 결과 + previous_values (롤백)

-- 18) import_jobs -------------------------------------------------------------
create table public.import_jobs (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel         text not null check (channel in ('FILE', 'EXTENSION', 'API', 'MANUAL')),
  import_type     text not null check (
    import_type in (
      'KEYWORD_METRICS',
      'PRODUCT_SNAPSHOTS',
      'SEARCH_RANKS',
      'COMPETITORS',
      'PROFIT_INPUTS',
      'SALES_RESULTS',
      'MIXED'
    )
  ),
  source_type     public.source_type_t not null,
  source_tool     text,
  file_name       text,
  file_size_bytes bigint,
  file_hash       text,
  storage_path    text,
  idempotency_key text,
  schema_version  text,
  column_mapping  jsonb,
  dry_run         boolean not null default false,
  status          text not null default 'PENDING' check (
    status in ('PENDING', 'PROCESSING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'ROLLED_BACK')
  ),
  total_rows      integer not null default 0,
  inserted_rows   integer not null default 0,
  updated_rows    integer not null default 0,
  skipped_rows    integer not null default 0,
  failed_rows     integer not null default 0,
  error_summary   text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint import_jobs_owner_id_id_key unique (owner_id, id),
  constraint import_jobs_owner_idempotency_key unique (owner_id, idempotency_key)
);

-- 같은 파일은 한 번만 성공 처리된다. 실패·롤백·dry run 은 재업로드 허용.
create unique index import_jobs_file_hash_succeeded_key
  on public.import_jobs (owner_id, file_hash, import_type)
  where status in ('SUCCEEDED', 'PARTIAL') and not dry_run;

create index import_jobs_owner_created_idx on public.import_jobs (owner_id, created_at desc);
create index import_jobs_owner_status_idx on public.import_jobs (owner_id, status);

comment on column public.import_jobs.file_hash is '원본 파일 SHA-256. SUCCEEDED/PARTIAL 상태에서만 UNIQUE → 앱은 처리 전에 같은 해시를 조회해 경고한다.';
comment on column public.import_jobs.idempotency_key is '확장프로그램 배치 재전송 방지 키';

-- 19) import_rows -------------------------------------------------------------
create table public.import_rows (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_job_id   uuid not null,
  row_number      integer not null,
  record_key      text,
  payload         jsonb not null,
  result          text not null default 'PENDING' check (result in ('PENDING', 'INSERTED', 'UPDATED', 'SKIPPED', 'FAILED')),
  target_table    text,
  target_id       text,
  previous_values jsonb,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),

  constraint import_rows_job_fk foreign key (owner_id, import_job_id)
    references public.import_jobs (owner_id, id) on delete cascade,
  constraint import_rows_job_row_key unique (import_job_id, row_number)
);

create index import_rows_job_result_idx on public.import_rows (import_job_id, result);
create index import_rows_record_key_idx on public.import_rows (record_key);
-- rollback_import 충돌 검사 (같은 대상을 다른 import가 건드렸는지)
create index import_rows_target_idx on public.import_rows (target_table, target_id);

comment on column public.import_rows.record_key is '자연키 문자열. 예: product_snapshot:8123456:2026-10-06:EXTENSION';
comment on column public.import_rows.previous_values is 'result = UPDATED 일 때 변경 전 행 전체 (rollback_import 복원용)';
