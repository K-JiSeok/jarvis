# JARVIS PHASE 2 — Supabase DB 설계안 (검토용)

> - 프로젝트명은 PHASE 1 후속 작업에서 **MY COUPILOT → JARVIS**로 통일됨.
> - 이 문서는 **설계안**이다. SQL 작성·실행, Supabase 테이블 생성은 하지 않았다. 승인 후 진행한다.
> - 기존 코드(`src/types/common.ts`, `src/config/scoring-weights.ts`)의 SourceType / Confidence / Verdict / RiskType / 점수 가중치 정의를 그대로 따른다.
> - 문서 구성: **Part A**는 보고 항목 1~2, 8~15와 질문 A~J 답변. **Part B "PHASE 2 DB 설계 최종안"**은 보고 항목 3~7(컬럼·타입·PK/FK·UNIQUE·INDEX)을 테이블별로 정리한 구현용 명세.

---

# Part A. 설계 보고

## 1. 최종 추천 테이블 목록 (19개 + 뷰 4개)

| # | 테이블 | 구분 | 원안 대비 |
|---|---|---|---|
| 1 | `categories` | 마스터 | 유지 (+카테고리별 수수료율) |
| 2 | `keywords` | 마스터 | **분리** — 기본 정보만 |
| 3 | `keyword_snapshots` | 시계열 | **추가** — 검색량·경쟁도 등 변하는 값 |
| 4 | `products` | 마스터 | 유지 — 변하지 않거나 거의 안 변하는 값만 |
| 5 | `product_snapshots` | 시계열 | 유지 — 예측값(predicted)은 제외 (→ 17) |
| 6 | `keyword_product_ranks` | 시계열 | **추가** — 키워드별 검색 순위 (순위는 키워드에 종속) |
| 7 | `competitors` | 관계 | 유지 |
| 8 | `profit_scenarios` | 입력 | `profit_inputs` → **이름 변경·확장** (상품당 여러 시나리오) |
| 9 | `profit_calculations` | 계산 결과 | **추가** — 입력과 결과 분리 |
| 10 | `scoring_versions` | 설정 | **추가** — 점수 알고리즘 버전 레지스트리 |
| 11 | `opportunity_scores` | 계산 결과 | 유지 (+버전·키워드 맥락·입력 참조) |
| 12 | `product_risks` | 계산/입력 | **추가** — 상품당 위험요소 N개 |
| 13 | `watchlist` | 사용자 | 유지 (+outcome 분리) |
| 14 | `watchlist_events` | 이력 | **추가** — 상태 변경 이력 |
| 15 | `my_listings` | 실제 판매 | **추가** — 내가 실제로 등록한 판매 건 |
| 16 | `sales_results` | 실제 판매 | **추가** — 기간별 실제 판매 결과 |
| 17 | `predictions` | 예측 | **추가** — JARVIS 예측값 (판매량·매출·순이익) |
| 18 | `import_jobs` | 수집 | 유지 — CSV와 확장프로그램 배치를 하나로 통합 |
| 19 | `import_rows` | 수집 | **추가** — 원본 행 보관, 행 단위 결과·오류 |

| 뷰 | 목적 |
|---|---|
| `v_product_latest` | 상품별 "현재 값" (최신 유효 스냅샷 병합) |
| `v_keyword_latest` | 키워드별 현재 값 |
| `v_current_scores` | 활성 점수 버전의 현재 점수 |
| `v_prediction_vs_actual` | 예측 vs 실제 비교 |

## 2. 각 테이블의 목적

| 테이블 | 목적 |
|---|---|
| categories | 쿠팡 카테고리 트리. 카테고리별 기본 수수료율 보관 → 수익성 계산 기본값 |
| keywords | 분석 대상 키워드 자체 (정규화 키로 중복 방지) |
| keyword_snapshots | 키워드의 날짜·출처별 시장 지표 (검색량, 상품수, WING/로켓 비율, 평균가, 평균 리뷰, 브랜드 집중도, 광고 입찰가) |
| products | 쿠팡 상품 1개 = 1행. 쿠팡 ID, 현재 상품명, 브랜드, 카테고리, 판매자 유형, 생존 상태 |
| product_snapshots | 상품의 날짜·출처별 관측값 (가격, 리뷰, 평점, 조회수, 판매량 actual/estimated, 매출, 전환율, 배송유형) |
| keyword_product_ranks | "키워드 X 검색 시 상품 Y가 N위" (광고/자연 구분). 같은 상품이 여러 키워드에 나와도 상품은 1행 |
| competitors | 상품 ↔ 경쟁상품 관계 (어떤 키워드 맥락에서 경쟁인지 포함) |
| profit_scenarios | 수익성 **입력값** (판매가, 원가, 배송비, 수수료율, 물류비, 광고비 등). 상품당 여러 시나리오 가능 |
| profit_calculations | 수익성 **계산 결과** (순이익, 이익률, ROI, 손익분기 판매량) + 계산식 버전 + 계산 당시 입력값 사본 |
| scoring_versions | 점수 알고리즘 버전별 가중치·판정 기준 (v1 = 현재 `scoring-weights.ts`) |
| opportunity_scores | 상품(+키워드 맥락)의 기회점수와 9개 세부 점수, 판정, 근거. 버전별로 보존 |
| product_risks | 위험요소 (브랜드 독점, 리뷰 과다, 가격 경쟁, 쿠팡 PB, 낮은 마진, 대형/중량, 계절성, 광고 의존도) |
| watchlist | 관심상품, 메모, 진행 상태, 최종 성과 |
| watchlist_events | 관심상품 상태 변경 이력 (언제 TESTING → SELLING이 됐는지) |
| my_listings | 실제 판매 건. "분석했던 상품"과 "내가 등록한 내 상품"을 연결하고, 판매 결정 당시 점수·수익성 계산을 고정 |
| sales_results | 판매 건의 일/주/월 단위 실제 판매량·매출·광고비·원가·물류비·순이익 |
| predictions | JARVIS가 특정 시점에 특정 미래 기간에 대해 낸 예측값 (불변 기록) |
| import_jobs | 가져오기 1회 = 1행 (파일 또는 확장프로그램 전송 배치). 상태·건수·오류 요약 |
| import_rows | 가져온 원본 행(JSON) 보관 + 행별 처리 결과. 재처리·롤백·오류 추적용 |

## 8. 관계도

```
auth.users ─┬─(owner_id)─ 모든 사용자 테이블
            │
categories ◄──┐ parent_id (자기참조)
   ▲          │
   │ category_id
   ├──────────── keywords ──1:N── keyword_snapshots
   │                │
   │                └──1:N── keyword_product_ranks ──N:1──┐
   │                                                       │
   └──────────── products ◄────────────────────────────────┘
                   │
                   ├──1:N── product_snapshots
                   ├──1:N── competitors (product_id, competitor_product_id → products)
                   ├──1:N── profit_scenarios ──1:N── profit_calculations
                   ├──1:N── opportunity_scores ──N:1── scoring_versions
                   │            └──1:N── product_risks (계산된 위험)
                   ├──1:N── product_risks (수동 위험)
                   ├──1:1── watchlist ──1:N── watchlist_events
                   │            │
                   │            └──1:N── my_listings ──1:N── sales_results
                   │                       │  ├─ reference_product_id → products (분석한 상품)
                   │                       │  ├─ own_product_id      → products (내 상품)
                   │                       │  ├─ baseline_score_id   → opportunity_scores
                   │                       │  └─ baseline_profit_calc_id → profit_calculations
                   │                       └──1:N── predictions
                   └──1:N── predictions

import_jobs ──1:N── import_rows
     └── import_job_id ← keyword_snapshots / product_snapshots / keyword_product_ranks / sales_results
```

## 9. RLS 전략

- **모든 테이블 RLS 활성화.** 예외 없음.
- 모든 사용자 데이터 테이블에 `owner_id uuid NOT NULL DEFAULT auth.uid()` (FK `auth.users`)를 둔다. 자식 테이블(스냅샷 등)에도 비정규화해서 넣는다. 그러면 정책이 JOIN 없이 `owner_id = (select auth.uid())` 한 줄로 끝나고, 대용량 테이블에서 성능도 안전하다.
- 정책: `authenticated` 역할에 SELECT/INSERT/UPDATE/DELETE 모두 `owner_id = (select auth.uid())`. INSERT/UPDATE는 `WITH CHECK`도 같은 조건. `anon`은 접근 불가.
- `scoring_versions`는 전역 설정이다. `authenticated`는 SELECT만 가능하고, 변경은 마이그레이션(또는 service role)으로만 한다.
- **개인용 운영 설정:** Supabase Auth에서 신규 가입(Sign-ups)을 끄고 본인 계정 1개만 사용한다.
- **service role 키**는 서버 코드(Route Handler, 배치 작업)에서만 쓴다. RLS를 우회하므로 이때는 `owner_id`를 코드에서 명시적으로 넣는다. 브라우저·확장프로그램에는 절대 넣지 않는다 (`.env.example` 주석과 동일).
- **SaaS 확장성:** `owner_id`가 이미 모든 행에 있으므로 다중 사용자는 정책 변경 없이 동작한다. 단, 상품 마스터를 사용자 간 공유할지는 15-⑬ 참고.

## 10. Snapshot 저장 전략

1. **마스터와 시계열을 분리한다.** `products`/`keywords`에는 식별자와 거의 안 변하는 속성만 둔다. 가격·리뷰·검색량처럼 변하는 값은 전부 `*_snapshots`에 쌓는다.
2. **스냅샷 단위 = (대상, 수집일 KST, 출처).** UNIQUE `(product_id, captured_on, source_type)`.
   - 같은 날 같은 출처로 다시 수집하면 **UPSERT**한다. 새 값이 NULL이면 기존 값을 지우지 않는다 (`COALESCE(new, old)`). `captured_at`은 최신 시각으로 갱신한다.
   - 같은 날이라도 출처가 다르면 별도 행으로 둔다. 예: EXTENSION 추정 판매량과 WING_SESSION 실제값이 공존 가능.
   - 하루 안의 모든 원본 관측은 `import_rows`에 남으므로 손실이 없다.
3. **출처·신뢰도는 행 단위가 기본이다.** 한 번의 수집은 대부분 하나의 출처에서 오기 때문이다. 같은 행 안에서 특정 항목만 출처가 다른 경우(예: 페이지에서 가격, 내부 계산으로 매출)는 `metric_meta jsonb`에 `{"revenue_estimated": {"source":"CALCULATED","confidence":"B"}}` 형태로 항목별로 덮어쓴다.
4. **"현재 값" = `v_product_latest` 뷰.** 제외되지 않은(`is_excluded = false`) 스냅샷 중에서 항목별로 우선순위가 가장 높은 값을 고른다. 우선순위는 ① 최신 수집일 → ② 신뢰도 A > B > C → ③ 출처 MANUAL > WING_SESSION > OFFICIAL_API > COUPANG_PAGE > EXTENSION > CALCULATED > ESTIMATED.
   - 처음에는 일반 뷰로 시작한다. 느려지면 materialized view나 `products.latest_snapshot_id` 캐시를 쓴다.
5. **판매량·매출은 세 계열을 절대 합치지 않는다.**
   - `sales_actual`, `revenue_actual` → `product_snapshots`. 출처가 실제값을 줄 때만 채운다 (예: WING에서 확인한 내 상품).
   - `sales_estimated`, `revenue_estimated` → `product_snapshots`. 외부 도구 또는 역산 추정값.
   - `sales_predicted`, `revenue_predicted` → **`predictions` 테이블.** 예측은 "언제(predicted_at) 어떤 기간(target_period)에 대해 어떤 모델 버전으로" 낸 값이라 관측 스냅샷과 축이 다르다. 스냅샷에 섞으면 "10/1 관측값"과 "10/1에 낸 11월 예측값"이 구분되지 않는다. 시계열 화면에서는 뷰로 함께 보여준다.
6. **집계 기간을 명시한다.** `views_28d`는 28일 기준이고, 판매량·매출은 `sales_period_days`(예: 28, 30)를 함께 저장해 다른 도구 데이터와 섞여도 비교할 수 있게 한다.
7. **NULL = 모름, 0 = 실제로 0.** 값이 없을 때 0을 넣지 않는다 (`DataPoint.value: null` 원칙과 동일).

## 11. Import 중복 방지 전략

4단계로 막는다.

| 단계 | 장치 | 효과 |
|---|---|---|
| ① 파일 | `import_jobs.file_hash` (SHA-256) + 부분 UNIQUE `(owner_id, file_hash, import_type) WHERE status IN ('SUCCEEDED','PARTIAL')` | 같은 파일을 다시 올리면 차단 또는 경고. 롤백된 파일은 재업로드 허용 |
| ② 배치 | `import_jobs.idempotency_key` UNIQUE | 확장프로그램이 네트워크 오류로 같은 배치를 재전송해도 1번만 처리 |
| ③ 행 | 대상 테이블의 **자연키 UNIQUE + UPSERT** (예: 스냅샷 `(product_id, captured_on, source_type)`, 마스터 `(owner_id, coupang_product_id)`) | 내용이 겹치는 다른 파일을 올려도 행이 중복되지 않고 갱신만 됨 |
| ④ 추적 | `import_rows.record_key / result / target_id / previous_values` | 행별로 INSERTED / UPDATED / SKIPPED / FAILED 기록. 잘못된 import는 `import_job_id` 단위로 롤백 (INSERTED는 삭제, UPDATED는 previous_values로 복원) |

추가 원칙:
- **dry run(미리보기):** `import_jobs.dry_run = true`로 먼저 검증하고 "신규 N / 갱신 M / 실패 K"를 보여준 뒤 확정한다.
- 원본 파일은 Supabase Storage(`imports/{owner_id}/{job_id}/파일명`)에 보관하고 `storage_path`로 연결한다. 매핑 오류가 나면 원본에서 재처리한다.
- 컬럼 매핑(엑셀 헤더 → DB 컬럼)은 `column_mapping jsonb`에 저장한다. 같은 확장프로그램 포맷은 다음에 재사용한다.

## 12. 향후 Chrome Extension 연결 전략

- **CSV와 같은 파이프라인을 탄다.** 확장프로그램 전송 1회 = `import_jobs` 1행(`channel = 'EXTENSION'`), 상품 1개 = `import_rows` 1행. 파싱·검증·UPSERT 로직을 하나만 유지하면 된다.
- 경로: 확장프로그램 → `POST /api/ingest` (Next.js Route Handler) → 검증 → `import_jobs`/`import_rows` 저장 → 대상 테이블 UPSERT.
- 페이로드 계약:
  ```
  { schema_version, idempotency_key, source_type: "EXTENSION" | "COUPANG_PAGE" | "WING_SESSION",
    client: { name, version }, captured_at,
    items: [ { kind: "product_snapshot" | "keyword_snapshot" | "search_rank", data: {...} } ] }
  ```
  `schema_version`이 있어서 확장프로그램이 바뀌어도 서버가 구버전 페이로드를 처리할 수 있다.
- 인증: 확장프로그램은 사용자 본인의 Supabase 세션(JWT) 또는 PHASE 11에서 만들 개인 토큰(`api_tokens` 테이블, 해시만 저장)을 쓴다. **service role 키나 anon 키 직접 쓰기는 금지.** 서버가 검증하고 기록한다.
- 확장프로그램은 **쿠팡 ID만 보내면 된다.** 서버가 `products`를 `(owner_id, coupang_product_id)`로 찾거나 만든다. 확장프로그램이 DB의 uuid를 알 필요가 없다.

## 13. 실제 판매 결과 저장 전략

- **분석한 상품 ≠ 내가 파는 상품.** 경쟁사 상품(productId A)을 보고 결정해도, 실제로 등록하면 내 상품은 다른 productId B가 된다. `my_listings`가 둘을 연결한다.
  - `reference_product_id` → 분석했던 상품 A
  - `own_product_id` → 내 상품 B (`products.is_own_product = true`). 내 상품도 스냅샷을 쌓을 수 있다.
- **판매 결정 시점을 고정한다.** `my_listings.baseline_score_id`, `baseline_profit_calc_id`에 "그때 JARVIS가 몇 점을 줬고 순이익을 얼마로 계산했는지"를 FK로 박아 둔다. 점수 행은 불변이라 이후 재계산해도 기준이 바뀌지 않는다.
- **실적은 기간 단위로 쌓는다.** `sales_results`는 (판매건, 기간 유형 DAY/WEEK/MONTH, 기간 시작일, 출처)가 UNIQUE다. WING 정산 CSV를 다시 올려도 중복되지 않는다.
- **순이익·순이익률은 생성 컬럼(generated column)으로 둔다.** 매출과 각 비용을 원본으로 저장하고, `net_profit`과 `net_margin_rate`는 DB가 계산한다. 원본과 결과가 어긋날 수 없다. 비용 하나라도 NULL이면 결과도 NULL(모름)이 된다.
- **예측 vs 실제:** `predictions`(listing_id, target_period)와 `sales_results`(listing_id, period)를 `v_prediction_vs_actual`에서 기간 기준으로 맞춰 오차(절대·비율)를 계산한다.
- **알고리즘 개선용 데이터셋:** `my_listings → baseline_score(9개 세부점수, 버전) + 실적 합계 + watchlist.outcome`을 조인하면 "어떤 세부점수가 실제 성과와 상관이 높았는지"를 분석할 수 있다. 이 결과가 V2 가중치의 근거가 된다.

## 14. 점수 버전 관리 전략

- `scoring_versions`가 버전 레지스트리다. `v1`의 `weights`/`thresholds`는 현재 `src/config/scoring-weights.ts`와 동일하게 시드한다.
- **릴리스된 버전은 불변이다.** 가중치 하나만 바꿔도 새 버전(`v1.1`)으로 만든다. 활성 버전은 부분 UNIQUE로 항상 1개다.
- **점수 행도 불변이다 (append-only).** 재계산은 새 행 INSERT로 하고, 이전 행은 `is_current = false`로 내린다. UPDATE로 덮어쓰지 않는다.
  - `is_current`는 (상품, 키워드 맥락, 버전)마다 1개다. 그래서 **V1 현재 점수와 V2 현재 점수가 동시에 존재**하고 나란히 비교할 수 있다.
- **재현성:** `input_refs jsonb`에 계산에 쓴 스냅샷 id, 키워드 스냅샷 id, 수익성 계산 id를 기록한다. V2가 나오면 같은 과거 입력으로 백테스트할 수 있다.
- **세부점수 저장 방식:** V1의 9개 요소는 명시 컬럼(0~100으로 정규화된 요소 점수)으로 둔다. 가중합은 `total_score`. V2에서 새 요소가 생기면 `extra_factor_scores jsonb`에 넣고, 정착하면 컬럼으로 승격한다.
- 판정(verdict)도 버전의 `thresholds`로 결정되므로 점수와 함께 저장한다. 기준이 바뀌어도 과거 판정이 보존된다.
- 수익성 계산식도 같은 원리다. `profit_calculations.formula_version` + `inputs_snapshot`.

## 15. 내가 생각하지 못한 DB 설계상의 문제

1. **쿠팡 상품 ID는 3단계다.** `productId`(상품) / `itemId`(옵션 조합) / `vendorItemId`(판매자별 옵션). 같은 productId 안에서도 옵션·판매자마다 가격이 다르다. V1은 **productId 단위로 추적**하고 대표 `vendorItemId`만 기록할 것을 권장한다. 옵션별 분석이 필요해지면 `product_variants`를 추가한다.
2. **순위는 상품의 속성이 아니다.** "순위"는 특정 키워드 검색 결과에서의 위치다. 광고 노출과 자연 노출 순위도 다르다. 그래서 `product_snapshots.rank`가 아니라 `keyword_product_ranks`(is_ad 구분)로 분리했다. 카테고리 랭킹만 `category_rank`로 스냅샷에 둔다.
3. **예측값을 스냅샷에 넣으면 시간축이 꼬인다** (10-5 참고). 그래서 `predictions`로 분리했다.
4. **집계 기간이 도구마다 다르다** (28일 조회수, 30일 판매량, 월 검색량). 기간 컬럼 없이 숫자만 저장하면 나중에 비교가 불가능하다.
5. **날짜 경계 = 한국 시간.** `captured_on`은 KST 기준 date로 저장한다. UTC로 자르면 밤 9시 이후 수집분이 다음 날로 들어간다.
6. **같은 상품이라도 키워드마다 점수가 다를 수 있다.** 수요·경쟁은 키워드에 달려 있다. 그래서 `opportunity_scores.keyword_id`(NULL = 키워드 무관 종합 점수)를 둔다.
7. **SUCCESS/FAILED는 상태가 아니라 결과다.** 판매 중(SELLING)이면서 성공일 수 있다. `watchlist.status`(진행 단계)와 `watchlist.outcome`(성과 판정)을 분리했다.
8. **손익분기 판매량에는 고정비가 필요하다.** 단위당 이익만으로는 계산되지 않는다. 초기 발주·샘플·촬영·상세페이지 같은 비용을 `profit_scenarios.fixed_cost_total`로 입력받는다.
9. **부가세와 통화.** 쿠팡 판매가는 VAT 포함이고, 수수료 기준도 VAT를 고려해야 한다. `vat_included`를 명시한다. 해외 소싱 원가는 원 통화 금액 + 환율로 저장한다(`unit_cost_amount`, `unit_cost_currency`, `exchange_rate`). 환율이 바뀌어도 재계산이 가능하다.
10. **수수료율은 카테고리마다 다르다.** `categories.coupang_fee_rate`를 기본값으로 두고, 시나리오에서 덮어쓸 수 있게 한다.
11. **상품 삭제 시 CASCADE 금지.** 쿠팡에서 상품이 사라져도 DB 행은 지우지 않는다(`lifecycle_status = 'DELETED'`). 사라진 상품의 과거 데이터는 "실패한 상품" 학습에 오히려 중요하다. 실제 삭제는 잘못 만든 테스트 데이터에만 쓴다.
12. **DEMO 데이터 혼입.** PHASE 1의 DEMO 데이터는 DB에 넣지 않는다(코드 mock 유지). 넣어야 한다면 별도 프로젝트(Supabase dev)에 넣는다. 운영 DB에 데모 행이 섞이면 점수 학습이 오염된다.
13. **사용자별 상품 마스터 중복 (SaaS 전환 시).** 지금은 `products`도 `owner_id`별이라 사용자 A·B가 같은 쿠팡 상품을 각각 저장한다. 개인용으로는 이게 가장 단순하고 안전하다. SaaS로 가면 "공용 카탈로그 + 사용자별 관측" 분리를 검토한다. 지금 구조는 그 분리를 막지 않는다.
14. **Supabase 무료 플랜은 7일 비활성 시 일시정지된다.** 개인용으로 띄엄띄엄 쓰면 멈출 수 있다. Pro 플랜 또는 주기적 접속(스케줄 수집)을 고려한다. 무료 플랜은 자동 백업도 제한적이므로 주기적 `pg_dump` 또는 Pro 백업이 필요하다.
15. **용량 추정.** 상품 1,000개 × 매일 × 출처 2개 ≈ 연 73만 행. 키워드 순위까지 합쳐도 연 수백만 행 수준이라 파티셔닝은 불필요하다. 인덱스만 맞게 잡으면 된다. `import_rows.payload`(원본 JSON)가 가장 빨리 커지므로 90일~1년 보관 후 정리 정책을 둔다.
16. **`updated_at` 자동 갱신 트리거**와 **`watchlist` 상태 변경 시 `watchlist_events` 자동 기록 트리거**가 필요하다 (앱 코드에서 빠뜨려도 이력 유지).
17. **사용자가 바꾼 값과 수집 값의 충돌.** 수동 수정은 원본을 덮어쓰지 않고 `source_type = 'MANUAL'` 스냅샷 행으로 추가한다. 우선순위 규칙에서 MANUAL이 이기므로 화면에는 수정값이 보이고, 원본도 남는다.

## 14번 질문 A~J 답변 요약

| 질문 | 답 |
|---|---|
| A. 현재 값 vs 과거 Snapshot | 마스터(products/keywords)는 식별·정적 속성만. 변하는 값은 전부 스냅샷. 현재 값은 `v_product_latest` 뷰가 우선순위 규칙으로 계산 (10-4) |
| B. 상품 삭제·이름 변경 | 행 삭제 없이 `lifecycle_status`(ACTIVE/UNAVAILABLE/DELETED) + `last_seen_at` + `deleted_detected_at`. 이름은 `products.product_name`(최신)을 갱신하고, 관측 당시 이름은 `product_snapshots.product_name_observed`에 남아 이력 추적 가능 |
| C. 여러 키워드에서 같은 상품 | `products` UNIQUE `(owner_id, coupang_product_id)`로 1행. 키워드 연결은 `keyword_product_ranks`가 담당 |
| D. 여러 날짜 수집 | 날짜(KST)·출처별 1행. 같은 날 재수집은 NULL 비보존 UPSERT. 원본은 import_rows에 전부 남음 |
| E. 잘못된 외부 데이터 | ① 행 단위: `is_excluded` + `excluded_reason`(soft 제외, 현재값 계산에서 빠짐) ② 값 수정: MANUAL 스냅샷 추가 ③ 배치 단위: `import_job_id`로 롤백 (INSERTED 삭제, UPDATED 복원) |
| F. CSV 반복 import | 파일 해시 + 배치 idempotency_key + 자연키 UPSERT + 행 결과 추적 (11번) |
| G. Chrome Extension | CSV와 동일 파이프라인, `/api/ingest`, idempotency_key·schema_version, 쿠팡 ID 기반 (12번) |
| H. 실제 판매 결과 | my_listings(분석 상품↔내 상품, 결정 시점 점수 고정) + sales_results(기간별, 생성 컬럼) + predictions (13번) |
| I. 점수 V2/V3 | scoring_versions 불변 + 점수 행 append-only + 버전별 is_current + input_refs로 백테스트 (14번) |
| J. 인덱스 | Part B 각 테이블 INDEX 항목. 핵심: `(owner_id, 쿠팡ID)` UNIQUE, `(product_id, captured_on DESC)`, `(keyword_id, captured_on DESC, rank_position)`, `import_job_id`, 현재 점수 부분 인덱스, 모든 FK 컬럼 |

### SourceType / Confidence: enum vs text+CHECK → **text + CHECK 권장**

| | PostgreSQL enum | text + CHECK (권장) |
|---|---|---|
| 값 추가 | `ALTER TYPE ADD VALUE` (트랜잭션 제약 있음) | 제약조건 교체 1줄 |
| 값 삭제·이름 변경 | 사실상 불가 (타입 재생성 필요) | 데이터 UPDATE + 제약 교체 |
| TS 타입 생성 | `supabase gen types`가 union 생성 | string으로 생성 → **이미 `src/types/common.ts`에 상수·union이 있어 손실 없음** |
| 정렬 | 정의 순서 | 문자열 순서 (우선순위는 뷰에서 CASE로 명시) |

이유: SourceType·상태값은 PHASE가 진행되며 바뀔 가능성이 높다 (watchlist 상태는 이번에 이미 바뀌었다). 같은 체크를 여러 테이블에 반복하지 않도록 PostgreSQL **DOMAIN**으로 한 번만 정의한다: `source_type_t`, `confidence_t`, `risk_type_t`, `risk_level_t`, `verdict_t`.

---

# Part B. PHASE 2 DB 설계 최종안

## 공통 규칙

| 항목 | 규칙 |
|---|---|
| PK | 마스터·사용자 테이블은 `id uuid DEFAULT gen_random_uuid()`. 대용량 시계열(스냅샷·순위·import_rows·sales_results·events)은 `id bigint GENERATED ALWAYS AS IDENTITY` |
| 소유자 | `owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE` (scoring_versions 제외 전 테이블) |
| 시각 | `created_at timestamptz NOT NULL DEFAULT now()`, 변경 가능한 테이블은 `updated_at timestamptz NOT NULL DEFAULT now()` + 트리거 |
| 금액 | 원화 정수 `bigint` (원 단위). 외화 원가만 `numeric(14,2)` + 통화 + 환율 |
| 비율 | `numeric(6,4)` 0~1 (예: 0.1250 = 12.5%). TS 타입의 "0~1 비율"과 동일 |
| 점수 | `numeric(5,2)` 0~100 |
| 수집일 | `captured_on date` = KST 날짜, `captured_at timestamptz` = 실제 시각 |
| NULL | 모름 = NULL. 0으로 채우지 않음 |
| 삭제 | 마스터는 soft 상태값. 하위 시계열 FK는 `ON DELETE CASCADE`(마스터를 정말 지울 때만 해당), import 참조는 `ON DELETE SET NULL` |

DOMAIN:

| 도메인 | 허용값 |
|---|---|
| `source_type_t` | OFFICIAL_API, COUPANG_PAGE, WING_SESSION, EXTENSION, CALCULATED, MANUAL, ESTIMATED |
| `confidence_t` | A, B, C |
| `verdict_t` | STRONG_BUY, REVIEW, EXCLUDE |
| `risk_type_t` | BRAND_MONOPOLY, REVIEW_OVERLOAD, PRICE_WAR, COUPANG_PB, LOW_MARGIN, BULKY_HEAVY, SEASONALITY, AD_DEPENDENCY |
| `risk_level_t` | LOW, MEDIUM, HIGH |

---

### 1) categories

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| coupang_category_id | text | 쿠팡 카테고리 코드 (수동 생성 시 NULL 허용) |
| name | text | NOT NULL |
| parent_id | uuid | FK → categories(id) ON DELETE SET NULL |
| depth | smallint | 1=대분류 |
| path | text | "생활용품>욕실용품>수건" (표시·검색용) |
| coupang_fee_rate | numeric(6,4) | 카테고리 기본 판매수수료율 |
| is_active | boolean | NOT NULL DEFAULT true |
| source_type | source_type_t | NOT NULL |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: `(owner_id, coupang_category_id)`
- INDEX: `(parent_id)`

### 2) keywords

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| keyword | text | NOT NULL, 입력 원문 |
| normalized_keyword | text | NOT NULL, 소문자·공백 정리본 (중복 판정 키) |
| category_id | uuid | FK → categories ON DELETE SET NULL |
| is_tracking | boolean | NOT NULL DEFAULT true (정기 수집 대상) |
| memo | text | |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: `(owner_id, normalized_keyword)`
- INDEX: `(category_id)`

### 3) keyword_snapshots

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| keyword_id | uuid | NOT NULL FK → keywords ON DELETE CASCADE |
| captured_on | date | NOT NULL (KST) |
| captured_at | timestamptz | NOT NULL |
| source_type | source_type_t | NOT NULL |
| confidence | confidence_t | NOT NULL |
| search_volume | integer | 월 검색량 |
| search_volume_previous | integer | 전월 검색량 |
| search_growth_rate | numeric(8,4) | 증감률 (-0.25 = -25%) |
| coupang_product_count | integer | 쿠팡 검색 결과 상품 수 |
| competition_intensity | numeric(12,4) | 상품수 ÷ 검색량 |
| wing_ratio | numeric(6,4) | 상위 N개 중 WING 비율 |
| rocket_ratio | numeric(6,4) | 상위 N개 중 로켓 비율 |
| average_price | bigint | 상위 N개 평균가 (원) |
| average_reviews | numeric(12,2) | 상위 N개 평균 리뷰 수 |
| brand_concentration | numeric(6,4) | 상위 N개 중 최다 브랜드 점유율 |
| sample_size | smallint | 위 평균·비율 계산에 쓴 상위 상품 수 N |
| ad_bid | bigint | 광고 입찰가 (원) |
| metric_meta | jsonb | NOT NULL DEFAULT '{}' — 항목별 source/confidence 덮어쓰기 |
| import_job_id | uuid | FK → import_jobs ON DELETE SET NULL |
| is_excluded | boolean | NOT NULL DEFAULT false |
| excluded_reason | text | |
| created_at | timestamptz | 공통 |

- UNIQUE: `(keyword_id, captured_on, source_type)`
- INDEX: `(keyword_id, captured_on DESC)`, `(import_job_id)`

### 4) products

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| coupang_product_id | text | NOT NULL — 쿠팡 productId (숫자지만 text로 저장, 앞자리 0·길이 변화 대비) |
| coupang_item_id | text | 대표 itemId |
| coupang_vendor_item_id | text | 대표 vendorItemId |
| product_url | text | |
| product_name | text | NOT NULL — 최신 관측 상품명 |
| brand | text | |
| category_id | uuid | FK → categories ON DELETE SET NULL |
| seller_type | text | CHECK IN (COUPANG_RETAIL, ROCKET_GROWTH_SELLER, WING_SELLER, UNKNOWN) |
| option_count | smallint | |
| is_coupang_pb | boolean | 쿠팡 PB 여부 (NULL = 모름) |
| is_own_product | boolean | NOT NULL DEFAULT false — 내가 판매하는 상품 |
| lifecycle_status | text | NOT NULL DEFAULT 'ACTIVE', CHECK IN (ACTIVE, UNAVAILABLE, DELETED) |
| first_seen_at | timestamptz | NOT NULL |
| last_seen_at | timestamptz | NOT NULL |
| deleted_detected_at | timestamptz | |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: `(owner_id, coupang_product_id)`
- INDEX: `(category_id)`, `(owner_id, lifecycle_status, last_seen_at DESC)`, `(brand)`; 상품명 검색이 필요하면 `pg_trgm` GIN `(product_name)`

### 5) product_snapshots

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| captured_on | date | NOT NULL (KST) |
| captured_at | timestamptz | NOT NULL |
| source_type | source_type_t | NOT NULL |
| confidence | confidence_t | NOT NULL |
| product_name_observed | text | 관측 당시 상품명 (이름 변경 이력) |
| price | bigint | 판매가 |
| original_price | bigint | 정가 |
| discount_rate | numeric(6,4) | |
| delivery_type | text | CHECK IN (ROCKET, ROCKET_GROWTH, ROCKET_FRESH, SELLER_DELIVERY, OVERSEAS, OTHER) |
| seller_type_observed | text | products.seller_type와 같은 값 집합 |
| review_count | integer | |
| rating | numeric(3,2) | 0.00~5.00 |
| category_rank | integer | 카테고리 랭킹 (키워드 순위는 6번 테이블) |
| option_count | smallint | |
| views_28d | integer | 28일 조회수 |
| sales_period_days | smallint | 판매량·매출 집계 기간 (예: 28, 30) |
| sales_actual | integer | 실제 판매량 |
| sales_estimated | integer | 추정 판매량 |
| revenue_actual | bigint | 실제 매출 |
| revenue_estimated | bigint | 추정 매출 |
| conversion_rate | numeric(6,4) | 판매 ÷ 조회 |
| metric_meta | jsonb | NOT NULL DEFAULT '{}' — 항목별 source/confidence 덮어쓰기 |
| import_job_id | uuid | FK → import_jobs ON DELETE SET NULL |
| is_excluded | boolean | NOT NULL DEFAULT false |
| excluded_reason | text | |
| created_at | timestamptz | 공통 |

- UNIQUE: `(product_id, captured_on, source_type)`
- INDEX: `(product_id, captured_on DESC)`, `(owner_id, captured_on DESC)`, `(import_job_id)`
- `sales_predicted`, `revenue_predicted`는 이 테이블에 두지 않는다 → `predictions` (Part A 10-5).

### 6) keyword_product_ranks

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| keyword_id | uuid | NOT NULL FK → keywords ON DELETE CASCADE |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| captured_on | date | NOT NULL |
| captured_at | timestamptz | NOT NULL |
| source_type | source_type_t | NOT NULL |
| confidence | confidence_t | NOT NULL |
| rank_position | integer | NOT NULL, CHECK > 0 |
| is_ad | boolean | NOT NULL DEFAULT false |
| page | smallint | |
| import_job_id | uuid | FK → import_jobs ON DELETE SET NULL |
| created_at | timestamptz | 공통 |

- UNIQUE: `(keyword_id, product_id, captured_on, source_type, is_ad)`
- INDEX: `(keyword_id, captured_on DESC, rank_position)`, `(product_id, captured_on DESC)`, `(import_job_id)`

### 7) competitors

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| competitor_product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| keyword_id | uuid | FK → keywords ON DELETE SET NULL (경쟁 맥락) |
| relation_type | text | NOT NULL CHECK IN (SAME_PRODUCT, SIMILAR, SUBSTITUTE) |
| source_type | source_type_t | NOT NULL |
| memo | text | |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at, updated_at | timestamptz | 공통 |

- CHECK: `product_id <> competitor_product_id`
- UNIQUE: `(product_id, competitor_product_id)`
- INDEX: `(competitor_product_id)`, `(keyword_id)`

### 8) profit_scenarios (수익성 입력값)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| name | text | NOT NULL DEFAULT '기본' (예: "광고비 20%", "중국 해운") |
| is_primary | boolean | NOT NULL DEFAULT false |
| sale_price | bigint | 판매가격 |
| vat_included | boolean | NOT NULL DEFAULT true |
| unit_cost_amount | numeric(14,2) | 상품원가 (원 통화) |
| unit_cost_currency | char(3) | NOT NULL DEFAULT 'KRW' |
| exchange_rate | numeric(12,4) | NOT NULL DEFAULT 1 |
| intl_shipping_per_unit | bigint | 국제배송비 (개당) |
| domestic_shipping_per_unit | bigint | 국내배송비 (개당) |
| coupang_fee_rate | numeric(6,4) | NULL이면 카테고리 기본값 사용 |
| logistics_fee_per_unit | bigint | 물류비 (로켓그로스 입출고·보관 등) |
| ad_cost_rate | numeric(6,4) | 광고비 (매출 대비 비율) — 둘 중 하나 입력 |
| ad_cost_per_unit | bigint | 광고비 (개당 금액) — 둘 중 하나 입력 |
| other_cost_per_unit | bigint | 기타비용 (포장 등) |
| fixed_cost_total | bigint | 초기 고정비 (손익분기 계산용) |
| expected_monthly_units | integer | 월 예상 판매량 (월 순이익 계산용) |
| source_type | source_type_t | NOT NULL DEFAULT 'MANUAL' |
| confidence | confidence_t | NOT NULL DEFAULT 'B' |
| memo | text | |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: 부분 UNIQUE `(product_id) WHERE is_primary` (상품당 대표 시나리오 1개)
- INDEX: `(product_id)`

### 9) profit_calculations (수익성 계산 결과)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| scenario_id | uuid | NOT NULL FK → profit_scenarios ON DELETE CASCADE |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE (조회 편의 비정규화) |
| formula_version | text | NOT NULL (예: 'profit-v1') |
| inputs_snapshot | jsonb | NOT NULL — 계산 당시 입력값 전체 사본 (적용된 수수료율·환율 포함) |
| unit_cost_krw | bigint | 원화 환산 원가 |
| coupang_fee_amount | bigint | 개당 수수료 |
| ad_cost_amount | bigint | 개당 광고비 |
| total_cost_per_unit | bigint | 개당 총비용 |
| net_profit_per_unit | bigint | 예상 순이익 (개당) |
| net_margin_rate | numeric(7,4) | 순이익률 |
| roi | numeric(9,4) | 순이익 ÷ 투입원가 |
| break_even_units | integer | 손익분기 판매량 (fixed_cost_total 없으면 NULL) |
| monthly_net_profit | bigint | 월 예상 순이익 |
| is_current | boolean | NOT NULL DEFAULT true |
| calculated_at | timestamptz | NOT NULL DEFAULT now() |

- UNIQUE: 부분 UNIQUE `(scenario_id) WHERE is_current`
- INDEX: `(product_id, calculated_at DESC)`
- 입력이 바뀌거나 계산식이 바뀌면 새 행을 INSERT하고 이전 행은 `is_current = false`. 덮어쓰지 않는다.

### 10) scoring_versions (전역, owner_id 없음)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| version | text | PK (예: 'v1') |
| weights | jsonb | NOT NULL — `{demand:15, salesVolume:15, ...}` (합계 100) |
| thresholds | jsonb | NOT NULL — `{strongBuy:80, review:60}` |
| factor_definitions | jsonb | 요소별 계산 방법 설명 |
| description | text | |
| is_active | boolean | NOT NULL DEFAULT false |
| released_at | timestamptz | NOT NULL DEFAULT now() |
| retired_at | timestamptz | |

- UNIQUE: 부분 UNIQUE `((true)) WHERE is_active` (활성 버전 1개)
- RLS: authenticated SELECT만 허용

### 11) opportunity_scores

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| keyword_id | uuid | FK → keywords ON DELETE SET NULL (NULL = 키워드 무관 종합 점수) |
| scoring_version | text | NOT NULL FK → scoring_versions(version) |
| total_score | numeric(5,2) | NOT NULL CHECK 0~100 |
| demand_score | numeric(5,2) | 수요 (0~100 정규화) |
| sales_score | numeric(5,2) | 판매량 |
| growth_score | numeric(5,2) | 판매 성장률 |
| competition_score | numeric(5,2) | 경쟁 난이도 |
| wing_score | numeric(5,2) | WING 진입 가능성 |
| review_barrier_score | numeric(5,2) | 리뷰 장벽 |
| conversion_score | numeric(5,2) | 전환율 |
| margin_score | numeric(5,2) | 마진 |
| stability_score | numeric(5,2) | 시장 안정성 |
| extra_factor_scores | jsonb | NOT NULL DEFAULT '{}' — V2 이후 신규 요소 |
| verdict | verdict_t | NOT NULL |
| data_confidence | confidence_t | 입력 데이터의 종합 신뢰도 |
| missing_factors | text[] | 데이터가 없어 계산하지 못한 요소 |
| reasons | jsonb | NOT NULL DEFAULT '[]' — ScoreReason[] |
| input_refs | jsonb | NOT NULL — 사용한 snapshot·keyword_snapshot·profit_calculation id |
| is_current | boolean | NOT NULL DEFAULT true |
| calculated_at | timestamptz | NOT NULL DEFAULT now() |

- UNIQUE: 부분 UNIQUE `(product_id, keyword_id, scoring_version) NULLS NOT DISTINCT WHERE is_current` (Supabase PG15+ 지원)
- INDEX: `(product_id, calculated_at DESC)`, `(owner_id, scoring_version, total_score DESC) WHERE is_current`, `(keyword_id)`
- 행은 불변 (append-only). 바꿀 수 있는 것은 `is_current`뿐이다.

### 12) product_risks

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| opportunity_score_id | uuid | FK → opportunity_scores ON DELETE CASCADE (계산된 위험이면 연결, 수동이면 NULL) |
| risk_type | risk_type_t | NOT NULL |
| risk_level | risk_level_t | NOT NULL |
| description | text | NOT NULL |
| evidence | jsonb | 근거 수치 (예: `{top_brand_share:0.62}`) |
| source_type | source_type_t | NOT NULL (CALCULATED / MANUAL) |
| is_active | boolean | NOT NULL DEFAULT true |
| detected_at | timestamptz | NOT NULL DEFAULT now() |
| resolved_at | timestamptz | |
| created_at | timestamptz | 공통 |

- UNIQUE: `(opportunity_score_id, risk_type)` (점수 1건당 위험유형 1개)
- INDEX: `(product_id) WHERE is_active`

### 13) watchlist

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| keyword_id | uuid | FK → keywords ON DELETE SET NULL (발견 키워드) |
| status | text | NOT NULL DEFAULT 'WATCHING' (아래 상태표) |
| outcome | text | CHECK IN (SUCCESS, BREAK_EVEN, FAILED) — NULL = 미판정 |
| memo | text | |
| priority | smallint | 1~5 |
| tags | text[] | NOT NULL DEFAULT '{}' |
| status_changed_at | timestamptz | NOT NULL DEFAULT now() |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: `(owner_id, product_id)`
- INDEX: `(owner_id, status)`

상태 (원안 개선):

| status | 의미 | 원안 대비 |
|---|---|---|
| WATCHING | 관찰 중 | 유지 |
| SOURCING | 샘플·견적·공급처 확인 중 | **추가** |
| TESTING | 소량 테스트 판매 | 유지 |
| SELLING | 본격 판매 중 | 유지 |
| PAUSED | 일시 중지 (광고·가격 조정 등) | **추가** |
| SOLD_OUT | 재고 소진, 재입고 예정 | 유지 |
| STOPPED | 판매 종료 | 유지 |
| DROPPED | 검토 후 판매하지 않기로 함 | **추가** |
| ~~SUCCESS / FAILED~~ | → `outcome` 컬럼으로 이동 | **분리** |

### 14) watchlist_events

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| watchlist_id | uuid | NOT NULL FK → watchlist ON DELETE CASCADE |
| from_status | text | |
| to_status | text | NOT NULL |
| note | text | |
| changed_at | timestamptz | NOT NULL DEFAULT now() |

- INDEX: `(watchlist_id, changed_at)`
- watchlist.status 변경 시 트리거로 자동 기록

### 15) my_listings (실제 판매 건)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| watchlist_id | uuid | FK → watchlist ON DELETE SET NULL |
| reference_product_id | uuid | NOT NULL FK → products — 분석했던 상품 |
| own_product_id | uuid | FK → products — 내가 등록한 쿠팡 상품 (등록 전 NULL) |
| listing_name | text | NOT NULL |
| sku | text | |
| channel | text | NOT NULL DEFAULT 'COUPANG' |
| fulfillment_type | text | CHECK IN (ROCKET_GROWTH, SELLER_DELIVERY) |
| status | text | NOT NULL CHECK IN (PREPARING, ACTIVE, PAUSED, ENDED) |
| launch_date | date | 판매 시작일 |
| ended_on | date | |
| baseline_score_id | uuid | FK → opportunity_scores — 판매 결정 시점 점수 |
| baseline_profit_calc_id | uuid | FK → profit_calculations — 판매 결정 시점 수익성 |
| memo | text | |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: 부분 UNIQUE `(own_product_id) WHERE own_product_id IS NOT NULL`
- INDEX: `(reference_product_id)`, `(watchlist_id)`

### 16) sales_results (실제 판매 결과)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| listing_id | uuid | NOT NULL FK → my_listings ON DELETE CASCADE |
| period_type | text | NOT NULL CHECK IN (DAY, WEEK, MONTH) |
| period_start | date | NOT NULL |
| period_end | date | NOT NULL, CHECK ≥ period_start |
| units_sold | integer | 실제 판매량 |
| returned_units | integer | 반품 수량 |
| gross_revenue | bigint | 실제 매출 |
| ad_spend | bigint | 실제 광고비 |
| cogs | bigint | 실제 원가 합계 |
| logistics_cost | bigint | 실제 물류비 |
| coupang_fees | bigint | 실제 수수료 |
| other_costs | bigint | 기타 |
| net_profit | bigint | **GENERATED** = gross_revenue − (ad_spend + cogs + logistics_cost + coupang_fees + other_costs) |
| net_margin_rate | numeric(7,4) | **GENERATED** = net_profit ÷ NULLIF(gross_revenue, 0) |
| source_type | source_type_t | NOT NULL (WING_SESSION / MANUAL / OFFICIAL_API) |
| confidence | confidence_t | NOT NULL |
| import_job_id | uuid | FK → import_jobs ON DELETE SET NULL |
| memo | text | |
| created_at, updated_at | timestamptz | 공통 |

- UNIQUE: `(listing_id, period_type, period_start, source_type)`
- INDEX: `(listing_id, period_start)`, `(import_job_id)`

### 17) predictions (JARVIS 예측값, 불변)

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| product_id | uuid | NOT NULL FK → products ON DELETE CASCADE |
| listing_id | uuid | FK → my_listings ON DELETE SET NULL |
| opportunity_score_id | uuid | FK → opportunity_scores ON DELETE SET NULL |
| profit_calculation_id | uuid | FK → profit_calculations ON DELETE SET NULL |
| model_version | text | NOT NULL (예: 'pred-v1') |
| predicted_at | timestamptz | NOT NULL DEFAULT now() |
| target_period_start | date | NOT NULL |
| target_period_end | date | NOT NULL |
| sales_predicted | integer | 예측 판매량 |
| revenue_predicted | bigint | 예측 매출 |
| net_profit_predicted | bigint | 예측 순이익 |
| net_margin_predicted | numeric(7,4) | 예측 순이익률 |
| assumptions | jsonb | 예측 근거 (사용한 추정 판매량, 성장률 등) |
| created_at | timestamptz | 공통 |

- INDEX: `(product_id, target_period_start)`, `(listing_id, target_period_start)`

### 18) import_jobs

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | 공통 |
| channel | text | NOT NULL CHECK IN (FILE, EXTENSION, API, MANUAL) |
| import_type | text | NOT NULL CHECK IN (KEYWORD_METRICS, PRODUCT_SNAPSHOTS, SEARCH_RANKS, COMPETITORS, PROFIT_INPUTS, SALES_RESULTS, MIXED) |
| source_type | source_type_t | NOT NULL |
| source_tool | text | 확장프로그램·도구 이름과 버전 |
| file_name | text | |
| file_size_bytes | bigint | |
| file_hash | text | SHA-256 |
| storage_path | text | Supabase Storage 원본 경로 |
| idempotency_key | text | 확장프로그램 배치 키 |
| schema_version | text | 페이로드·파일 포맷 버전 |
| column_mapping | jsonb | 헤더 → 컬럼 매핑 |
| dry_run | boolean | NOT NULL DEFAULT false |
| status | text | NOT NULL CHECK IN (PENDING, PROCESSING, SUCCEEDED, PARTIAL, FAILED, ROLLED_BACK) |
| total_rows | integer | NOT NULL DEFAULT 0 |
| inserted_rows | integer | NOT NULL DEFAULT 0 |
| updated_rows | integer | NOT NULL DEFAULT 0 |
| skipped_rows | integer | NOT NULL DEFAULT 0 (중복·변경 없음) |
| failed_rows | integer | NOT NULL DEFAULT 0 |
| error_summary | text | |
| started_at | timestamptz | 실행 시작 |
| finished_at | timestamptz | 실행 종료 |
| created_at | timestamptz | 공통 |

- UNIQUE: `(owner_id, idempotency_key)`; 부분 UNIQUE `(owner_id, file_hash, import_type) WHERE status IN ('SUCCEEDED','PARTIAL') AND NOT dry_run`
- INDEX: `(owner_id, created_at DESC)`, `(owner_id, status)`

### 19) import_rows

| 컬럼 | 타입 | 제약/설명 |
|---|---|---|
| id | bigint identity | PK |
| owner_id | uuid | 공통 |
| import_job_id | uuid | NOT NULL FK → import_jobs ON DELETE CASCADE |
| row_number | integer | NOT NULL — 파일 행 번호 / 배치 내 순번 |
| record_key | text | 자연키 문자열 (예: `product_snapshot:8123456:2026-10-06:EXTENSION`) |
| payload | jsonb | NOT NULL — 원본 행 |
| result | text | NOT NULL DEFAULT 'PENDING' CHECK IN (PENDING, INSERTED, UPDATED, SKIPPED, FAILED) |
| target_table | text | |
| target_id | text | 반영된 행 id |
| previous_values | jsonb | UPDATED일 때 변경 전 값 (롤백용) |
| error_code | text | |
| error_message | text | |
| created_at | timestamptz | 공통 |

- UNIQUE: `(import_job_id, row_number)`
- INDEX: `(import_job_id, result)`, `(record_key)`

---

## 뷰

| 뷰 | 정의 요약 |
|---|---|
| `v_product_latest` | products + 항목별 최우선 스냅샷 값 (is_excluded 제외, 최신일 → 신뢰도 → 출처 우선순위). 각 값과 함께 그 값의 source/confidence/captured_on 반환 |
| `v_keyword_latest` | keywords + keyword_snapshots에 같은 규칙 적용 |
| `v_current_scores` | opportunity_scores WHERE is_current AND scoring_version = 활성 버전 |
| `v_prediction_vs_actual` | predictions × sales_results (listing_id, 기간 일치 또는 포함) → 예측값, 실제값, 오차, 오차율 |

모든 뷰는 `security_invoker = true`로 만든다. 뷰를 통해서도 RLS가 적용된다.

## 트리거 / 함수 (구현 단계에서 작성)

| 이름 | 역할 |
|---|---|
| `set_updated_at()` | updated_at 자동 갱신 |
| `log_watchlist_status()` | 상태 변경 시 watchlist_events INSERT, status_changed_at 갱신 |
| `rollback_import(job_id)` | INSERTED 행 삭제, UPDATED 행 previous_values로 복원, 상태를 ROLLED_BACK으로 |

## RLS 정책 (요약)

| 대상 | 정책 |
|---|---|
| scoring_versions 제외 전 테이블 | `authenticated`: ALL USING / WITH CHECK `owner_id = (select auth.uid())` |
| scoring_versions | `authenticated`: SELECT USING `true` |
| anon | 정책 없음 (접근 불가) |
| Storage `imports` 버킷 | 경로 첫 세그먼트 = `auth.uid()`인 경우만 읽기/쓰기 |

## 마이그레이션 순서 (승인 후)

1. DOMAIN → 2. categories, keywords, products → 3. import_jobs, import_rows → 4. 스냅샷·순위·경쟁 → 5. 수익성 → 6. scoring_versions(+v1 시드) → 7. opportunity_scores, product_risks → 8. watchlist, events → 9. my_listings, sales_results, predictions → 10. 뷰 → 11. 트리거 → 12. RLS 정책 → 13. `supabase gen types`로 TS 타입 생성 후 `src/types`와 대조

## 승인 시 확인이 필요한 결정사항

1. 예측값(`sales_predicted`, `revenue_predicted`)을 스냅샷이 아닌 `predictions` 테이블로 분리하는 것
2. watchlist 상태에 SOURCING / PAUSED / DROPPED 추가, SUCCESS / FAILED를 `outcome`으로 분리하는 것
3. V1은 쿠팡 productId 단위로 추적 (옵션별 테이블은 보류)
4. enum 대신 text + CHECK(DOMAIN)
5. Supabase 플랜 (무료: 7일 비활성 일시정지 / Pro: 백업 포함)
