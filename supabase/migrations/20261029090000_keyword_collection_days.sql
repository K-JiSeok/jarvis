-- PHASE 29: 키워드별 검색 결과 수집일
--
-- 왜: Supabase API 는 한 번에 1,000행만 돌려준다. keyword_product_ranks 는 수집 1회에 키워드당 60~80행씩 쌓여
--     곧 1,000행을 넘는다. 그러면 "마지막 수집일 · 수집 횟수"를 행 전체에서 고르는 방식은 조용히 틀린다
--     (확장 프로그램 자동 수집 대상 · 키워드 기회 화면). 날짜 단위로 묶은 뷰를 읽는다.
-- 읽기 전용 뷰. security_invoker 라서 RLS(본인 행만)가 그대로 적용된다.

create view public.v_keyword_collection_days
with (security_invoker = true)
as
select
  r.owner_id,
  r.keyword_id,
  r.captured_on,
  count(*)::int as cells,
  (count(*) filter (where not r.is_ad))::int as organic_cells,
  count(distinct r.product_id)::int as products
from public.keyword_product_ranks r
group by r.owner_id, r.keyword_id, r.captured_on;

comment on view public.v_keyword_collection_days is 'PHASE 29: 키워드 · 수집일별 검색 결과 칸 수 (1,000행 제한 없이 수집 이력을 읽기 위한 집계)';
