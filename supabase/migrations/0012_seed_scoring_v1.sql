-- JARVIS PHASE 2 · 0012 점수 버전 v1 seed
--
-- src/config/scoring-weights.ts 의 DEFAULT_SCORE_WEIGHTS / VERDICT_THRESHOLDS 와 정확히 같은 값.
-- weights 키 = TS ScoreFactor 키. DB 점수 컬럼과의 매핑은 factor_definitions.*.column (사전 점검 B-6).
-- 판정: total_score >= 80 → STRONG_BUY, >= 60 → REVIEW, < 60 → EXCLUDE (verdictFromScore 와 동일)
-- 이 버전은 릴리스 후 수정하지 않는다. 가중치를 바꾸려면 새 버전을 추가한다.

insert into public.scoring_versions (version, weights, thresholds, factor_definitions, description, is_active)
values (
  'v1',
  '{
    "demand": 15,
    "salesVolume": 15,
    "salesGrowth": 10,
    "competition": 15,
    "wingEntry": 10,
    "reviewBarrier": 10,
    "conversion": 5,
    "margin": 15,
    "marketStability": 5
  }'::jsonb,
  '{
    "strongBuy": 80,
    "review": 60
  }'::jsonb,
  '{
    "demand":          {"label": "수요",             "column": "demand_score",         "description": "월 검색량 및 검색 추세"},
    "salesVolume":     {"label": "판매량",           "column": "sales_score",          "description": "상위 상품 판매량 규모"},
    "salesGrowth":     {"label": "판매 성장률",      "column": "growth_score",         "description": "최근 판매량 증감"},
    "competition":     {"label": "경쟁 난이도",      "column": "competition_score",    "description": "상품수/검색량, 브랜드 집중도, 가격 경쟁"},
    "wingEntry":       {"label": "WING 진입 가능성", "column": "wing_score",           "description": "상위권 내 WING 판매자 비율"},
    "reviewBarrier":   {"label": "리뷰 장벽",        "column": "review_barrier_score", "description": "상위 상품 리뷰 수 수준"},
    "conversion":      {"label": "전환율",           "column": "conversion_score",     "description": "조회수 대비 판매 전환"},
    "margin":          {"label": "마진",             "column": "margin_score",         "description": "예상 순이익률"},
    "marketStability": {"label": "시장 안정성",      "column": "stability_score",      "description": "계절성, 가격 변동성"}
  }'::jsonb,
  'JARVIS V1 기본 가중치 (PHASE 1 scoring-weights.ts)',
  true
)
on conflict (version) do nothing;
