-- JARVIS PHASE 2 · 수정 방지 트리거 (GPT 결정 ② A안)
--
-- 학습 기준 데이터(과거 점수 · 예측 · 점수 버전 정의)를 덮어쓰지 못하게 한다.
-- 새 계산 / 새 예측 / 새 점수 체계는 항상 새 행으로 추가한다.
-- DELETE 는 허용한다 (오입력 정리용). 다른 행이 참조 중이면 기존 FK 가 삭제를 막는다.
-- 트리거는 역할과 무관하게 동작한다 (service_role · postgres 포함).
--
-- FK 의 ON DELETE SET NULL 도 내부적으로 UPDATE 이므로,
-- 참조 컬럼이 "값 → NULL" 로 바뀌는 경우만 예외로 허용한다 (참조 대상이 삭제된 경우).
--
-- 오류: SQLSTATE P0001, 메시지 'IMMUTABLE: …'

-- scoring_versions ------------------------------------------------------------
-- 보호: version, weights, thresholds, factor_definitions, released_at
-- 허용: is_active (활성 버전 전환), retired_at (폐기 시점), description (설명 보완)
create function public.prevent_scoring_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version
     or new.weights is distinct from old.weights
     or new.thresholds is distinct from old.thresholds
     or new.factor_definitions is distinct from old.factor_definitions
     or new.released_at is distinct from old.released_at then
    raise exception 'IMMUTABLE: scoring version % 의 정의는 수정할 수 없습니다. 새 scoring version 을 추가하세요.', old.version
      using errcode = 'P0001',
            hint = '변경 가능: is_active, retired_at, description';
  end if;
  return new;
end;
$$;

create trigger prevent_scoring_version_mutation before update on public.scoring_versions
  for each row execute function public.prevent_scoring_version_mutation();

-- opportunity_scores ----------------------------------------------------------
-- 허용: is_current 변경, keyword_id → NULL (키워드 삭제 시 FK SET NULL)
-- 그 밖의 모든 컬럼(점수 · 세부 점수 · verdict · calculated_at · scoring_version · input_refs …) 변경 차단
create function public.prevent_opportunity_score_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['is_current', 'keyword_id']) is distinct from (to_jsonb(old) - array['is_current', 'keyword_id'])
     or (new.keyword_id is distinct from old.keyword_id and new.keyword_id is not null) then
    raise exception 'IMMUTABLE: opportunity_scores % 는 수정할 수 없습니다. 새 점수는 새 행으로 추가하세요.', old.id
      using errcode = 'P0001',
            hint = '변경 가능: is_current';
  end if;
  return new;
end;
$$;

create trigger prevent_opportunity_score_mutation before update on public.opportunity_scores
  for each row execute function public.prevent_opportunity_score_mutation();

-- predictions -----------------------------------------------------------------
-- 허용: listing_id / opportunity_score_id / profit_calculation_id → NULL (참조 대상 삭제 시 FK SET NULL)
-- 그 밖의 UPDATE 는 모두 차단
create function public.prevent_prediction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fk_cols constant text[] := array['listing_id', 'opportunity_score_id', 'profit_calculation_id'];
begin
  if (to_jsonb(new) - v_fk_cols) is distinct from (to_jsonb(old) - v_fk_cols)
     or (new.listing_id is distinct from old.listing_id and new.listing_id is not null)
     or (new.opportunity_score_id is distinct from old.opportunity_score_id and new.opportunity_score_id is not null)
     or (new.profit_calculation_id is distinct from old.profit_calculation_id and new.profit_calculation_id is not null) then
    raise exception 'IMMUTABLE: predictions % 는 수정할 수 없습니다. 새 예측은 새 행으로 추가하세요.', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger prevent_prediction_mutation before update on public.predictions
  for each row execute function public.prevent_prediction_mutation();

-- 권한 --------------------------------------------------------------------------
-- 0011 의 "alter default privileges in schema public revoke execute … from public" 은
-- 스키마 단위 기본 권한이라 PUBLIC 의 전역 기본 EXECUTE 를 취소하지 못한다.
-- 그래서 새 함수는 개별로 PUBLIC / anon 실행 권한을 회수한다. (트리거 함수는 직접 호출할 수 없지만 일관성 유지)
revoke execute on function public.prevent_scoring_version_mutation() from public, anon;
revoke execute on function public.prevent_opportunity_score_mutation() from public, anon;
revoke execute on function public.prevent_prediction_mutation() from public, anon;
