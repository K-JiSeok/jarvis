# JARVIS PHASE 8 — Dashboard LIVE 전환 · 완료 보고서

작성일: 2026-10-08 · 저장소: `K-JiSeok/jarvis` (main)

---

## 1. 구현 요약

`/` (Dashboard)를 DEMO 데이터에서 **로그인 사용자의 실제 Supabase 데이터**로 바꿨다. 하드코딩 숫자와 DEMO 상품은 모두 제거했다.

사용하는 실제 데이터:

| 데이터 | 출처 |
|---|---|
| 상품 수 · 최근 등록 상품 | `products` (삭제·판매 종료 `DELETED` 제외) |
| 현재 점수 · 판정 · 근거 · 최근 분석 | `v_current_scores` → `listCurrentScoresByProduct()` (PHASE 7, 상품별 가장 최근 계산 1개) |
| 관심상품 | `watchlist` (`status = 'WATCHING'`) + `products` |
| 분석 데이터 상태 | 상품마다 PHASE 7 점수 엔진 미리 보기 (`previewScore()`, 저장하지 않음) |
| 데이터 최신성 | `keyword_snapshots`, `product_snapshots`(전체 / 가격 있는 행), `keyword_product_ranks` 의 최대 `captured_on`, 현재 점수의 최대 `calculated_at` |

새 판단 알고리즘이나 점수 보정은 없다. 저장된 점수와 근거를 그대로 보여 준다.

---

## 2. Dashboard 구성

정보 우선순위(① 현재 상황 → ② 좋은 상품 → ③ 분석 상태 → ④ 최근 활동 → ⑤ 관심상품) 순서로 배치했다.

| 영역 | 내용 |
|---|---|
| ① KPI 7개 | 등록 상품(삭제 제외 개수 표시), 분석 완료, 미계산, 강력추천, 검토, 제외, 관심상품. 카드를 누르면 해당 목록으로 이동 |
| ① Opportunity Score 현황 | 강력추천 / 검토 / 제외 / 미계산 비율 막대 + 개수·비율. 항목을 누르면 `/products?verdict=…` |
| ② 추천 상품 | STRONG_BUY 전부 → REVIEW, 각각 총점 높은 순 → 최근 계산 순, 최대 6개. 점수, 판정, 저장된 근거(가점 최대 3 · 주의 최대 2), 계산일, 맥락 키워드, 신뢰도. 카드를 누르면 `/products/[id]#score` |
| ③ 분석 데이터 상태 | 점수 계산 가능 / 분석 데이터 부족 상품 수, "계산 가능하지만 아직 저장 안 함" 수, 요소별 부족 상품 수 막대와 필요한 데이터 |
| ③ 최근 데이터 | 키워드 / 상품 / 가격 / 키워드 순위 데이터의 최근 수집일, 마지막 점수 계산 시각. 없으면 `-` |
| ④ 최근 등록 상품 | 최근 5개: 상품명, 점수·판정(없으면 미계산), 등록일 |
| ④ 최근 분석 상품 | 최근 계산 5개: 상품명, 점수, 판정, 계산 시각 |
| ⑤ 관심상품 | WATCHING 최근 변경 순 최대 8개: 상품명, 현재 점수·판정, 메모 일부(한 줄 말줄임), 최근 변경일 |

---

## 3. Repository

| 파일 | 내용 |
|---|---|
| `src/lib/repositories/dashboard.ts` | **재작성** — `getDashboardData()` 단일 진입점. 상품·현재 점수·관심상품·최신 수집일을 병렬 조회하고, 상품별 엔진 미리 보기(최근 등록 50개, 동시 4개)를 모아 집계 함수에 넘긴다 |
| `src/lib/dashboard/aggregate.ts` | **신규** — 순수 집계 함수: `summarizeScores`, `pickRecommendations`, `recentlyAnalyzed`, `pickReasons`, `summarizeDataQuality` |
| `src/lib/repositories/opportunity.ts` | `SavedScoreView` 에 저장된 `reasons` 를 포함 (`toReasons()` — 형식이 맞는 항목만) |
| 재사용 | `listCurrentScoresByProduct()`, `previewScore()`, `listScoreKeywordOptions()` (PHASE 7), `listWatchlist()` (PHASE 4) |

구조: `page.tsx → getDashboardData() → (repository 함수들) → Supabase (RLS)`. 컴포넌트는 Supabase 를 직접 호출하지 않는다.

---

## 4. DB

```text
DB 변경 없음
```

migration·테이블·컬럼·뷰 변경 없음. 기존 테이블과 `v_current_scores` 만 사용했다.

---

## 5. UI

- `src/app/page.tsx` — 로그인 확인 → `getDashboardData()` → 상태별 화면: 미로그인(로그인 안내), 오류(안내 + 설정 링크), 상품 0개(등록 안내), 정상(6개 영역). 헤더 배지 LIVE.
- `src/components/dashboard/dashboard-sections.tsx` — **신규**: `KpiGrid`, `ScoreDistribution`, `Recommendations`, `DataStatus`, `RecentActivity`, `WatchingList`. 차트 라이브러리 없이 기존 Card·Badge·Tailwind 만 사용했다.
- 빈 상태:
  - 상품 0개 → "아직 등록된 상품이 없습니다. 상품을 등록하면 JARVIS 분석이 시작됩니다."
  - 점수 0개 → "아직 계산된 Opportunity Score가 없습니다. 상품 상세에서 점수를 계산해보세요."
  - 관심상품 0개 → 안내 문구
  - 최근 분석 0개 → 안내 문구
- 빈 배열은 오류로 처리하지 않는다. 조회 오류만 오류 화면을 보여 주고, 서버 로그에 남긴다.
- `src/config/navigation.ts` — Dashboard 설명 문구를 "실제 데이터 현황 · 추천 상품 · 분석 상태"로 변경.

---

## 6. DEMO 제거

| 삭제 | 내용 |
|---|---|
| `src/lib/mock/dashboard.ts` | DEMO 추천상품 3개 (하드코딩 점수·판매량·마진) |
| `src/components/dashboard/recommendation-card.tsx` | DEMO 추천 카드 |
| `src/components/dashboard/metric-item.tsx` | DEMO 카드용 지표 칸 |
| `src/components/common/mock-banner.tsx` | "DEMO 데이터" 배너 (Dashboard 에서만 사용) |
| `src/types/dashboard.ts` 의 `RecommendationView`, 구 `DashboardData` | DEMO 뷰 모델 → LIVE 뷰 모델로 교체 |

다른 화면의 DEMO 표시(DB 미연결 시 설정·상단 상태 문구)는 건드리지 않았다. DB 에 DEMO 데이터는 원래 없었다.

---

## 7. 데이터 집계 기준

- **현재 점수만 사용:** `v_current_scores` (= `is_current = true` + 활성 scoring version). 과거 점수 행은 세지 않는다.
- **상품당 1개:** PHASE 7 `listCurrentScoresByProduct()` 동작 그대로 — 상품의 현재 점수가 키워드 맥락별로 여러 개면 가장 최근 계산 1개. 새 선택 규칙을 만들지 않았다.
- **대상 상품:** `lifecycle_status <> 'DELETED'` (`/products` 기본 목록과 같음). 삭제된 상품의 점수는 현황·추천·최근 분석에서 뺀다. KPI 에 "삭제·판매 종료 n개 제외"를 표시한다.
- 분석 완료 + 미계산 = 등록 상품 (항상 일치).
- 관심상품 = `status = 'WATCHING'` 행 수. DROPPED 는 물론 SOURCING 등 다른 상태도 이 수에 넣지 않는다.
- 최신 수집일: 제외 처리(`is_excluded`)된 스냅샷은 뺀다. 가격 데이터 = `price` 가 있는 상품 스냅샷.

---

## 8. 데이터 부족 처리

- 점수가 없는 상품은 모든 곳에서 **"미계산"**으로 표시한다. EXCLUDE 에 넣지 않고 분포에서도 별도 항목이다.
- 추천 영역에는 STRONG_BUY / REVIEW 만 나온다. 미계산·EXCLUDE 는 넣지 않는다.
- 점수를 억지로 계산하거나 보정하지 않는다. "분석 데이터 상태"는 엔진 미리 보기 결과를 **세기만** 하고 저장하지 않는다.
- 요소별 부족 수는 엔진이 "미계산"으로 판정한 요소를 그대로 센다. 필요한 데이터 문구도 엔진의 문구 그대로다.
- 최신성에서 데이터가 없으면 `-`.

---

## 9. RLS 테스트

- **원격 Supabase (가짜 사용자 B, 롤백):** products 0, opportunity_scores 0, v_current_scores 0, watchlist 0, WATCHING 0, keyword_snapshots 0, product_snapshots 0, keyword_product_ranks 0, v_product_latest 0, profit_calculations 0. anon 은 v_current_scores · watchlist 조회 거부(42501). → 12/12
- **PGlite DS05:** B 의 Dashboard 조회 대상 테이블·뷰 6종에서 A 의 행 0건.
- 모든 조회는 로그인 세션의 `createClient()` (RLS) 로만 한다. service role 은 사용하지 않는다.

---

## 10. 테스트 결과

```text
Dashboard 집계 (npm run test:dashboard):        12/12
Repository (화면 값 = SQL 직접 집계):            14/14
DB (npm run db:verify, PGlite):                176/176  (기존 170 + DS 6)
RLS (원격 Supabase, 롤백):                       12/12
UI (로그인 세션, [TEST] 데이터):                  10/10
Score regression (npm run test:score):          22/22
Profit regression (npm run test:profit):        20/20
Typecheck:                                      PASS
Lint:                                           PASS
Build:                                          PASS
```

**집계 12개:** 판정별·미계산 집계, 삭제 상품 점수 제외, 같은 상품 id 중복 1회, 상품 0개·점수 0개, 추천 정렬(STRONG_BUY → REVIEW, EXCLUDE 제외), REVIEW 79.99 가 STRONG_BUY 80 뒤, 동점 시 최근 계산 먼저·개수 제한, 점수 없음 → 빈 추천, 최근 분석 순·원본 불변, 근거 가점 3·주의 2, 데이터 상태 집계, 상품 없음.

**Repository 14개** (실제 DB 에 [TEST] 데이터를 넣고, 화면 값과 SQL 로 직접 센 값을 비교): 등록 상품 10, 삭제 1, 분석 완료 5, 미계산 5, 강력추천 2, 검토 2, 제외 1, 관심상품 2, 키워드·상품·가격·순위 최신일 4개, 점수 이력 포함 전체 8행 중 현재 5개만 집계, 추천 순서(86.4 → 82.1 → 79.3 → 71.03).

**PGlite DS 6개:** 현재 점수 상품별 1개(이력·맥락 중복 없음), v_current_scores 에 비현재 행 없음, 관심상품 추가 → WATCHING +1, DROPPED 로 바꾸면 빠짐(행 보존), 최신 수집일 계산, B 조회에 A 행 0건.

**UI 10개** (실제 로그인 세션):

1. 상품 0개 → 등록 안내 화면
2. 상품 6개 · 점수 0개 → KPI 6 / 0 / 6, "아직 계산된 Opportunity Score가 없습니다" 안내
3. 관심상품 0개 → 빈 상태 문구
4. 정상 데이터 → KPI 7개가 SQL 집계와 일치
5. 추천 상품 순서와 근거 (4번째 가점은 생략, 주의 1개 표시)
6. 추천 카드 클릭 → `/products/[id]#score` 이동
7. 판정 표시 (강력추천·검토·제외 배지, 점수 없는 상품은 "미계산")
8. 최근 데이터 날짜 · 점수 계산 시각 표시
9. 조회 오류 → 오류 안내 화면 (일시적으로 오류를 강제해 확인 후 원복)
10. 제외 대상 확인: 과거 STRONG_BUY 90 이력, 삭제된 상품의 95점, DROPPED · SOURCING 관심상품이 현황에 들어가지 않음

테스트 데이터([TEST] 키워드 1, 상품 11, 스냅샷 8, 순위 1, 경쟁관계 4, 수익성 1, 점수 8, 관심상품 4)는 모두 삭제했다. 운영 DB 에는 실제 키워드 2개와 그 스냅샷 1건만 남아 있다.

---

## 11. Regression

| 페이지 | 결과 |
|---|---|
| `/` | 200 |
| `/keywords`, `/keywords/[id]` | 200 |
| `/products`, `/products?verdict=STRONG_BUY` | 200 |
| `/products/[id]` | 200 |
| `/competitors` | 200 |
| `/profit` | 200 |
| `/categories` | 200 |
| `/watchlist`, `/watchlist?status=WATCHING` | 200 |
| `/import` | 200 |
| `/settings` | 200 |

PHASE 1~7 PGlite 테스트, 점수 22개, 수익성 20개 모두 통과. scoring v1 가중치·판정 기준 일치 확인.

---

## 12. 발견된 문제

1. **"분석 데이터 상태"가 상품마다 점수 엔진을 돌린다.** 상품 1개에 여러 쿼리가 필요해 최근 등록 50개까지만 계산하고(화면에 표시), 동시 4개로 제한했다. [TEST] 10개 상품에서 Dashboard 응답이 약 1~1.5초였다. 상품이 많아지면 느려지므로 이후 집계 뷰나 캐시가 필요할 수 있다 (이번 범위 밖).
2. **"분석 완료"(저장된 점수)와 "점수 계산 가능"(현재 데이터) 수가 다를 수 있다.** 저장된 점수는 저장 당시 데이터 기준이고, 데이터 상태는 지금 데이터 기준이다. 또 데이터 상태는 상품 상세와 같은 기본 맥락 키워드로 계산하므로, 다른 키워드 맥락으로 저장한 점수와 다를 수 있다.
3. **관심상품 영역은 WATCHING 만 보여 준다** (지시대로). SOURCING · TESTING · SELLING 등 진행 중인 상품은 Dashboard 에 나오지 않는다. 전체는 `/watchlist` 에서 본다.
4. "최근 변경일"은 `status_changed_at` 이다. 메모만 고친 경우는 바뀌지 않는다.
5. 같은 시각에 등록된 상품의 "최근 등록" 순서는 일정하지 않다 (같은 created_at).
6. 기존 PGlite 테스트 B12 의 "A 관심상품 2개" 기대값을 3개로 고쳤다 (이번 DS03 테스트가 DROPPED 관심상품 1개를 추가하기 때문). 검증 내용은 같다.
7. `src/types/common.ts` 의 `DataMode` · `SalesFigures` · `RiskWarning` 타입은 DEMO 카드가 쓰던 것인데, 공통 타입이라 남겨 두었다 (현재 사용처 없음).
8. 작업 중 파일 교체 순간에 dev 서버가 잠깐 "모듈 없음" 오류를 냈다 (교체 후 해소, build 통과).

---

## 13. 설계 변경 여부

```text
기존 설계 변경 없음
```

Opportunity Score V1 가중치·판정 기준, score-engine-v1 정규화 규칙, 데이터 부족 정책, opportunity_scores 저장 구조, RLS, 그 밖의 PHASE 1~7 구조를 바꾸지 않았다. DB 변경 없음. `SavedScoreView` 에 저장된 `reasons` 를 읽어 오는 필드만 추가했다 (DB 값 그대로).

---

## 14. 다음 Phase 영향 (PHASE 9 CSV/Excel Import)

- Import 로 들어오는 `product_snapshots` · `keyword_snapshots` · `keyword_product_ranks` 는 코드 변경 없이 Dashboard 에 바로 반영된다: 최신 수집일, 분석 데이터 상태(요소별 부족 수), 점수 계산 가능 상품 수.
- 지금 Dashboard 의 "주요 부족 데이터"가 Import 우선순위를 보여 준다. 특히:
  - **전환율 · 28일 조회수**(WING) → 전환율 요소
  - **판매량(실제/추정) + 집계 기간** → 판매량 요소. 여러 날짜로 가져오면 성장률 요소
  - **가격 이력**(날짜별 3회 이상) → 시장 안정성
  - **키워드 검색량 · 상품수/검색량 · WING 비율 · 브랜드 집중도 · 평균 리뷰** → 수요 · 경쟁 · WING · 리뷰 장벽
  - **검색 순위**(키워드-상품 연결) → 점수 맥락 키워드
- `import_jobs` 는 이미 테이블이 있어 이후 Dashboard 에 "최근 가져오기" 상태를 붙일 수 있다 (이번에는 표시하지 않음).
- Import 후 점수는 자동으로 다시 계산되지 않는다 (자동 재계산은 범위 밖). Import 다음에 상품 상세에서 "점수 다시 계산"을 눌러야 저장 점수가 갱신된다. 점수 계산이 가능해졌지만 아직 저장하지 않은 상품 수는 Dashboard 데이터 상태에 표시된다.
- 상품 수가 늘면 12절 1번(데이터 상태 계산 비용)이 먼저 문제가 될 수 있다.
