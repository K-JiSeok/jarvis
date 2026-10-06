-- JARVIS PHASE 2 · 0001 확장 기능과 DOMAIN
-- 기준: docs/PHASE2_DB_DESIGN.md Part B "공통 규칙 / DOMAIN"
--
-- enum 대신 text + CHECK(DOMAIN)을 쓴다. 값 추가·변경이 마이그레이션 1줄로 끝나고,
-- 앱 레벨 union 타입은 src/types/common.ts 가 계속 담당한다.
-- DOMAIN에는 CHECK만 두고 NOT NULL은 각 컬럼에서 지정한다.

-- 상품명 부분 검색(GIN trigram)용. Supabase는 extensions 스키마에 설치한다.
create extension if not exists pg_trgm with schema extensions;

-- 데이터 출처 (src/types/common.ts SOURCE_TYPES 와 동일)
create domain public.source_type_t as text
  constraint source_type_t_check check (
    value in (
      'OFFICIAL_API',
      'COUPANG_PAGE',
      'WING_SESSION',
      'EXTENSION',
      'CALCULATED',
      'MANUAL',
      'ESTIMATED'
    )
  );

-- 데이터 신뢰도 (CONFIDENCE_LEVELS)
create domain public.confidence_t as text
  constraint confidence_t_check check (value in ('A', 'B', 'C'));

-- 최종 판정 (VERDICTS)
create domain public.verdict_t as text
  constraint verdict_t_check check (value in ('STRONG_BUY', 'REVIEW', 'EXCLUDE'));

-- 위험 요소 유형 (RISK_TYPES)
create domain public.risk_type_t as text
  constraint risk_type_t_check check (
    value in (
      'BRAND_MONOPOLY',
      'REVIEW_OVERLOAD',
      'PRICE_WAR',
      'COUPANG_PB',
      'LOW_MARGIN',
      'BULKY_HEAVY',
      'SEASONALITY',
      'AD_DEPENDENCY'
    )
  );

-- 위험 수준 (RiskSeverity)
create domain public.risk_level_t as text
  constraint risk_level_t_check check (value in ('LOW', 'MEDIUM', 'HIGH'));
