-- PHASE 30: 판정 예측 기록 (검증 루프)
--
-- 기존 predictions 표(PHASE 2 설계 · 수정 불가 트리거)를 그대로 쓴다. 새 표 없음.
-- 자동 발굴 파이프라인이 추적 키워드의 상품마다 "그 데이터 기준일의 판정 · 판매 추정"을 한 번씩 남긴다.
--   model_version       'judge-v2.1 · est-sales-v1' 처럼 판정 · 판매 추정 버전
--   target_period_start 데이터 기준일 (검색 결과 수집일)
--   target_period_end   기준일 + 29일 (한 달)
--   sales_predicted     추정 월 판매 가운데 값 (최소 · 최대 · 판정은 assumptions)
-- 같은 상품 · 같은 버전 · 같은 기준일은 한 번만 (다시 실행해도 중복 없음).

create unique index predictions_judge_once_idx
  on public.predictions (owner_id, product_id, model_version, target_period_start)
  where model_version like 'judge-%';

comment on index public.predictions_judge_once_idx is 'PHASE 30: 판정 예측 기록은 상품 · 버전 · 기준일마다 1행';
