# JARVIS PHASE 5 마무리 + PHASE 6 수익성 분석 — 완료 보고서

작성일: 2026-10-07 · 대상: GPT 검토용 · 저장소: `K-JiSeok/jarvis` (main)

---

## 1. PHASE 5 미결 사항 처리 결과

### snapshot 함수 — 수정함

- **원인:** `upsert_product_snapshot()` · `upsert_keyword_snapshot()` 는 `INSERT … ON CONFLICT DO NOTHING` 다음에 기존 행을 다시 조회한다. 충돌한 행이 다른 사용자의 것이면 RLS 때문에 재조회 결과가 비어, 오류 없이 빈 행과 `SKIPPED` 를 반환했다 (데이터가 바뀌지는 않았음).
- **실제 DB 확인:** 같은 패턴(ON CONFLICT → 재조회)을 쓰는 함수는 이 2개뿐이다. `rollback_import` · 트리거 함수는 해당하지 않는다.
- **수정:** 재조회 결과가 없으면(`not found`) SQLSTATE `42501`(insufficient_privilege) 예외를 낸다. 함수 2개만 `CREATE OR REPLACE` 로 바꿨고, 그 외 본문은 한 글자도 바꾸지 않았다 (NULL 보존, 같은 날짜·출처 UPSERT, SKIPPED 판정, 반환 형식, SECURITY INVOKER, search_path, GRANT 모두 그대로).
- **migration:** `20261007081040_snapshot_upsert_cross_user.sql` (원격 적용 버전과 파일명 일치)
- **원격·로컬 함수 동일 확인:** `md5(prosrc)` 비교 — product `90e676d5…`, keyword `a4eeacba…` 양쪽 일치.
- 앱 레벨 방어 코드(`assertOwnSnapshot`)는 이중 방어로 남겨 두었다.

| 검증 (원격, 트랜잭션 후 롤백) | 결과 |
|---|---|
| A → 자기 snapshot UPSERT (새 행) | INSERTED ✅ |
| A → B 의 기존 상품 snapshot (같은 날짜·출처) | 42501 오류 ✅ (이전: 빈 SKIPPED) |
| A → B 의 기존 키워드 snapshot | 42501 오류 ✅ |
| A → B 의 상품, 새 날짜 | 23503 (복합 FK) ✅ |
| B 데이터 변경 없음 | 값·신뢰도·제외 여부 그대로 ✅ |
| NULL 보존 | NULL 항목은 기존 값 유지 ✅ |
| 같은 날짜·출처 정상 UPSERT | UPDATED, 행 수 1 그대로 ✅ |
| 본인 데이터 동일 값 재입력 | SKIPPED 유지 ✅ |

원격 8/8, 로컬 PGlite 회귀 B13·B14·B15 추가 (전체 회귀 통과, 7절).

### 경쟁관계 이력 — 수정하지 않음

`competitor_history` · 이벤트 테이블을 만들지 않았고 `competitors` 구조도 바꾸지 않았다. 해제·재등록·관계 변경은 지금처럼 `updated_at` 만 바뀐다.

### 후보 데이터 — 현재 구조 유지

자동 수집을 추가하지 않았다. `keyword_product_ranks` 구조와 후보 로직은 바꾸지 않았다.

### 테스트 데이터 — 정리 완료

PHASE 4·5 의 `[TEST]` 데이터를 FK 관계를 먼저 확인한 뒤 하나의 트랜잭션으로 삭제했다.

| 삭제 | 건수 |
|---|---|
| competitors | 2 |
| keyword_product_ranks | 4 |
| product_snapshots | 4 |
| watchlist_events | 5 |
| watchlist | 1 |
| products (9900000001/2/3) | 3 |
| keyword_snapshots | 1 |
| keywords (`[TEST] 접이식의자`, `[TEST] 캠핑의자`) | 2 |
| categories (`[TEST] 캠핑용품`) | 1 |

PHASE 6 테스트에서 만든 `[TEST]` 데이터(카테고리 1, 상품 2, 스냅샷 2, 시나리오 4, 계산 결과 4)도 테스트 후 모두 삭제했다.

**최종 운영 DB 상태:** products 0 · categories 0 · product_snapshots 0 · keyword_product_ranks 0 · competitors 0 · watchlist 0 · watchlist_events 0 · profit_scenarios 0 · profit_calculations 0. 남은 데이터는 사용자가 직접 입력한 실제 키워드 2개(`실리콘 주방 트레이`, `실리콘주방 트레이`)와 그 keyword_snapshot 1건뿐이다 (건드리지 않음). `[TEST]` 데이터 0건.

---

## 2. PHASE 6 구현 요약

- **순수 계산 모듈** `src/lib/profit/calculate.ts` — `calculateProfit()`, `calculateMargin()`, `calculateROI()`, `calculateBreakEvenPrice()`, `calculateBreakEvenUnits()`. 다른 모듈 import 없음. 서버(저장)와 브라우저(미리 보기)가 같은 함수를 쓴다.
- **시나리오 저장 + 재계산:** 기존 `profit_scenarios`(입력) / `profit_calculations`(결과) 구조를 그대로 사용. 재계산하면 새 결과 행을 INSERT 하고 이전 행은 `is_current = false` (결과 행은 수정하지 않음 → 이력 보존).
- **상품당 여러 시나리오**, 대표 시나리오 1개 (기존 부분 unique index 사용). 상품의 첫 시나리오는 자동 대표.
- **수수료율 기본값:** 시나리오에 입력 → 없으면 상품 카테고리의 `categories.coupang_fee_rate` → 둘 다 없으면 계산하지 않음. 서버는 화면에서 넘어온 값이 아닌 DB 의 카테고리 값을 다시 읽는다.
- **`/profit`** 실제 기능으로 전환, **`/products/[id]`** 에 수익성 분석 영역 추가, **`/categories`** 에 카테고리 기본 수수료율 관리 추가.
- 원가 통화 KRW / CNY / USD + 환율 직접 입력 (자동 환율 조회 없음).
- Opportunity Score 와는 연결하지 않았다.

---

## 3. 변경 파일

| 파일 | 내용 |
|---|---|
| `supabase/migrations/20261007081040_snapshot_upsert_cross_user.sql` | **신규** — snapshot 함수 2개 교차 사용자 42501 |
| `supabase/migrations/20261007081635_profit_break_even_price.sql` | **신규** — `profit_calculations.break_even_price` 컬럼 |
| `supabase/verify/phase2_verify.sql` | B13~B15 (snapshot 교차 사용자), PF01~PF14 (수익성) 추가 |
| `src/types/database.ts` | `break_even_price` 3줄 추가 (공식 생성 형식 유지) |
| `src/lib/profit/calculate.ts` | **신규** — 순수 계산 함수 (profit-v1) |
| `src/lib/profit/inputs.ts` | **신규** — 수수료율 결정, 시나리오 → 계산 입력 변환, 라벨 |
| `src/lib/profit/form.ts` | **신규** — 폼 파싱 (브라우저·서버 공용, 빈 칸 = null) |
| `src/types/profit.ts` | **신규** — 시나리오·계산 결과·카테고리 수수료 도메인 타입 |
| `src/lib/mappers/profit.ts` | **신규** — DB 행 → 도메인 타입 |
| `src/lib/repositories/profit.ts` | **신규** — 시나리오 조회/저장/대표 지정/삭제, 재계산, 카테고리 수수료율 |
| `src/app/profit/actions.ts` | **신규** — Server Functions (시나리오 저장·대표·삭제, 수수료율 수정, 카테고리 추가) |
| `src/components/profit/profit-calculator.tsx` | **신규** — 입력 폼 + 실시간 미리 보기 |
| `src/components/profit/profit-result.tsx` | **신규** — 결과 요약, 월 100/300/500개 표, 미입력 안내 |
| `src/components/profit/scenario-table.tsx` | **신규** — 시나리오 목록 (수정·대표로·삭제) |
| `src/components/profit/scenario-delete-button.tsx` | **신규** — 삭제 확인 |
| `src/components/profit/profit-workspace.tsx` | **신규** — 상품 하나의 수익성 영역 (`/profit`·상품 상세 공용) |
| `src/components/profit/category-fee-forms.tsx` | **신규** — 카테고리 수수료율 수정·추가 폼 |
| `src/app/profit/page.tsx` | placeholder → 상품 선택, 계산·저장, 전체 시나리오 목록 |
| `src/app/products/[id]/page.tsx` | 수익성 분석 카드 추가 (`?scenario=` 로 수정 대상 선택) |
| `src/app/categories/page.tsx` | 카테고리 수수료율 관리 카드 추가 (기존 분석 placeholder 유지) |
| `scripts/profit/test.mjs` | **신규** — 계산 테스트 (Node 내장 assert, 프레임워크 추가 없음) |
| `package.json` | `test:profit` 스크립트 |

---

## 4. DB 변경

| migration | 변경 | 이유 |
|---|---|---|
| `20261007081040_snapshot_upsert_cross_user` | 함수 2개 `CREATE OR REPLACE` (본문에 `if not found then raise 42501` 추가) | 1절 |
| `20261007081635_profit_break_even_price` | `profit_calculations` 에 `break_even_price bigint` (NULL 허용) 컬럼 1개 추가 + 코멘트 | 지시서 7·13절의 "손익분기 판매가격"을 저장할 컬럼이 없었다. 기존 `break_even_units` 는 손익분기 **판매량**이라 의미가 다르다 |

- 새 테이블 없음. 기존 컬럼·제약·인덱스·RLS 정책 변경 없음.
- 기존 행의 `break_even_price` 는 NULL(모름).
- 원격 migration 목록과 로컬 파일명 일치. Supabase security advisor: 기존 경고 1건(Auth 의 유출 비밀번호 보호 꺼짐, Auth 설정)만 있고 새 경고는 없다.

---

## 5. 수익성 계산식 (profit-v1, 실제 구현)

PHASE 2 설계에서 정한 것: `roi = 순이익 ÷ 투입원가`, `break_even_units` 는 `fixed_cost_total` 이 없으면 NULL, 결과 행은 `formula_version` + `inputs_snapshot` 을 갖는다. 그 밖의 세부 식은 정해져 있지 않아 아래와 같이 구현했다.

단위: 1개, 원(KRW). 금액은 원 단위로 반올림한다.

```text
상품 원가(원화)    = round(원가 × 환율)                        (KRW 이면 환율 1)
쿠팡 수수료        = round(판매가 × 수수료율)
광고비             = 개당 금액  또는  round(판매가 × 광고비율)  (둘 중 하나만 입력)
판매가 비례 비율   = 수수료율 + 광고비율                        (광고비를 비율로 넣은 경우)
개당 고정 비용     = 상품 원가 + 해외 배송비 + 국내 배송비 + 로켓그로스 물류비 + 기타 비용 (+ 광고비 금액)
총비용             = 개당 고정 비용 + 쿠팡 수수료 (+ 비율 광고비)
순이익             = 판매가 − 총비용
순이익률           = 순이익 ÷ 판매가                            (판매가 ≤ 0 이면 NULL)
투입원가           = 상품 원가 + 해외 배송비 + 국내 배송비       (재고로 묶이는 돈)
ROI                = 순이익 ÷ 투입원가                          (투입원가 ≤ 0 이면 NULL)
손익분기 판매가    = ceil(개당 고정 비용 ÷ (1 − 판매가 비례 비율))  (비율 합 ≥ 100% 이면 NULL)
손익분기 판매량    = ceil(초기 고정비 ÷ 순이익)                 (고정비 없음 또는 순이익 ≤ 0 이면 NULL)
월 순이익          = 순이익 × 월 예상 판매량                    (판매량 미입력이면 NULL)
```

- **필수값:** 판매가 · 원가 · 수수료율(시나리오 또는 카테고리). 하나라도 없으면 모든 결과가 NULL이고 결과 행을 저장하지 않는다 (추정해서 채우지 않음). 시나리오 입력은 저장된다.
- **선택 비용**(해외·국내 배송비, 물류비, 광고비, 기타)을 비워 두면 계산에서 빼고 `omitted` 로 기록한다. 화면에는 "미입력으로 계산에서 뺀 비용: …" 으로 표시된다. 0 을 입력하면 실제 0 으로 계산한다.
- **손익분기 판매가 검증:** 그 가격에서 순이익 ≥ 0, 1원 낮으면 < 0 (테스트로 확인).
- **ROI 저장 범위:** `numeric(9,4)` 를 넘으면 NULL + 경고.
- **필드 매핑:** 상품 매입가 → `unit_cost_amount`(+통화·환율), 해외 배송비 → `intl_shipping_per_unit`, 국내 배송비 → `domestic_shipping_per_unit`, 쿠팡 수수료 → `coupang_fee_rate`, 로켓그로스 비용 → `logistics_fee_per_unit`, 광고비 → `ad_cost_rate` / `ad_cost_per_unit`, **기타 상품 원가 + 기타 플랫폼 비용 → `other_cost_per_unit` 하나** (별도 컬럼이 없어 합산 입력).
- **inputs_snapshot** 에 남기는 값: 시나리오 입력 전체, `category_id`, `category_fee_rate`, `applied_fee_rate`, `fee_rate_source`(SCENARIO/CATEGORY), `applied_exchange_rate`, `vat_handling: "sale_price_as_is"`, `result_source_type: "CALCULATED"`, `omitted`, `warnings`, `investment_per_unit`, `fixed_cost_per_unit`, `variable_rate`.
- **데이터 신뢰도:** 시나리오 입력 = `source_type MANUAL`, `confidence B` (기존 컬럼 기본값). 계산 결과 테이블에는 source_type 컬럼이 없어, 결과가 CALCULATED 라는 사실을 `inputs_snapshot.result_source_type` 과 도메인 타입(`source: "CALCULATED"`)에 기록하고 화면에 "자체 계산"으로 표시한다.
- **VAT:** 판매가(쿠팡 노출가, VAT 포함)를 그대로 쓴다. 부가세 정산은 반영하지 않는다 (화면에 안내).

---

## 6. UI

### `/profit`

- **상품 선택** (GET `?product=`). "상품 없이 빠른 계산"을 고르면 저장 없이 계산만 한다.
- 입력: 시나리오 이름, 판매가, 월 예상 판매량, 원가 + 통화(KRW/CNY/USD) + 환율, 해외·국내 배송비, 로켓그로스 물류비, 쿠팡 수수료율(%), 광고비(%/원 전환), 기타 비용, 초기 고정비, 메모, 대표 시나리오.
- **실시간 미리 보기:** 개당 순이익, 순이익률, ROI, 개당 총비용, 손익분기 판매가, 손익분기 판매량, 월 판매량(예상 / 100 / 300 / 500개)별 월 순이익, 원가(원화)·수수료·광고비·투입원가 내역, 미입력·오류·경고 안내. 손실은 빨간색으로 표시.
- **저장:** 서버가 같은 순수 함수로 다시 계산해 저장한다. 결과 메시지를 표시하고, 새 시나리오를 저장하면 폼을 기본값으로 비운다.
- **선택 상품의 시나리오 목록:** 판매가, 원가, 순이익, 순이익률, ROI, 손익분기가, 계산일 / 수정 · 대표로 · 삭제. 결과가 없으면 "미계산".
- **전체 시나리오 목록:** 모든 상품의 시나리오와 현재 결과 (월 순이익 포함).

### `/products/[id]`

- "수익성 분석" 카드(`#profit`)를 기본 정보·현재 지표 아래, 경쟁상품 위에 추가했다.
- 상단: 카테고리, 기본 수수료율(관리 링크), 현재 판매가 · 정가 · 할인율 (현재 지표 값, 없으면 `-`).
- 새 시나리오의 판매가 기본값 = 현재 판매가. 수수료율 칸은 비워 두고 카테고리 기본값을 placeholder 와 안내로 보여 준다 (비우면 그 값 사용).
- 시나리오 목록 + 입력 폼 (`/profit` 과 같은 컴포넌트). `?scenario=<id>` 로 수정 대상 선택.

### `/categories`

- "카테고리 수수료율" 카드: 카테고리별 상품 수와 기본 수수료율(%) 수정, 카테고리 추가(이름 + 수수료율). 빈 칸 = 모름(NULL). 같은 이름은 중복 추가를 막는다.
- 기존 "카테고리 분석" 준비 중 영역은 그대로 둔다.

---

## 7. 테스트 결과

```text
Profit calculation (npm run test:profit):     20/20
DB 회귀 (npm run db:verify, PGlite):         157/157   (기존 143 + PF 14)
  └ 수익성 DB · RLS (PF01~PF14):              14/14
Snapshot 함수 수정 (원격 Supabase):              8/8
수익성 DB · RLS (원격 Supabase, 롤백):          10/10
원격·로컬 snapshot 함수 md5:                    2/2 일치
브라우저 UI (로그인 세션, [TEST] 데이터):       12/12
Typecheck (next typegen + tsc):                PASS
Lint (eslint):                                 PASS (경고 0)
Build (next build):                            PASS
```

**계산 테스트 20개:** 정상 수익(총비용·순이익·순이익률·ROI·월 순이익 값 일치), 손실, 0원 판매가, 0원 원가(≠ NULL), 필수값 3종 미입력, 선택 비용 미입력, 판매가 변경, 원가 변경, 수수료 변경, 광고비 비율 ↔ 금액, 광고비 이중 입력 오류, 배송비 변경, 환율(32.5 CNY × 190 = 6,175원), 손익분기 판매가 경계(그 가격 ≥ 0 / 1원 낮으면 < 0), 손익분기 판매량, ROI 투입원가 0, ROI 범위 초과, 비례 비율 100% 이상, 보조 함수 단독, 환율 0 오류.

**PGlite PF 14개:** break_even_price 컬럼, 재계산(이력 2행·현재 1행), 미입력 = NULL 저장, 현재 결과 2개 차단(23505), 다른 상품 시나리오 참조 차단(23503), 대표 2개 차단(23505), 수수료율 범위(23514), 환율 0(23514), 카테고리 수수료율 범위(23514), B → A 상품에 시나리오 추가 불가(23503), B → A 시나리오에 결과 추가 불가(23503), B 의 A 시나리오·수수료율 UPDATE 0행, B 의 결과 DELETE 0행, A 데이터 보존.

**원격 10개:** 재계산 이력, 다른 상품 참조 23503, 대표 2개 23505, B 조회 0/0/0, B 시나리오 추가 23503, B 결과 추가 23503, B 시나리오 수정 0행, B 수수료율 수정 0행, B 결과 삭제 0행, A 데이터 보존.

**브라우저 12개** (실제 로그인 세션):

1. 상품 상세에 판매가 기본값 29,900원, 카테고리 수수료 10.8% 표시
2. 입력 즉시 미리 보기 — 순이익 8,181원, 27.4%, ROI 65.5%, 손익분기가 19,571원, 62개, 월 818,100원 (계산 테스트 기대값과 일치)
3. 저장 → DB 결과 행이 화면 값과 동일 (`fee_rate_source = CATEGORY`, `applied_fee_rate = 0.108`)
4. 수정(수수료 6%) → 순이익 9,616원, 이전 결과 `is_current = false`, 새 결과 SCENARIO 6%
5. 필수값(원가) 미입력 저장 → 시나리오만 저장, 결과 "미계산"
6. CNY 32.5 × 190 → 원화 원가 6,175원, 순이익 20,496원
7. USD 5 × 1,400 + 광고비 개당 1,000원 → 순이익 18,671원
8. 저장 후 메시지 유지, 폼(통화·광고비 방식 포함)이 기본값으로 초기화
9. `/categories` 수수료율 10.8% → 8% 저장, 상품 상세 기본값 8% 반영
10. 같은 이름 카테고리 추가 → 중복 안내
11. "대표로" → 대표 변경
12. 삭제(확인 후) → 목록에서 제거

---

## 8. Regression

| 페이지 | 결과 |
|---|---|
| `/` (dashboard) | 200 |
| `/keywords` | 200 |
| `/products` | 200 |
| `/products/[id]` | 200 (없는 id 는 의도된 404) |
| `/competitors` | 200 |
| `/watchlist` | 200 |
| `/profit` · `/profit?product=` | 200 |
| `/categories` | 200 |
| `/import` | 200 |
| `/settings` | 200 |

- 기존 PGlite 회귀 143개(스키마·RLS·snapshot·뷰·점수·예측·관심상품·경쟁상품·import 롤백·불변 트리거 등) 모두 통과.
- scoring v1 seed ↔ `scoring-weights.ts` 가중치 9개 · 판정 기준 80/60 일치 확인 (변경 없음).

---

## 9. 발견된 문제

1. **카테고리 수수료율을 바꿔도 저장된 결과는 자동 재계산되지 않는다.** 결과 행은 계산 당시 입력(`inputs_snapshot.applied_fee_rate`)을 보존하는 설계라 의도된 동작이다. 새 수수료율을 반영하려면 시나리오를 다시 저장해야 한다. 화면에 따로 안내하지는 않는다.
2. **재계산·대표 지정이 DB 트랜잭션이 아니다.** 이전 결과 내림 → 새 결과 INSERT 를 두 번의 요청으로 처리한다. INSERT 가 실패하면 이전 결과를 되돌리는 보상 처리는 있지만, 그 사이 아주 짧게 "현재 결과 없음" 상태가 생길 수 있다. 대표 지정도 같다 (해제 → 지정). 개인용 단일 사용자에서는 문제가 될 가능성이 낮다. 원자성이 필요해지면 DB 함수(RPC)로 옮길 수 있다 (DB 변경).
3. **기타 상품 원가와 기타 플랫폼 비용이 한 칸(`other_cost_per_unit`)이다.** 별도 컬럼이 없어 합쳐서 입력한다.
4. **VAT 를 분리 계산하지 않는다.** 판매가 = VAT 포함 노출가 그대로.
5. **환율은 직접 입력**한다 (자동 조회 없음).
6. **`/categories` 수수료율 저장 후 "저장했습니다" 메시지가 바로 사라진다.** 저장 값으로 폼을 다시 그리기 때문이다 (값은 정상 반영). 기능에는 영향이 없다.
7. **`/categories` 의 기존 placeholder 문구가 "PHASE 3에서 구현 예정"이다.** navigation 설정의 `plannedPhase: 3` 이 이미 지난 단계로 남아 있다. 이번 범위가 아니라 바꾸지 않았다.
8. 시나리오 삭제는 결과 행까지 함께 삭제한다 (FK cascade). `my_listings.baseline_profit_calc_id` 가 참조 중이면 FK 가 삭제를 막고 오류 메시지를 보여 준다 (현재 my_listings 데이터 없음).
9. dev 서버 로그에 예전 단계의 오래된 오류 기록(모듈 경로, 이번 작업 중 잠깐 생긴 문법 오류)이 남아 있다. 현재 코드에서는 재현되지 않고 build 도 통과한다.

---

## 10. 설계 변경 여부

기존 설계의 구조·원칙은 바꾸지 않았다. 다만 아래 2건의 DB 변경이 있다.

| 기존 설계 | 변경 내용 | 변경 이유 | 영향 |
|---|---|---|---|
| `profit_calculations` 에 손익분기 판매량(`break_even_units`)만 있음 | `break_even_price bigint` NULL 허용 컬럼 추가 | 지시서의 "손익분기 판매가격"을 결과로 저장할 곳이 없음 | 기존 컬럼·행·제약·RLS 영향 없음. 기존 행은 NULL |
| snapshot UPSERT 함수: 교차 사용자 충돌 시 빈 SKIPPED | 42501 예외 | PHASE 5 미결 사항 1-1 | 본인 데이터 동작 변화 없음. 다른 사용자 데이터 대상일 때만 오류 |

Opportunity Score · 가중치 · 판정 기준 · SourceType · Confidence · DataPoint · 판매량 3종 분리 · Product/Snapshot/Competitor 구조 · Watchlist lifecycle · RLS 원칙은 바꾸지 않았다.

---

## 11. 다음 Phase 영향

- **Opportunity Score:** 수익성 결과를 점수(가중치 15의 margin 등)에 연결하지 않았다. 연결하려면 대표 시나리오의 현재 결과(`profit_calculations` `is_current`)를 쓰고, `opportunity_scores.input_refs` 에 `profit_calculation_id` 를 남기는 방식이 기존 설계와 맞다. 별도 결정이 필요하다.
- **Chrome Extension / 자동 수집:** 판매가 기본값은 `v_product_latest.price`(가장 최근·신뢰도 높은 값)를 쓰므로, 확장 프로그램이 snapshot 을 넣으면 수익성 기본값도 자동으로 따라간다. 카테고리 수수료율은 수동 관리이고, 쿠팡 카테고리 코드(`coupang_category_id`)와 수수료표를 자동으로 매칭하는 기능은 없다.
- **판매 결정:** `my_listings.baseline_profit_calc_id` 에 판매 결정 시점의 결과 행을 연결할 수 있다. 결과 행은 수정하지 않으므로 기준값이 보존된다.
- **snapshot 함수:** 교차 사용자 충돌이 이제 42501 오류다. 확장 프로그램 · CSV import 도 이 오류를 "권한 없음"으로 처리해야 한다.
