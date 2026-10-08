-- JARVIS PHASE 10 · 대량 저장 (batch ingestion)
--
-- PHASE 9 의 세 가지 문제를 해결한다. 새 테이블·컬럼은 없다 (함수 2개만 추가).
--   A. 행마다 저장 요청 → ingest_batch(): 한 번의 호출로 배열 전체를 처리
--   B. 트랜잭션 아님    → 함수 호출 = 한 트랜잭션. 시스템 오류면 데이터·job·import_rows 모두 롤백
--   C. 순위 UPSERT 2단계 → upsert_keyword_product_rank(): INSERT … ON CONFLICT DO NOTHING → 잠금 조회 → 갱신
--
-- 행 단위 실패 (기존 부분 성공 정책 유지):
--   검증 오류 (앱이 FAILED/SKIPPED 로 넘긴 행), 데이터 오류 (22xxx · 23502 · 23503 · 23514 · 42501)
--   → 그 행만 import_rows FAILED, 나머지는 계속.
-- 그 밖의 오류 (알 수 없는 레코드 종류, 중복 행 번호, 예상하지 못한 DB 오류) → 전체 롤백 (job 행도 남지 않음).
-- 모두 SECURITY INVOKER → 호출한 사용자의 RLS 그대로. service role 이 필요 없다.

-- upsert_keyword_product_rank(p) ----------------------------------------------
-- 자연키 (keyword_id, product_id, captured_on, source_type, is_ad). 동시에 같은 키가 들어와도 UNIQUE 위반 없음:
--   1) INSERT … ON CONFLICT DO NOTHING (경쟁하는 트랜잭션은 UNIQUE 인덱스에서 기다렸다가 충돌 → 아무것도 안 함)
--   2) 충돌했으면 그 행을 FOR UPDATE 로 잠그고 읽는다 (이전 값 = previous)
--   3) 순위·페이지·신뢰도가 같으면 SKIPPED, 다르면 UPDATED. 새 값이 NULL 인 page 는 기존 값 유지 (NULL 보존)
-- 반환: {"action": INSERTED | UPDATED | SKIPPED, "row": 결과 행, "previous": 변경 전 행}
create function public.upsert_keyword_product_rank(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed constant text[] := array[
    'owner_id', 'keyword_id', 'product_id', 'captured_on', 'captured_at', 'source_type', 'confidence',
    'rank_position', 'is_ad', 'page', 'import_job_id'
  ];
  v_unknown text[];
  r public.keyword_product_ranks;
  v_prev public.keyword_product_ranks;
  v_row public.keyword_product_ranks;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'upsert_keyword_product_rank: payload must be a JSON object' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_unknown from jsonb_object_keys(p) as k where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'upsert_keyword_product_rank: unknown keys %', v_unknown using errcode = '22023';
  end if;

  r := jsonb_populate_record(null::public.keyword_product_ranks, p);
  if r.keyword_id is null or r.product_id is null or r.source_type is null or r.confidence is null
     or r.captured_at is null or r.rank_position is null then
    raise exception 'upsert_keyword_product_rank: keyword_id, product_id, source_type, confidence, captured_at, rank_position are required'
      using errcode = '23502';
  end if;
  r.captured_on := coalesce(r.captured_on, (r.captured_at at time zone 'Asia/Seoul')::date);
  r.is_ad := coalesce(r.is_ad, false);
  r.owner_id := coalesce(r.owner_id, auth.uid());

  insert into public.keyword_product_ranks
    (owner_id, keyword_id, product_id, captured_on, captured_at, source_type, confidence, rank_position, is_ad, page, import_job_id)
  values
    (r.owner_id, r.keyword_id, r.product_id, r.captured_on, r.captured_at, r.source_type, r.confidence, r.rank_position, r.is_ad, r.page, r.import_job_id)
  on conflict (keyword_id, product_id, captured_on, source_type, is_ad) do nothing
  returning * into v_row;
  if found then
    return jsonb_build_object('action', 'INSERTED', 'row', to_jsonb(v_row), 'previous', null);
  end if;

  select * into v_prev
  from public.keyword_product_ranks k
  where k.keyword_id = r.keyword_id and k.product_id = r.product_id and k.captured_on = r.captured_on
    and k.source_type = r.source_type and k.is_ad = r.is_ad
  for update;
  -- 충돌한 행이 보이지 않는다 = RLS 로 가려진 다른 사용자의 행 (upsert_*_snapshot 과 같은 처리)
  if not found then
    raise exception 'upsert_keyword_product_rank: 대상 행에 접근할 수 없습니다 (다른 사용자의 데이터)' using errcode = '42501';
  end if;

  if v_prev.rank_position = r.rank_position
     and v_prev.page is not distinct from coalesce(r.page, v_prev.page)
     and v_prev.confidence = r.confidence then
    return jsonb_build_object('action', 'SKIPPED', 'row', to_jsonb(v_prev), 'previous', to_jsonb(v_prev));
  end if;

  update public.keyword_product_ranks k set
    rank_position = r.rank_position,
    page = coalesce(r.page, k.page),
    confidence = r.confidence,
    captured_at = r.captured_at,
    import_job_id = r.import_job_id
  where k.id = v_prev.id
  returning * into v_row;
  return jsonb_build_object('action', 'UPDATED', 'row', to_jsonb(v_row), 'previous', to_jsonb(v_prev));
end;
$$;

-- ingest_batch(p_job, p_rows) --------------------------------------------------
-- p_job : {channel, import_type, source_type, source_tool?, file_name?, file_size_bytes?, file_hash?,
--          idempotency_key?, schema_version?, column_mapping?}
-- p_rows: [{row_number, record_key?, kind, status: VALID | FAILED | SKIPPED, error_code?, error_message?, payload?, data}]
--   kind = PRODUCT_SNAPSHOT | KEYWORD_SNAPSHOT | KEYWORD_PRODUCT_RANK
--   data = 저장 대상 컬럼 (DB 컬럼명). 상품은 product_id 또는 coupang_product_id, 키워드는 keyword_id 또는 keyword 로 찾는다 (RLS: 본인 것만)
-- 멱등:
--   idempotency_key 가 이미 있으면 처리하지 않고 기존 job 을 돌려준다 ({"replay": true}).
--   file_hash + import_type 이 이미 성공(부분 성공)했으면 23505.
-- 반환: {"replay": bool, "job": import_jobs 행}
create function public.ingest_batch(p_job jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_existing public.import_jobs;
  v_item jsonb;
  v_data jsonb;
  v_kind text;
  v_res jsonb;
  v_result text;
  v_table text;
  v_target text;
  v_prev jsonb;
  v_code text;
  v_msg text;
  v_pid uuid;
  v_kid uuid;
  v_ins integer := 0;
  v_upd integer := 0;
  v_skip integer := 0;
  v_fail integer := 0;
  v_codes jsonb := '{}'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_status text;
  v_summary text;
begin
  if p_job is null or jsonb_typeof(p_job) <> 'object' then
    raise exception 'ingest_batch: p_job must be a JSON object' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ingest_batch: p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'ingest_batch: too many rows (% > 5000)', jsonb_array_length(p_rows) using errcode = '54000';
  end if;

  -- 같은 배치 재전송: 처리하지 않고 기존 결과
  if nullif(p_job ->> 'idempotency_key', '') is not null then
    select * into v_existing from public.import_jobs j where j.idempotency_key = p_job ->> 'idempotency_key';
    if found then
      return jsonb_build_object('replay', true, 'job', to_jsonb(v_existing));
    end if;
  end if;
  -- 같은 파일 재처리 금지 (PHASE 9 정책, 부분 UNIQUE 인덱스와 같은 조건)
  if nullif(p_job ->> 'file_hash', '') is not null then
    select * into v_existing from public.import_jobs j
    where j.file_hash = p_job ->> 'file_hash' and j.import_type = p_job ->> 'import_type'
      and j.status in ('SUCCEEDED', 'PARTIAL') and not j.dry_run
    limit 1;
    if found then
      raise exception 'ingest_batch: 같은 파일을 이미 가져왔습니다' using errcode = '23505', detail = v_existing.id::text;
    end if;
  end if;

  insert into public.import_jobs (
    channel, import_type, source_type, source_tool, file_name, file_size_bytes, file_hash,
    idempotency_key, schema_version, column_mapping, status, total_rows, started_at)
  values (
    p_job ->> 'channel', p_job ->> 'import_type', p_job ->> 'source_type', p_job ->> 'source_tool',
    p_job ->> 'file_name', (p_job ->> 'file_size_bytes')::bigint, nullif(p_job ->> 'file_hash', ''),
    nullif(p_job ->> 'idempotency_key', ''), p_job ->> 'schema_version', p_job -> 'column_mapping',
    'PROCESSING', jsonb_array_length(p_rows), now())
  returning * into v_job;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_kind := v_item ->> 'kind';
    v_data := coalesce(v_item -> 'data', '{}'::jsonb);
    v_result := null;
    v_table := null;
    v_target := null;
    v_prev := null;
    v_code := v_item ->> 'error_code';
    v_msg := v_item ->> 'error_message';

    if v_item ->> 'status' = 'FAILED' then
      v_result := 'FAILED';
    elsif v_item ->> 'status' = 'SKIPPED' then
      v_result := 'SKIPPED';
    elsif coalesce(v_item ->> 'status', 'VALID') <> 'VALID' then
      raise exception 'ingest_batch: unknown row status %', v_item ->> 'status' using errcode = 'P0001';
    else
      begin
        if v_kind = 'PRODUCT_SNAPSHOT' then
          v_pid := nullif(v_data ->> 'product_id', '')::uuid;
          if v_pid is null then
            select p.id into v_pid from public.products p where p.coupang_product_id = v_data ->> 'coupang_product_id';
          end if;
          if v_pid is null then
            v_result := 'FAILED';
            v_code := 'PRODUCT_NOT_FOUND';
            v_msg := format('쿠팡 상품 ID %s: 등록되지 않은 상품입니다.', v_data ->> 'coupang_product_id');
          else
            v_res := public.upsert_product_snapshot(
              (v_data - 'coupang_product_id') || jsonb_build_object('product_id', v_pid, 'import_job_id', v_job.id));
            v_table := 'product_snapshots';
            -- 상품 최근 관측 시각 (이 배치에서 가장 늦은 captured_at)
            if v_seen ->> v_pid::text is null or (v_res #>> '{row,captured_at}')::timestamptz > (v_seen ->> v_pid::text)::timestamptz then
              v_seen := v_seen || jsonb_build_object(v_pid::text, v_res #>> '{row,captured_at}');
            end if;
          end if;
        elsif v_kind = 'KEYWORD_SNAPSHOT' then
          v_kid := nullif(v_data ->> 'keyword_id', '')::uuid;
          if v_kid is null then
            select k.id into v_kid from public.keywords k
            where k.normalized_keyword = lower(regexp_replace(btrim(v_data ->> 'keyword'), '\s+', ' ', 'g'));
          end if;
          if v_kid is null then
            v_result := 'FAILED';
            v_code := 'KEYWORD_NOT_FOUND';
            v_msg := format('키워드 "%s": 등록되지 않은 키워드입니다.', v_data ->> 'keyword');
          else
            v_res := public.upsert_keyword_snapshot(
              (v_data - 'keyword') || jsonb_build_object('keyword_id', v_kid, 'import_job_id', v_job.id));
            v_table := 'keyword_snapshots';
          end if;
        elsif v_kind = 'KEYWORD_PRODUCT_RANK' then
          v_pid := nullif(v_data ->> 'product_id', '')::uuid;
          if v_pid is null then
            select p.id into v_pid from public.products p where p.coupang_product_id = v_data ->> 'coupang_product_id';
          end if;
          v_kid := nullif(v_data ->> 'keyword_id', '')::uuid;
          if v_kid is null then
            select k.id into v_kid from public.keywords k
            where k.normalized_keyword = lower(regexp_replace(btrim(v_data ->> 'keyword'), '\s+', ' ', 'g'));
          end if;
          if v_kid is null then
            v_result := 'FAILED';
            v_code := 'KEYWORD_NOT_FOUND';
            v_msg := format('키워드 "%s": 등록되지 않은 키워드입니다.', v_data ->> 'keyword');
          elsif v_pid is null then
            v_result := 'FAILED';
            v_code := 'PRODUCT_NOT_FOUND';
            v_msg := format('쿠팡 상품 ID %s: 등록되지 않은 상품입니다.', v_data ->> 'coupang_product_id');
          else
            v_res := public.upsert_keyword_product_rank(
              (v_data - 'keyword' - 'coupang_product_id')
              || jsonb_build_object('keyword_id', v_kid, 'product_id', v_pid, 'import_job_id', v_job.id));
            v_table := 'keyword_product_ranks';
          end if;
        else
          -- 프로그램 오류: 전체 롤백
          raise exception 'ingest_batch: unknown record kind %', coalesce(v_kind, '(null)') using errcode = 'P0001';
        end if;

        if v_result is null then
          v_result := v_res ->> 'action';
          v_target := v_res #>> '{row,id}';
          if v_result = 'UPDATED' then v_prev := v_res -> 'previous'; end if;
        end if;
      exception
        when data_exception or not_null_violation or foreign_key_violation or check_violation or insufficient_privilege then
          v_result := 'FAILED';
          v_table := null;
          v_target := null;
          v_prev := null;
          v_code := case
            when sqlstate = '42501' then 'FORBIDDEN'
            when sqlstate = '23503' then 'NOT_FOUND'
            when sqlstate = '23514' then 'OUT_OF_RANGE'
            when sqlstate = '23502' then 'REQUIRED'
            else 'INVALID' end;
          v_msg := sqlerrm;
      end;
    end if;

    if v_result = 'INSERTED' then v_ins := v_ins + 1;
    elsif v_result = 'UPDATED' then v_upd := v_upd + 1;
    elsif v_result = 'SKIPPED' then v_skip := v_skip + 1;
    else
      v_fail := v_fail + 1;
      v_codes := v_codes || jsonb_build_object(coalesce(v_code, 'ERROR'), coalesce((v_codes ->> coalesce(v_code, 'ERROR'))::int, 0) + 1);
    end if;

    insert into public.import_rows
      (import_job_id, row_number, record_key, payload, result, target_table, target_id, previous_values, error_code, error_message)
    values
      (v_job.id, (v_item ->> 'row_number')::integer, v_item ->> 'record_key', coalesce(v_item -> 'payload', '{}'::jsonb),
       v_result, v_table, v_target, v_prev,
       case when v_result in ('FAILED', 'SKIPPED') then v_code end, v_msg);
  end loop;

  -- 상품 최근 관측 시각: 더 최신일 때만 (과거로 되돌리지 않음)
  update public.products p
  set last_seen_at = s.seen
  from (select key::uuid as id, value::timestamptz as seen from jsonb_each_text(v_seen)) s
  where p.id = s.id and s.seen > p.last_seen_at;

  v_status := case when v_fail = 0 then 'SUCCEEDED' when v_ins + v_upd > 0 then 'PARTIAL' else 'FAILED' end;
  select string_agg(format('%s %s', key, value), ', ' order by key) into v_summary from jsonb_each_text(v_codes);

  update public.import_jobs j set
    status = v_status,
    inserted_rows = v_ins,
    updated_rows = v_upd,
    skipped_rows = v_skip,
    failed_rows = v_fail,
    error_summary = v_summary,
    finished_at = now()
  where j.id = v_job.id
  returning * into v_job;

  return jsonb_build_object('replay', false, 'job', to_jsonb(v_job));
end;
$$;

comment on function public.upsert_keyword_product_rank(jsonb) is
  '키워드 순위 1건 원자적 UPSERT (INSERT ON CONFLICT DO NOTHING → FOR UPDATE → 갱신). 반환 {action,row,previous}';
comment on function public.ingest_batch(jsonb, jsonb) is
  '정규화 레코드 배열을 한 트랜잭션으로 저장 + import_jobs/import_rows 기록. 행 데이터 오류는 행 단위 FAILED, 시스템 오류는 전체 롤백';

revoke execute on function public.upsert_keyword_product_rank(jsonb) from public, anon;
revoke execute on function public.ingest_batch(jsonb, jsonb) from public, anon;
grant execute on function public.upsert_keyword_product_rank(jsonb) to authenticated, service_role;
grant execute on function public.ingest_batch(jsonb, jsonb) to authenticated, service_role;
