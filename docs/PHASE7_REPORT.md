# JARVIS PHASE 7 — Opportunity Score 실제 데이터 연결 · 완료 보고서

작성일: 2026-10-08 · 저장소: `K-JiSeok/jarvis` (main)

---

## 1. 구현 요약

- **순수 점수 엔진** `src/lib/scoring/engine.ts` — `calculateOpportunityScore(input, config)`. DB 접근 없음 (`DB → ScoreInput → 순수 함수 → ScoreResult → DB 저장`).
- **가중치·판정 기준은 DB `scoring_versions` v1 에서 읽는다.** 코드 상수(`scoring-weights.ts`)와 다르면 계산을 멈춘다. V1 은 수정하지 않았고 V2 도 만들지 않았다.
- **9개 요소 모두 실제 DB 데이터만 사용한다.** 데이터가 없는 요소는 0점이 아니라 **미계산(NULL)**.
- **총점·판정은 9개 요소가 모두 계산될 때만** 내고 저장한다. 부족하면 화면에 "분석 데이터 부족", 확보 점수, 가능 범위를 보여 주고 저장하지 않는다.
- **저장:** 기존 `opportunity_scores` 구조. 재계산하면 이전 현재 행 `is_current = false` → 새 행 INSERT (이력 보존, 수정 방지 트리거 유지).
- **재현 정보:** 요소별 원본 값·출처·신뢰도·수집일, 근거 문장, 사용한 경쟁상품·스냅샷·수익성 결과 id 를 `input_refs` 에 남긴다.
- **UI:** `/products/[id]` 에 Opportunity Score 영역 추가 (총점, 판정, 요소별 점수·근거·원본 데이터, 신뢰도, 계산일, Scoring Version, 맥락 키워드 선택, 점수 다시 계산, 위험 요소, 점수 이력). `/products` 에 점수 열과 판정 필터 추가.
- Chrome Extension, 자동 재계산, Dashboard LIVE 전환은 하지 않았다.

---

## 2. 실제 Score 계산 구조

요소 점수는 0~100 (기존 컬럼 정의: "요소 점수는 0~100 정규화 값. 가중합 = total_score"), 총점 = Σ(가중치 × 요소 점수 ÷ 100).
정규화 구간은 엔진 버전 `score-engine-v1` 의 정의다 (`RULES` 상수, 구간 선형 보간). 아래 표의 "→" 는 그 구간이다.

| 요소 (가중치) | 사용하는 실제 데이터 | 계산 | 미계산 조건 |
|---|---|---|---|
| **수요** (15) | 맥락 키워드의 `v_keyword_latest.search_volume`, `search_growth_rate` | 월 검색량 0→0, 1천→20, 5천→50, 2만→80, 5만+→100. 검색량 증감률이 있으면 ±10점 가감 (증감률 × 20). 증감률이 없으면 가감 없음 | 키워드 없음 또는 검색량 NULL |
| **판매량** (15) | 대상 상품 + **활성** 경쟁상품의 `v_product_latest.sales_actual` → 없으면 `sales_estimated` (집계 기간 포함). `predicted` 는 쓰지 않음 | 상품별 30일 환산 → **중앙값**. 0→0, 30→20, 100→50, 300→80, 1,000+→100 | 판매량 또는 집계 기간이 모두 없음 |
| **판매 성장률** (10) | 대상 상품의 `product_snapshots` (제외된 행 빼고). 같은 종류(실제끼리 / 추정끼리)만 비교 | 최근 90일 안 가장 오래된 값 → 최신 값 증감률. −50%→0, 0%→50, +50%→80, +100%→100. 기준 0 → 최신 >0 이면 100, 둘 다 0 이면 50 | 같은 종류 2회 미만 또는 간격 7일 미만 |
| **경쟁 난이도** (15) | 키워드 `competition_intensity`(상품수/검색량), `brand_concentration` + 활성 경쟁상품 가격 중앙값 vs 내 판매가(대표 시나리오 판매가 → 없으면 현재 판매가) | 있는 지표의 평균 (높을수록 진입 쉬움). 상품수/검색량 0.5→100 … 30→0, 브랜드 집중도 10%→100, 30%→60, 60%→0, 가격 비율 0.9→100, 1.0→70, 1.2→30, 1.5→0 | 세 지표가 모두 없음 |
| **WING 진입** (10) | 키워드 `wing_ratio` → 없으면 활성 경쟁상품의 `seller_type_observed` (알려진 3개 이상일 때 WING 판매자 비율) | 0→0, 20%→40, 50%→80, 70%+→100 | 둘 다 없음 |
| **리뷰 장벽** (10) | 활성 경쟁상품 `review_count` 중앙값 → 없으면 키워드 `average_reviews` | 50 이하→100, 200→80, 1천→50, 3천→20, 1만+→0 | 둘 다 없음 |
| **전환율** (5) | 대상 + 활성 경쟁상품 `conversion_rate` (WING 등에서 입력된 값) 중앙값 | 0→0, 2%→40, 5%→70, 10%+→100 | 데이터 없음 (임의 전환율을 만들지 않음) |
| **마진** (15) | 대표 시나리오의 현재 `profit_calculations.net_margin_rate` (PHASE 6 결과 그대로) | 0% 이하→0, 10%→30, 20%→60, 30%→85, 40%+→100 | 대표 시나리오 현재 결과 없음 |
| **시장 안정성** (5) | 대상 상품 `product_snapshots` 가격 이력 (최근 180일) | 가격 변동계수 2% 이하→100, 5%→80, 10%→50, 25%+→0 | 가격 기록 3회 미만 |

- **경쟁관계:** `competitors.is_active = true` 만 사용한다. 관계 유형(SIMILAR / SAME_PRODUCT / SUBSTITUTE)은 원본 데이터 기록에 남기지만 관계별 가중치는 없다.
- **맥락 키워드:** 상품에 연결된 키워드(관심상품 발견 키워드 → 검색 순위 키워드 → 경쟁관계 키워드 순)를 기본값으로 쓰고, 화면에서 바꾸거나 "키워드 없음"을 고를 수 있다. 점수는 키워드 맥락별로 따로 저장된다 (기존 unique 키가 `(상품, 키워드, 버전)`).
- **데이터 시점:** 각 원본 값의 수집일·출처·신뢰도를 기록한다. 현재 값 입력의 수집일 차이가 30일을 넘으면 주의 근거를 남긴다. 성장률·안정성은 원래 날짜가 다른 이력을 비교하는 요소라 이 범위 계산에서 뺀다.
- **데이터 신뢰도(`data_confidence`):** 사용한 입력 중 가장 낮은 신뢰도 (A > B > C).
- **근거(`reasons`):** 요소 점수 70 이상은 가점, 30 이하는 주의, 미계산·수집일 차이·C 신뢰도는 주의 (기존 `ScoreReason` 형식).

---

## 3. 데이터 부족 처리 방식

- **NULL 과 0 구분:** 입력 값이 NULL 이면 그 요소는 `score = null` (미계산)이다. 입력이 실제 0 이면(판매량 0, 전환율 0 등) 구간에 따라 0점이다. 테스트로 확인했다 (판매량 NULL → 미계산, 실제 0 → 0점).
- **기존 구조 확인 결과:** `opportunity_scores` 의 요소 점수 컬럼과 `data_confidence` 는 NULL 을 허용하고 `missing_factors text[]` 가 있다. 하지만 **`total_score` 와 `verdict` 는 NOT NULL** 이다.
- **그래서 정한 방식:**
  - 9개 요소가 모두 계산되면 총점·판정을 내고 저장한다 (`missing_factors = '{}'`).
  - 하나라도 미계산이면 **총점·판정을 내지 않고 저장하지 않는다.** 미계산을 0점으로 넣어 총점을 만들면 데이터 부족 상품이 EXCLUDE 로 둔갑하고, 계산된 요소만으로 다시 나누면 가중치가 바뀌기 때문이다.
  - 화면에는 "분석 데이터 부족", 계산된 n/9개, 확보 점수 / 계산된 가중치 합, **가능 범위**(미계산이 모두 0점 ~ 모두 만점일 때)를 보여 준다.
  - 가능 범위 전체가 같은 판정 구간이면 "미계산 항목과 관계없이 ○○ 구간"이라고 표시한다. 저장은 하지 않는다.
  - 요소마다 "필요: …"로 어떤 데이터가 있어야 계산되는지 보여 준다.
- 데이터 부족으로 저장하지 않을 때 이전 저장 점수는 그대로 둔다 (현재 해제하지 않음).

---

## 4. Score 저장 구조

- **`scoring_versions`:** 활성 버전(v1)의 `weights`, `thresholds`, `factor_definitions.label` 을 읽어 엔진에 주입한다. `diffWithCodeWeights()` 로 코드 상수와 비교해 다르면 오류로 멈춘다. v1 행은 읽기만 한다.
- **`opportunity_scores` 컬럼 사용:**

| 컬럼 | 값 |
|---|---|
| `product_id`, `keyword_id` | 대상 상품, 맥락 키워드 (없으면 NULL) |
| `scoring_version` | `v1` |
| `total_score`, `verdict` | 9개 요소가 모두 있을 때의 총점·판정 |
| `demand_score` … `stability_score` | 요소 점수 0~100 (`factor_definitions.column` 매핑) |
| `data_confidence` | 입력 중 최저 신뢰도 |
| `missing_factors` | 저장되는 행은 항상 `{}` |
| `reasons` | `ScoreReason[]` |
| `input_refs` | `engine`, `as_of`, `keyword_id/keyword`, `profit_scenario_id`, `profit_calculation_id`, 활성 경쟁상품(id·관계 유형), 사용한 `product_snapshot_ids`, `date_range`, `factors.{요소}.{score, points, weight, basis, missing, inputs[{name, value, source, confidence, captured_on, ref}]}` |
| `extra_factor_scores` | 사용하지 않음 (기본값 `{}`) |

- **재계산:** 같은 (상품, 키워드, 버전)의 현재 행을 `is_current = false` → 새 행 INSERT. INSERT 가 실패하면 내렸던 행을 되돌린다. 기존 행의 값은 수정 방지 트리거 때문에 바꿀 수 없다 (`is_current` 만 변경 가능).
- **조회:** `v_current_scores`(활성 버전의 현재 점수). 목록은 상품마다 가장 최근 계산 1개를 쓴다.
- 점수 자체의 출처는 CALCULATED (`source: "CALCULATED"`, 화면 "자체 계산"). 원본 데이터의 source/confidence 는 `input_refs` 에 보존된다.

---

## 5. Profit 연결

- 마진 요소는 **대표 시나리오(`is_primary`)의 현재 결과(`is_current = true`)의 `net_margin_rate`** 를 그대로 쓴다. PHASE 6 계산식은 복제하거나 다시 실행하지 않는다.
- `input_refs.profit_calculation_id`, `profit_scenario_id` 에 그 결과를 기록한다. 새 FK 는 만들지 않았다 (JSON 참조, DB 테스트에서 조인으로 찾아지는 것 확인).
- 경쟁 난이도의 가격 비율은 대표 시나리오 판매가(없으면 현재 판매가)를 쓴다.
- 대표 시나리오가 없거나 현재 결과가 없으면(필수값 미입력) 마진은 미계산이다.

---

## 6. 변경 파일

| 파일 | 내용 |
|---|---|
| `src/lib/scoring/engine.ts` | **신규** — 순수 점수 엔진 (요소 9개, 정규화 구간, 범위·확정 판정, 근거, 신뢰도, 수집일 범위) |
| `src/lib/scoring/verdict.ts` | 판정 규칙을 엔진의 `verdictFor` 로 일원화 (동작 동일) |
| `src/lib/repositories/opportunity.ts` | **신규** — scoring_versions 읽기·검증, DB → ScoreInput, 미리 보기, 재계산·저장, 현재 점수·이력·위험 요소 조회, 맥락 키워드 후보 |
| `src/lib/repositories/scores.ts` | **삭제** — 쓰이지 않던 PHASE 2 조회 함수 (opportunity.ts 로 대체) |
| `src/types/score.ts` | **신규** — 저장된 점수 · 맥락 키워드 · 위험 요소 도메인 타입 |
| `src/app/products/score-actions.ts` | **신규** — "점수 다시 계산" Server Function |
| `src/components/score/score-card.tsx` | **신규** — 상품 상세 Opportunity Score 영역 |
| `src/components/score/score-recalc-button.tsx` | **신규** — 다시 계산 버튼 |
| `src/app/products/[id]/page.tsx` | Opportunity Score 카드 추가 (`?score_kw=` 맥락 키워드) |
| `src/app/products/page.tsx` | 점수 판정 필터 (전체 / 강력추천 / 검토 / 제외 / 미계산) |
| `src/components/products/products-table.tsx` | 점수 열 (총점 + 판정, 없으면 "미계산") |
| `scripts/scoring/test.mjs` | **신규** — 엔진 테스트 |
| `supabase/verify/phase2_verify.sql` | SC01~SC13 추가 |
| `package.json` | `test:score` 스크립트 |

---

## 7. DB Migration

```text
DB 변경 없음
```

새 테이블·컬럼·migration 없음. 기존 `scoring_versions` / `opportunity_scores` / `product_risks` / 뷰를 그대로 사용했다.

---

## 8. UI 변경

### `/products/[id]` — Opportunity Score 카드 (수익성 분석 위)

- 저장된 현재 점수: 총점 / 100, 판정 배지, 계산 시각, Scoring Version, 엔진 버전, 맥락 키워드, 데이터 신뢰도, "자체 계산".
- 맥락 키워드 선택 + "미리 보기", "점수 다시 계산" (저장 결과 또는 "분석 데이터 부족 — n개 항목을 계산할 수 없어 저장하지 않았습니다" 표시).
- 현재 데이터 기준 계산: 총점·판정 또는 "분석 데이터 부족"(계산된 n/9, 확보 점수, 가능 범위, 확정 판정).
- 요소별 표: 항목, 점수(점수 / 가중치, 없으면 "미계산"), 근거, 필요한 데이터, 원본 데이터(값·출처·신뢰도·수집일), 저장값.
- 근거 목록(가점 / 주의), 위험 요소(`product_risks` 활성 항목, "점수에 반영하지 않음"), 점수 이력(최근 10개).

### `/products`

- "점수" 열: 저장된 현재 총점 + 판정. 없으면 "미계산".
- 판정 필터: 전체 / 강력추천 / 검토 / 제외 / 미계산. 기존 상태 필터와 함께 쓸 수 있다.

### `/dashboard`

- 변경 없음 (DEMO 유지). 대시보드에서 쓸 수 있도록 `listCurrentScoresByProduct()` (활성 버전 현재 점수, 상품별 최신) 조회 함수를 준비해 두었다.

---

## 9. 테스트 결과

```text
Score calculation (npm run test:score):   22/22
DB 회귀 (npm run db:verify, PGlite):      170/170   (기존 157 + SC 13)
  └ Score 저장·재계산·불변·RLS (SC01~13): 13/13
RLS · 불변 (원격 Supabase, 롤백):            9/9
UI (로그인 세션, [TEST] 데이터):              9/9
Profit calculation (회귀):                  20/20
Typecheck:                                  PASS
Lint:                                       PASS
Build:                                      PASS
```

**엔진 22개:** 가중치 합 100·V1 값·판정 기준 80/60, 최대점수(9개 100 → 100, STRONG_BUY), 최소점수(실제 0 데이터 → 0, EXCLUDE), 총점 가중합·100 초과 없음, STRONG_BUY / EXCLUDE 사례, 판정 경계(80 / 79.99 / 60 / 59.99), REVIEW 사례(71.5), 데이터 부족(총점·판정 null), NULL ≠ 0, 판매량 실제 우선·추정·기간 환산, 데이터 부족 + 확정 판정, 범위가 경계를 넘으면 확정 없음, 해제된 경쟁관계 제외, 관계 유형 기록·가중치 없음, 성장(7일 미만·종류 혼합 비교 안 함), WING 대체 계산(3개 이상), 전환율 없음 → 미계산, 마진(PHASE 6 값·참조 id), 안정성 3회 미만, 신뢰도 최저값·수집일 범위, 이력 요소는 수집일 범위에서 제외, 보간·중앙값.

**PGlite SC 13개:** 엔진 형태 저장, input_refs 로 PHASE 6 결과 조인, 원본 출처·신뢰도·수집일 보존, 재계산(이력 2·현재 1·이전 값 보존), 키워드 맥락별 현재 점수 공존, 같은 맥락 현재 2개 차단(23505), 이전 점수 수정 차단(P0001), 없는 버전 차단(23503), total_score NULL 저장 불가(23502), v1 가중치·판정 기준 그대로, B → A 상품 점수 저장 불가(23503), B 의 현재 해제 0행, A 점수 보존.

**원격 9개:** A 점수 수정 P0001, A 판정 수정 P0001, A 현재 점수 조회, B 조회 0/0, B → A 상품 저장 23503, B 현재 해제 0행, B 삭제 0행, B 의 scoring_versions 조회 가능(전역 설정), A 보존.

**UI 9개** (실제 로그인 세션, [TEST] 키워드 1·상품 6·경쟁관계 4(1개 해제)·스냅샷 8·순위 1·수익성 1):

1. 미리 보기 71.03 / 검토 — 손으로 계산한 값(9.9 + 10.88 + 8 + 8.66 + 7.33 + 6.5 + 3 + 11.76 + 5)과 일치
2. "점수 다시 계산" → 71.03 저장. DB 요소 점수 9개·data_confidence B·input_refs(엔진·키워드·수익성 id·경쟁 3개·원본 값)가 화면과 일치
3. 해제된 경쟁상품(리뷰 99,999)은 리뷰 장벽·가격 비교에서 빠짐
4. "키워드 없음" 맥락: 수요 미계산, 확보 63.16 / 85, 범위 63.16~78.16, "검토 구간" 확정 표시, WING 은 경쟁상품 판매자 유형으로 계산(2/3)
5. 그 상태에서 다시 계산 → "분석 데이터 부족 — 1개 항목…저장하지 않았습니다", DB 행 추가 없음
6. 데이터가 가격 1건뿐인 상품: 9개 모두 "미계산"(0점 표시 없음), 범위 0~100, 요소별 필요 데이터 안내
7. 재계산 → 점수 이력 2개, 현재 1개
8. `/products` 점수 열 + 필터 6가지 URL (전체·검토·강력추천·제외·미계산·상태 전체+검토) 결과 정확
9. 전체 페이지 회귀 (10절)

---

## 10. Regression

| 페이지 | 결과 |
|---|---|
| `/` (dashboard, DEMO) | 200 |
| `/keywords`, `/keywords/[id]` | 200 |
| `/products`, `/products?verdict=…` | 200 |
| `/products/[id]` (데이터 충분 / 부족) | 200 |
| `/competitors` | 200 |
| `/profit`, `/profit?product=` | 200 |
| `/categories` | 200 |
| `/watchlist` | 200 |
| `/import` | 200 |
| `/settings` | 200 |

- dev 서버 오류 로그 없음. PGlite 기존 157개(PHASE 1~6) 모두 통과. 수익성 계산 20/20.
- scoring v1 seed ↔ `scoring-weights.ts` 일치 확인 (가중치 9개, 라벨, 80/60, 합계 100).

---

## 11. 발견된 문제

1. **실제로는 대부분의 상품이 당분간 "미계산"으로 남는다.** 9개 요소가 모두 있어야 저장되는데, 전환율(WING 데이터), 성장률(판매량 이력 2회·7일 이상), 안정성(가격 이력 3회)은 수동 입력만으로 채우기 어렵다. 데이터 수집(확장 프로그램 / CSV import)이 들어오기 전까지는 미리 보기와 가능 범위가 주된 판단 근거가 된다. 일부 요소가 없어도 점수를 저장하려면 DB 변경(`total_score`·`verdict` NULL 허용 또는 별도 상태값)이 필요하다. 설계 결정 사항이라 이번에는 하지 않았다.
2. **정규화 구간(2절의 "→" 값)은 이번에 새로 정한 정의다.** PHASE 1·2 에는 가중치와 요소 설명만 있고 "검색량 몇이면 몇 점"은 정해져 있지 않았다. 점수에 큰 영향을 주므로 검토가 필요하다. 바꿀 때는 `SCORE_ENGINE_VERSION` 을 올리고, 저장된 점수에는 엔진 버전이 남아 비교할 수 있다. 가중치(15/15/10/15/10/10/5/15/5)와 판정 기준(80/60)은 바꾸지 않았다.
3. 엔진 안에서 내가 정한 세부 규칙: 수요 검색 추세 ±10점 가감, 경쟁 난이도 3개 지표 단순 평균, 판매량은 대상 + 경쟁상품 중앙값("상위 상품 판매량 규모"), WING 대체 계산 최소 3개, 성장률 비교 간격 7일·기간 90일, 안정성 180일·3회. 이것도 2번과 같은 검토 대상이다.
4. **시장 안정성은 가격 변동만 본다.** 요소 설명의 "계절성"은 계산할 데이터(1년 이상 검색량 추이)가 없어 넣지 않았다.
5. **재계산이 DB 트랜잭션이 아니다** (현재 해제 → INSERT 두 단계, 실패 시 되돌림). PHASE 6 수익성과 같은 방식이다.
6. **같은 데이터로 다시 계산해도 새 이력 행이 생긴다** (값이 같은지 비교하지 않음).
7. **상품 상세 페이지가 일부 데이터를 두 번 읽는다** (상세 표시용 + 점수 입력용). 데이터가 많아지면 느려질 수 있다.
8. `product_risks` 를 만드는 기능은 아직 없다. 점수 화면은 등록된 위험을 보여 주기만 한다 (점수 계산에는 넣지 않음 — 기존 설계대로 점수와 위험은 분리).
9. 목록의 점수는 상품마다 가장 최근 계산한 맥락 키워드의 점수다. 키워드별 점수가 여러 개면 상세에서 맥락을 바꿔 봐야 한다.
10. 좁은 화면에서는 요소 표의 "저장값" 열이 가로 스크롤 뒤에 있다.

---

## 12. 설계 변경 여부

```text
기존 설계 변경 없음
```

- Opportunity Score V1 가중치, 판정 기준(80/60), SourceType, Confidence, DataPoint, 판매량 3종 분리, products / product_snapshots / keyword_product_ranks / competitors / profit_scenarios / profit_calculations / watchlist 구조, RLS 를 바꾸지 않았다. 새 점수 요소도 추가하지 않았다.
- DB 변경 없음. 새로 추가된 것은 앱 코드의 정규화 구간(`score-engine-v1`)뿐이다 (11절 2·3번, 검토 필요).
- 사용하지 않던 `src/lib/repositories/scores.ts` 를 삭제했다 (동작 영향 없음).

---

## 13. 다음 Phase 영향

- **Chrome Extension / 실제 쿠팡 데이터 수집:** 엔진은 `v_product_latest` · `v_keyword_latest` · `product_snapshots` 만 읽는다. 확장 프로그램이 `upsert_*_snapshot()` 으로 값을 넣으면 코드 변경 없이 점수에 반영된다. 점수를 저장하려면 특히 **전환율(WING 28일 조회수·전환율), 판매량 이력, 가격 이력, 키워드 WING 비율·상품수/검색량**이 필요하다. 출처를 `WING_SESSION` / `EXTENSION` 으로 넣으면 원본 출처가 점수 기록에 그대로 남는다.
- **CSV import:** 가져온 스냅샷도 같은 경로라 점수에 반영된다. 날짜별로 여러 번 가져오면 성장률·안정성이 계산되기 시작한다.
- **자동 재계산:** 지금은 상품 상세의 "점수 다시 계산"만 있다. `recalculateScore(productId, keywordId)` 가 독립 함수라서 import 후·배치 작업에서 그대로 호출할 수 있다. 다만 같은 데이터로 반복 호출하면 이력이 늘어나므로(11절 6번), 자동화할 때는 "입력이 바뀐 경우만 저장" 규칙이 필요하다.
- **데이터 부족 상태 저장 여부**(11절 1번)는 자동 수집이 들어가기 전에 결정하는 것이 좋다. 결정에 따라 DB 변경 여부가 달라진다.
- **정규화 구간 검토**(11절 2번)는 실제 데이터가 쌓인 뒤 점수 분포를 보고 조정하는 것이 현실적이다. 조정하면 엔진 버전을 올린다. 가중치 자체를 바꾸려면 scoring v2 로 만든다.
