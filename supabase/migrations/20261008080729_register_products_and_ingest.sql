-- PHASE 12: 검색 결과에서 사용자가 고른 상품 등록 + 검색 데이터 저장을 한 트랜잭션으로.
--
-- 새 테이블 · 컬럼 · 상태값 없음. ingest_batch 는 그대로 부른다 (저장 로직을 중복해서 만들지 않는다).
--
--   register_products_and_ingest(p_keyword, p_products, p_job, p_rows)
--     1. 같은 idempotency_key 의 job 이 있으면 아무것도 만들지 않고 기존 결과 (replay)
--     2. p_keyword 가 있으면 키워드 등록 (이미 있으면 그대로)              ← 사용자가 [키워드도 등록] 을 고른 경우만
--     3. p_products 의 상품 등록 (owner + 쿠팡 상품 ID 가 이미 있으면 그대로) ← 사용자가 고른 상품만
--     4. ingest_batch(p_job, p_rows) — 순위 · 상품 스냅샷 · 키워드 스냅샷
--     5. 저장 행 중 하나라도 FAILED 면 예외 → 1~4 전부 롤백 ("상품 등록 3/5 → 오류 → 전부 취소")
--
-- 반환: ingest_batch 결과 + {created_products, existing_products, created_product_ids, keyword_created}
-- SECURITY INVOKER: RLS 그대로 (owner_id = auth.uid() 기본값)

create function public.register_products_and_ingest(p_keyword jsonb, p_products jsonb, p_job jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.import_jobs;
  v_item jsonb;
  v_id text;
  v_name text;
  v_new uuid;
  v_created integer := 0;
  v_already integer := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_keyword_created boolean := false;
  v_keyword text;
  v_res jsonb;
begin
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'register_products_and_ingest: p_products must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_products) > 100 then
    raise exception 'register_products_and_ingest: too many products (% > 100)', jsonb_array_length(p_products) using errcode = '54000';
  end if;

  -- 같은 요청 재전송: 상품도 다시 만들지 않는다
  if nullif(p_job ->> 'idempotency_key', '') is not null then
    select * into v_existing from public.import_jobs j where j.idempotency_key = p_job ->> 'idempotency_key';
    if found then
      return jsonb_build_object('replay', true, 'job', to_jsonb(v_existing),
        'created_products', 0, 'existing_products', jsonb_array_length(p_products), 'created_product_ids', '[]'::jsonb, 'keyword_created', false);
    end if;
  end if;

  if p_keyword is not null and jsonb_typeof(p_keyword) = 'object' then
    v_keyword := btrim(regexp_replace(coalesce(p_keyword ->> 'keyword', ''), '\s+', ' ', 'g'));
    if v_keyword = '' then
      raise exception 'register_products_and_ingest: keyword is empty' using errcode = '22023';
    end if;
    insert into public.keywords (keyword, normalized_keyword, memo)
    values (v_keyword, lower(v_keyword), nullif(p_keyword ->> 'memo', ''))
    on conflict (owner_id, normalized_keyword) do nothing
    returning true into v_keyword_created;
    v_keyword_created := coalesce(v_keyword_created, false);
  end if;

  for v_item in select value from jsonb_array_elements(p_products) loop
    v_id := btrim(v_item ->> 'coupang_product_id');
    v_name := btrim(regexp_replace(coalesce(v_item ->> 'product_name', ''), '\s+', ' ', 'g'));
    if v_id is null or v_id !~ '^\d{1,20}$' then
      raise exception 'register_products_and_ingest: invalid coupang_product_id %', v_id using errcode = '22023';
    end if;
    if v_name = '' then v_name := '쿠팡 상품 ' || v_id; end if;
    v_new := null;
    insert into public.products (coupang_product_id, product_name, product_url)
    values (v_id, left(v_name, 300), 'https://www.coupang.com/vp/products/' || v_id)
    on conflict (owner_id, coupang_product_id) do nothing
    returning id into v_new;
    if v_new is null then
      v_already := v_already + 1;
    else
      v_created := v_created + 1;
      v_created_ids := v_created_ids || to_jsonb(v_new::text);
    end if;
  end loop;

  v_res := public.ingest_batch(p_job, p_rows);

  if not (v_res ->> 'replay')::boolean and coalesce((v_res -> 'job' ->> 'failed_rows')::integer, 0) > 0 then
    raise exception 'register_products_and_ingest: % rows failed (전부 롤백)', v_res -> 'job' ->> 'failed_rows'
      using errcode = 'P0001', detail = coalesce(v_res -> 'job' ->> 'error_summary', '');
  end if;

  return v_res || jsonb_build_object('created_products', v_created, 'existing_products', v_already,
    'created_product_ids', v_created_ids, 'keyword_created', v_keyword_created);
end;
$$;

comment on function public.register_products_and_ingest(jsonb, jsonb, jsonb, jsonb) is
  '검색 결과에서 사용자가 고른 상품(· 키워드) 등록 + ingest_batch 를 한 트랜잭션으로. 저장 행이 하나라도 실패하면 전부 롤백';

revoke execute on function public.register_products_and_ingest(jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.register_products_and_ingest(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
