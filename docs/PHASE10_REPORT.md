# JARVIS PHASE 10 — 실제 쿠팡 데이터 수집 기반 + 대량 저장 구조 · 완료 보고서

작성일: 2026-10-08 · 저장소: `K-JiSeok/jarvis` (main)

---

## 핵심 숫자

```text
Batch 처리 속도
  앱 경로 (로그인 세션 → Supabase), 상품 스냅샷 2,000건 1회 요청:   RPC 2.66초 / 왕복 2.92초
  DB 내부 측정 (원격): 상품 스냅샷 2,000건 1.69초 · 순위 2,000건 1.03초 · 키워드 100건 0.07초
  비교 — PHASE 9 방식 (행마다 RPC) 200건: 6.79초 (건당 34ms → 2,000건이면 약 68초)
        새 배치 200건: 0.20초  → 약 34배 / 2,000건 기준 약 25배

Transaction 결과
  배치 중간에 시스템 오류 (3번째 레코드가 알 수 없는 종류) → 전체 롤백
  저장된 스냅샷 0 · import_rows 0 · job 행 없음 → 실패 사실만 별도 FAILED job 으로 기록
  같은 idempotency_key 로 정상 배치를 다시 보내면 2건 INSERTED (앞의 시도에서 남은 데이터가 없다는 증거)

동시 rank UPSERT 결과
  같은 키 500개 배치 2개 동시: 추가 500 + 갱신 500, 실패 0, UNIQUE 위반 0 (총 1.03초, 순차 합 1.57초 → 실제로 겹침)
  같은 키 500개 배치 5개 동시: 추가 500 + 건너뜀 1,000 + 갱신 1,000, 실패 0 (총 2.04초, 순차 합 6.38초)
  최종: 날짜 구간마다 500행 = 500키 (중복 0), 모든 행이 한 배치의 값으로 일관 (섞인 값 없음)
```

---

## 1. 구현 요약

- **DB 함수 2개 추가** (migration 1개, 새 테이블·컬럼 없음):
  - `ingest_batch(p_job, p_rows)`: 정규화 레코드 배열을 **한 번의 호출 = 한 트랜잭션**으로 저장한다. import_jobs / import_rows 기록까지 함께 한다.
  - `upsert_keyword_product_rank(p)`: 키워드 순위 **원자적 UPSERT**.
- **PHASE 9 문제 3개 해결:**
  - A. 행마다 저장 요청 → 배치 1회
  - B. 트랜잭션 아님 → 시스템 오류면 전체 롤백
  - C. 순위 SELECT → INSERT/UPDATE 2단계 → `INSERT … ON CONFLICT DO NOTHING` 후 잠금 조회
- **`/import` 가 배치 경로를 쓴다.** UI·사용자 동작은 같다 (이력 화면에서 수집 배치 이름 표시만 개선).
- **수집기 경계:** `src/lib/collectors/` — `Collected*` 타입, 순수 정규화 함수, 쿠팡 상품·검색 화면 문자열 어댑터 (DOM selector 는 만들지 않음).
- **수집 저장 서비스:** `ingestCollected()` — 향후 `POST /api/ingest` 가 부를 진입점.
- **개발 전용 내부 테스트 경로:** `POST /api/dev/ingest` — 로그인 세션 필요, production 404 확인.
- 기존 설계 변경 없음 (17절).

---

## 2. Batch ingestion 구조

```text
파일 (PHASE 9)                              수집기 (PHASE 11~)
  파일 → ParsedTable → 매핑 → 검증            쿠팡 화면 → Raw 문자열 → adapter → Collected*
          → PreparedRow[]                                  → normalize → NormalizedRecord[]
               │ preparedToBatchRows()                          │ normalizedToBatchRows()
               └──────────────┬─────────────────────────────────┘
                              ▼
                        BatchRow[]  {row_number, record_key, kind, status, data(DB 컬럼명), payload}
                              │ ingestBatch()  (src/lib/repositories/ingest.ts, 로그인 세션 · RLS)
                              ▼
               ingest_batch(p_job, p_rows)   ← 한 트랜잭션
                 ├ import_jobs (PROCESSING → SUCCEEDED / PARTIAL / FAILED)
                 ├ 행마다: upsert_product_snapshot / upsert_keyword_snapshot / upsert_keyword_product_rank
                 ├ import_rows (결과 · target · previous_values · 오류)
                 └ products.last_seen_at (더 최신일 때만)
```

- 상품·키워드 id 를 모르면 `coupang_product_id` · `keyword` 텍스트를 넣는다. DB 함수가 본인 데이터(RLS)에서 찾고, 미등록이면 그 행만 `PRODUCT_NOT_FOUND` / `KEYWORD_NOT_FOUND` 이다. 자동 생성은 하지 않는다.
- 한 호출 최대 5,000행 (DB 함수 한도). 앱·수집 서비스는 2,000건으로 제한한다.

---

## 3. Product snapshot batch

- 행마다 기존 `upsert_product_snapshot()` 을 그대로 호출한다. 그래서 기존 규칙이 모두 유지된다.
  - 자연키 `(product_id, captured_on, source_type)`
  - NULL 보존
  - 0 은 실제 0
  - 다른 사용자 행 42501
  - 반환 action / previous
- 받는 필드: price, original_price, discount_rate, review_count, rating, category_rank, sales_actual, sales_estimated, sales_period_days, revenue_actual, revenue_estimated, conversion_rate, views_28d, delivery_type, seller_type_observed, product_name_observed, metric_meta + source / confidence / captured_on / captured_at.
- 테스트:
  - 100건 batch INSERT (PGlite 58ms)
  - 2,000건 (원격 1.69초)
  - NULL 보존 (평점 NULL 로 기존 값 유지)
  - 0 보존 (리뷰 0 유지)

---

## 4. Keyword snapshot batch

- 행마다 기존 `upsert_keyword_snapshot()` (자연키 `(keyword_id, captured_on, source_type)`, NULL 보존).
- 키워드 텍스트로 찾을 때는 `keywords.normalized_keyword` 와 같은 규칙(앞뒤 공백 제거 · 연속 공백 1개 · 소문자)을 DB 에서 적용한다.
- 받는 필드: search_volume, search_volume_previous, search_growth_rate, coupang_product_count, competition_intensity, wing_ratio, rocket_ratio, brand_concentration, average_price, average_reviews, ad_bid, metric_meta.
- 테스트: 100건 (PGlite, 대문자·앞뒤 공백 키워드로 찾기), 원격 100건 0.07초.

---

## 5. Keyword rank atomic UPSERT

`upsert_keyword_product_rank(p)` — 자연키 `(keyword_id, product_id, captured_on, source_type, is_ad)`. 기존 UNIQUE 인덱스 `keyword_product_ranks_natural_key` 를 그대로 쓴다. owner_id 는 FK·RLS 로 같은 사용자만 참조한다.

```text
1) INSERT … ON CONFLICT (자연키) DO NOTHING RETURNING
     → 행이 생기면 INSERTED
     → 같은 키를 동시에 넣는 트랜잭션은 UNIQUE 인덱스에서 기다렸다가 "충돌 → 아무것도 안 함" (오류 없음)
2) 충돌했으면 SELECT … FOR UPDATE 로 그 행을 잠그고 읽는다 (= previous)
     → 보이지 않으면 다른 사용자의 행 → 42501 (스냅샷 함수와 같은 처리)
3) 순위 · 페이지 · 신뢰도가 같으면 SKIPPED, 다르면 UPDATED
     (새 page 가 NULL 이면 기존 값 유지 = NULL 보존)
```

- SELECT → INSERT/UPDATE 2단계 코드(PHASE 9 `saveRank`)는 삭제했다.
- 직접 입력 화면의 단건 순위 저장(`saveKeywordProductRank`, supabase upsert)은 그대로 두었다 (원래 원자적).
- 동시성 결과는 맨 위 "핵심 숫자" 참고.

---

## 6. Transaction 처리

| 상황 | 처리 |
|---|---|
| 앱 검증 오류 (파일: 필수값·날짜·미등록 / 수집기: 신뢰도 없음·상품 ID 없음) | 그 행만 FAILED (부분 성공 유지) |
| 데이터 오류 (22xxx 형식·범위 · 23502 필수 · 23503 FK · 23514 CHECK · 42501 다른 사용자) | 그 행만 FAILED (서브트랜잭션으로 그 행만 되돌림) |
| 파일 내 · 배치 내 중복 키 | SKIPPED (`DUPLICATE_IN_FILE` / `DUPLICATE_IN_BATCH`) |
| 시스템 오류 (알 수 없는 레코드 종류 · 알 수 없는 행 상태 · 중복 행 번호 · 예상하지 못한 DB 오류) | **전체 롤백** — 저장 데이터 · import_rows · job 모두 없음 |
| 전체 롤백 후 | 앱이 실패 사실만 별도 FAILED job 으로 기록 (`error_summary = 전체 롤백 (저장된 데이터 없음): …`, 데이터 0) |

- 함수 호출 하나가 트랜잭션이라 중간에 서버가 죽어도 "437/1000 저장 + PROCESSING" 상태가 남지 않는다 (PHASE 9 문제 B 해결).
- `rollback_import()` 와 충돌하지 않는다. 배치 job 의 import_rows 에도 target_table / target_id / previous_values 를 똑같이 남긴다. PGlite BI11: 배치로 넣은 순위 100건을 rollback_import 로 삭제. 앱 UI 되돌리기도 확인했다.

---

## 7. Import job / import rows 처리

- **import_jobs:**
  - channel: `FILE`(/import) · `EXTENSION`(수집기)
  - import_type: PRODUCT_SNAPSHOTS / KEYWORD_METRICS / SEARCH_RANKS / MIXED (기존 CHECK 값)
  - source_type: 출처가 하나면 그 출처, 섞이면 `EXTENSION` (행마다의 출처는 각 스냅샷 source_type 에 남는다)
  - source_tool: 수집기 이름
  - idempotency_key, file_hash, schema_version (`import-v1` / `ingest-v1`), column_mapping
  - 개수(inserted / updated / skipped / failed), error_summary(코드별 개수), started_at / finished_at
- **import_rows:** row_number, record_key (자연키), payload (원본: 파일 셀 또는 수집 데이터 + 정규화 issue), result, target_table, target_id, previous_values (UPDATED), error_code, error_message.
- 상태 규칙은 PHASE 9 와 같다: 실패 0 → SUCCEEDED, 저장 > 0 이고 실패 > 0 → PARTIAL, 저장 0 이고 실패 > 0 → FAILED.
- 이력 화면: 파일명이 없는 수집 배치는 "수집 배치 · EXTENSION (도구 이름)", 유형 MIXED 는 "혼합"으로 표시.

---

## 8. NormalizedRecord 경계

PHASE 9 의 타입을 그대로 쓴다 (`src/lib/import/core.ts`). 변경 없음.

| 레코드 | 내용 |
|---|---|
| `NormalizedProductSnapshot` | coupangProductId, capturedOn(KST), capturedAt, source, confidence, metrics(DB 컬럼명), calculated |
| `NormalizedKeywordSnapshot` | keyword, … , metrics, calculated |
| `NormalizedRank` | keyword, coupangProductId, rankPosition, isAd, page |

- 레코드 → DB 컬럼: `recordData()` (`src/lib/ingest/batch-rows.ts`). 값이 없는 지표는 넣지 않는다 (NULL 보존).
- 파생 값(할인율, 경쟁강도, 검색량 증감률)은 `metric_meta.{필드} = {source: CALCULATED}`.

**쿠팡 화면에서 얻는 값 → 레코드 (확인 전 가정, 실제 selector 는 PHASE 11):**

| 화면 | 읽을 값 | 레코드 |
|---|---|---|
| 상품 페이지 | 상품 ID(URL), 상품명, 판매가, 정가, 할인율(% 표시가 있을 때), 리뷰 수, 평점, 배송 배지, 판매자 문구 | `NormalizedProductSnapshot` (COUPANG_PAGE / EXTENSION) |
| 검색 결과 | 키워드·페이지(URL), 상품 ID, 보인 순서, 광고 표시 | `NormalizedRank` |
| WING 화면 | 28일 조회수, 전환율 (보이는지 PHASE 11 에서 확인) | `NormalizedProductSnapshot` (WING_SESSION 일 때만) |
| 키워드 도구 · WING 키워드 | 검색량, 상품 수, WING·로켓 비율 등 | `NormalizedKeywordSnapshot` |

---

## 9. Coupang collector adapter

```text
src/lib/collectors/
  types.ts            CollectedProduct · CollectedWingMetrics · CollectedSearchResult · CollectedKeyword · NormalizeIssue
  normalize.ts        normalizeProduct / normalizeSearch / normalizeKeyword (순수, DB 없음)
  coupang/product.ts  RawCoupangProductPage → CollectedProduct (문자열 → 값: "29,900원", "(1,234)", 배송 배지)
  coupang/search.ts   RawCoupangSearchPage → CollectedSearchResult (URL 의 q·page, 보인 순서 = 순위, 광고 문구)
src/lib/ingest/
  batch-rows.ts       NormalizedRecord / PreparedRow → BatchRow
  service.ts          ingestCollected(): Collected* → normalize → BatchRow → ingest_batch (서버 전용)
```

- **수집기는 DB 를 부르지 않는다.** DB 를 부르는 건 `service.ts → repositories/ingest.ts` 뿐이다.
- **추측 금지:**
  - 공개 상품 페이지 타입(`CollectedProduct`)에는 판매량·매출·전환율·조회수·광고 입찰가 필드가 **없다**.
  - WING 값은 `wing` 블록에 들어오고 source = WING_SESSION 일 때만 저장한다 (아니면 버리고 issue). WING 에서 실제로 어떤 값이 보이는지는 확인하지 않았으므로 28일 조회수·전환율 두 칸만 열어 두었다.
- **DOM selector 없음:** 어떤 요소에서 문자열을 읽을지는 실제 페이지를 확인하는 PHASE 11 에서 정한다. 이번에는 "읽은 문자열 → 값" 규칙만 만들었다.
- **신뢰도:** 수집기가 반드시 명시한다 (없으면 레코드 거부). 기본값 A 없음.
- **값 변환:** 파일 가져오기와 같은 `convertCell()` 을 재사용한다.
  - 숫자 문자열, % 비율 (숫자 비율은 0~1 소수)
  - 배송·판매자 문구 → 코드
  - 상품 ID ← `/products/{id}`
  - 수집 시각 → KST 수집일, 미래 시각 거부
- **정규화에서 버려진 항목**(상품 ID 없음 등)도 FAILED 행으로 import_rows 에 남긴다.

---

## 10. Idempotency

| 구분 | 키 | 동작 |
|---|---|---|
| 수집 배치 재전송 | `import_jobs.idempotency_key` (기존 UNIQUE `(owner_id, idempotency_key)`) | 이미 있으면 처리하지 않고 기존 job 을 돌려준다 (`replay: true`) |
| 동시에 같은 키 2개 | 위 UNIQUE | 뒤의 요청은 앞의 커밋을 기다렸다가 23505 → 앱이 기존 job 을 찾아 replay 로 돌려준다 |
| 파일 (PHASE 9) | `file_hash + import_type` (기존 부분 UNIQUE) | 이미 성공·부분 성공이면 23505 → "같은 파일" 안내. 정책 그대로 |
| 시스템 오류 후 재시도 | FAILED 기록에 키를 넣지 않음 (`column_mapping.attempted_idempotency_key` 에만) | 같은 키로 다시 보내면 정상 처리 |

- 키는 사용자별이다 (B 가 같은 문자열을 써도 A 의 job 을 받지 않음, PGlite BI13).
- 결과: 같은 2,000건 배치를 같은 키로 다시 보냄 → 0.39초, replay, 데이터 2,000건 그대로 (원격 확인).

---

## 11. RLS

- 두 함수 모두 **SECURITY INVOKER**. 호출한 사용자의 RLS 가 그대로 적용된다. service role 은 쓰지 않는다 (개발 경로도 로그인 세션).
- 권한: `authenticated`, `service_role` 만 실행. `public` · `anon` 회수.

| 검사 | 결과 |
|---|---|
| A: 본인 데이터 저장·조회 | 가능 (전체 테스트) |
| B → A 의 상품 id 로 스냅샷 (PGlite BI12) | FAILED NOT_FOUND (복합 FK) |
| B → A 의 쿠팡 상품 ID 문자열 | FAILED PRODUCT_NOT_FOUND (보이지 않음) |
| B → A 의 키워드 순위 | FAILED NOT_FOUND |
| B → A 의 기존 순위 키 (원격) | 42501 |
| B 조회 (원격) | products 0 · ranks 0 · jobs 0 |
| B 의 시도 후 A 데이터 (BI14) | 변화 없음 |
| anon `ingest_batch` / `upsert_keyword_product_rank` (원격) | 42501 / 42501 |
| 개발 경로 production (`next start`) | 404 |

---

## 12. 테스트 결과

```text
Ingest (npm run test:ingest, 순수):              19/19   (Adapter 5 · Normalize 9 · Batch 5)
DB (npm run db:verify, PGlite):                 204/204  (기존 187 + BI 17)
  └ BI00~BI14 (batch · 원자 UPSERT · 트랜잭션 · 멱등 · 해시 · 되돌리기 · RLS): 17/17
원격 Supabase (앱 경로 · 로그인 세션):            8/8
  1. 상품 2,000건 배치 (2.66초)        2. 같은 키 재전송 → replay, 데이터 그대로
  3. PHASE 9 방식 200건 비교 (6.79초)   4. 배치 200건 (0.20초)
  5. 동시 2배치 × 500 같은 키           6. 동시 5배치 × 500 같은 키
  7. 중간 실패 → 전체 롤백 + 재시도     8. 목업 쿠팡 화면 → 수집기 → 저장 (부분 성공 5/2)
원격 DB 직접 (롤백):                              2/2   (2,000건 속도 측정, B·anon)
Import regression (npm run test:import):         36/36
UI regression (/import 브라우저):                  5/5   (상품 CSV 부분 성공 · 순위 CSV · 같은 파일 경고 · 이력 · 되돌리기)
Dashboard regression:                             12/12
Score regression:                                 22/22
Profit regression:                                20/20
Typecheck: PASS · Lint: PASS · Build: PASS · npm audit: 0
```

목업 파이프라인 결과 (원격 DB 값 확인):
- 상품 페이지 문자열 "29,900원"·"35,000원" → 29,900 / 35,000, 할인율 14.57% 계산(CALCULATED), 배송 ROCKET_GROWTH, 판매자 ROCKET_GROWTH_SELLER
- EXTENSION 출처에 붙은 WING 조회수는 버려짐 (views_28d NULL)
- WING_SESSION·A 출처 상품: 조회수 1,500, 전환율 4.1%, 가격 NULL (넣지 않음)
- 검색 결과: 광고 1위, 자연 2위 (광고 표시 null → 자연), 상품 ID 없는 항목은 FAILED
- 키워드: "12,000" → 12,000, "45%" → 0.45, 경쟁강도 2.5 · 증감률 20% 계산
- 미등록 상품 → PRODUCT_NOT_FOUND, 신뢰도 없는 레코드 → INVALID

---

## 13. Regression 결과

| 페이지 | 결과 |
|---|---|
| `/`, `/keywords`, `/keywords/[id]`, `/products`, `/products/[id]`, `/competitors`, `/profit`, `/categories`, `/watchlist`, `/import`, `/settings` | 모두 200, 서버 오류 로그 없음 |

`/import` 의 CSV · XLSX(PHASE 9 테스트 36개에 포함) · 3가지 유형 · 매핑 · 미리 보기 · 검증 · 출처/신뢰도 · 부분 성공 · 이력 · 되돌리기가 모두 동작한다. 저장 경로만 배치로 바뀌었다.

---

## 14. DB Migration 여부

**있음 — `supabase/migrations/20261008020435_batch_ingestion.sql`** (원격 적용 버전과 파일명 일치)

| 항목 | 내용 |
|---|---|
| 추가 함수 | `public.upsert_keyword_product_rank(p jsonb) returns jsonb` · `public.ingest_batch(p_job jsonb, p_rows jsonb) returns jsonb` (둘 다 plpgsql, SECURITY INVOKER, `search_path = ''`) |
| 권한 | `revoke execute … from public, anon` · `grant execute … to authenticated, service_role` |
| 테이블 · 컬럼 · 인덱스 · RLS | **변경 없음** (기존 UNIQUE 인덱스 사용) |
| 기존 데이터 영향 | 없음 |
| 기존 함수 | 변경 없음 (`upsert_*_snapshot`, `rollback_import` 를 안에서 호출만) |

Supabase security advisor: 새 경고 없음 (기존 Auth 설정 경고 1건만).

---

## 15. 변경된 파일

| 파일 | 내용 |
|---|---|
| `supabase/migrations/20261008020435_batch_ingestion.sql` | **신규** — 함수 2개 |
| `src/types/database.ts` | 함수 2개 타입 추가 (공식 생성 형식) |
| `src/lib/ingest/batch-rows.ts` | **신규** — NormalizedRecord / PreparedRow → BatchRow (순수) |
| `src/lib/ingest/service.ts` | **신규** — ingestCollected() 수집 저장 서비스 |
| `src/lib/repositories/ingest.ts` | **신규** — ingestBatch() RPC, 시스템 오류 FAILED 기록, 동시 키 replay |
| `src/lib/repositories/imports.ts` | runImport 를 배치 경로로 교체 (행마다 저장·순위 2단계 코드 삭제), JobSummary 에 channel·sourceTool |
| `src/lib/collectors/types.ts` · `normalize.ts` · `coupang/product.ts` · `coupang/search.ts` | **신규** — 수집기 경계 |
| `src/app/api/dev/ingest/route.ts` | **신규** — 개발 전용 테스트 경로 (production 404) |
| `src/components/import/import-history.tsx` | 수집 배치 이름 · "혼합" 유형 표시 |
| `scripts/ingest/test.mjs` · `mock.mjs` | **신규** — 어댑터·정규화·배치 행 테스트, 목업 쿠팡 화면 |
| `scripts/lib/ts-resolve.mjs` | **신규** — 테스트에서 확장자 없는 상대 import 를 .ts 로 찾는 Node 훅 |
| `supabase/verify/phase2_verify.sql` | BI00~BI14 추가 |
| `package.json` | `test:ingest` |

---

## 16. 발견된 문제

1. **같은 데이터를 다른 job 으로 다시 넣으면 스냅샷은 UPDATED, 순위는 SKIPPED 로 집계가 다르다.** 기존 `upsert_*_snapshot()` 은 `import_job_id` 가 바뀌어도 변경으로 보기 때문이다 (원격: 같은 2,000건 재저장 → 갱신 2,000). 값은 그대로라 데이터 문제는 없다. 기존 함수 동작이라 바꾸지 않았다. idempotency_key 를 쓰면 애초에 처리하지 않는다.
2. **배치 안에서는 여전히 행마다 함수를 호출한다** (요청은 1회지만 DB 작업은 O(n), 2,000건 약 1.7초). Supabase 의 API 문 실행 시간 제한(authenticated 기본 8초 내외)을 생각하면 한 배치는 2,000건 안팎이 안전하다. 수집기는 배치를 나눠 보내야 한다.
3. **같은 idempotency_key 동시 요청**은 코드로 처리했다 (23505 → replay). 하지만 실제 동시 실행으로는 시험하지 않았다 (순위 동시성은 시험함).
4. 되돌린(ROLLED_BACK) job 의 idempotency_key 로 다시 보내면 replay 로 끝나고 다시 저장하지 않는다. 다시 넣으려면 새 키가 필요하다.
5. MCP 로 원격 DB 에 두 연결을 동시에 여는 동시성 시험은 실제로 순차 실행되어 증거가 되지 못했다. 앱 경로(브라우저 병렬 요청)로 다시 시험해 확인했다 (맨 위 결과).
6. 쿠팡 실제 DOM selector, WING 화면에서 보이는 지표, 검색 순위를 광고 포함으로 셀지는 확인하지 않았다. 어댑터는 "보인 순서 = 순위"로 두었다.
7. 테스트 도중 브라우저 로그인 세션이 만료되어 재로그인을 요청했다.
8. 개발 전용 경로 `/api/dev/ingest` 가 코드에 남아 있다 (production 404 확인). PHASE 11 에서 정식 `/api/ingest` 를 만들 때 정리할 수 있다.
9. 원격 테스트로 생긴 데이터 ([TEST] 상품 20 · 키워드 1 · 스냅샷 2,406 · 순위 1,003 · 키워드 스냅샷 1 · import job 16)는 모두 삭제했다. 운영 DB 에는 실제 키워드 2개와 그 스냅샷 1건만 남아 있다 (import_jobs · import_rows 0).

---

## 17. 설계 변경 여부

```text
기존 설계 변경 없음 (DB 함수 2개 추가)
```

- Opportunity Score V1 가중치·판정 기준·공식, SourceType, Confidence, 판매량 actual/estimated/predicted 분리, 스냅샷 구조·자연키·NULL 의미, RLS, `/import` 동작, Dashboard, Profit 을 바꾸지 않았다.
- 테이블·컬럼·인덱스·정책 변경 없음. 추가된 것은 기존 구조 위의 함수 2개(배치 저장, 순위 원자 UPSERT)뿐이다.
- 바꾸지 않았지만 검토할 점: 16절 1번 (스냅샷 함수가 import_job_id 변경만으로 UPDATED 를 내는 것). 바꾸려면:
  - 현재 설계: 스냅샷 SKIPPED 판정에 import_job_id 포함
  - 변경 제안: 값이 같으면 SKIPPED (import_job_id 유지)
  - 변경 이유: 재수집 집계를 정확히 하기 위해
  - 영향: rollback_import 의 LATER_IMPORT 판정이 달라진다

  이 변경은 결정이 필요하다.

---

## 18. PHASE 11 에서 Chrome Extension 을 어떻게 연결할 수 있는지

```text
Chrome Extension
  ├ 쿠팡 상품 페이지  → (content script: 실제 selector 로 문자열 읽기) → RawCoupangProductPage
  ├ 쿠팡 검색 결과    → RawCoupangSearchPage
  └ WING 화면        → CollectedProduct.wing (source = WING_SESSION)
        │  adaptProductPage / adaptSearchPage  (이번에 만든 순수 함수 — 확장 프로그램 번들에 넣어도 됨)
        ▼
  Collected* 배열 + idempotencyKey (배치마다 UUID) + tool ("jarvis-extension/x.y")
        │  POST /api/ingest   (새로 만들 것)
        ▼
  인증 → ingestCollected() → ingest_batch() → import_jobs(channel EXTENSION) / snapshots / ranks
        ▼
  Dashboard 데이터 상태 · 점수 미리 보기에 바로 반영 (점수 저장은 수동 유지)
```

PHASE 11 에서 정할 것:
1. **인증:** 확장 프로그램은 service role 을 쓰지 않는다. 방법은 둘 중 하나다.
   - JARVIS 에 로그인한 사용자의 Supabase 세션(access token)을 확장 프로그램이 받아 `Authorization: Bearer` 로 보내고, 서버가 그 토큰으로 RLS 클라이언트를 만든다.
   - 사용자별 발급 토큰을 만든다 (DB 변경 필요).
2. **`/api/ingest` 정식 경로:** CORS(확장 프로그램 origin), 요청 크기·건수 제한(2,000), 속도 제한. 응답은 job 요약과 issue.
3. **실제 selector:** 쿠팡 화면을 직접 확인해 RawCoupang* 를 채운다. 이 단계에서 다음도 확인한다.
   - WING 에서 실제로 보이는 값 (조회수·전환율 외)
   - 검색 순위를 셀 때 광고를 포함할지
4. **미등록 상품 처리:** 지금은 PRODUCT_NOT_FOUND 이다. 확장 프로그램에서 "이 상품 등록" 버튼을 둘지, 자동 생성 옵션(import_rows 에 products 기록 → rollback 가능)을 둘지 결정한다.
5. **배치 크기:** 2,000건 이하로 나눠 보낸다 (16절 2번).
6. **CAPTCHA·로그인 우회·비공개 API 추측 없음:** 사용자가 직접 보고 있는 화면의 텍스트만 읽는 방식으로 한다.
