# JARVIS PHASE 5 완료 보고 — 경쟁상품 분석

> 작성: Claude · 2026-10-07 · 저장소 `main`
> 다음 PHASE는 시작하지 않음.

## 1. 구현 요약

경쟁상품을 **기존 상품(`products`) 사이의 관계(`competitors`)**로 연결했다. 경쟁상품 전용 상품·스냅샷 테이블은 만들지 않았다.

- **상품 상세의 "경쟁상품" 섹션**
  - 비교표: 기준 상품과 경쟁상품의 가격·리뷰·평점·판매량(실제/추정 분리)·배송·판매자·최근 수집일·상태
  - **경쟁상품 후보**: 이 상품이 순위로 연결된 키워드의 최신 검색 결과(`keyword_product_ranks`) 상위 상품
  - 후보에서 관계 유형을 골라 등록, 또는 URL·상품 ID로 직접 등록 (미등록 상품이면 상품부터 등록)
  - 관계 유형 변경 · 해제 · 다시 등록
  - "이 상품을 경쟁상품으로 둔 상품"(역방향 참조) 표시
- **`/competitors`**: 실제 DB 목록 + 검색(상품명·상품 ID·키워드) + 관계 유형·상태 필터
- 경쟁상품의 지표는 일반 상품과 같은 `product_snapshots` / `v_product_latest`를 쓴다. 경쟁상품 상세는 기존 `/products/[id]`를 그대로 쓴다.
- 자동 확정·점수 계산·추천 없음. 등록 여부는 사용자가 결정한다.

## 2. 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `src/types/competitor.ts` (추가) | 관계 유형(DB CHECK와 같은 3종) 라벨·설명, `CompetitorRelation`, `CompetitorCandidate`, `CandidateGroup` 도메인 타입 |
| `src/lib/mappers/competitor.ts` (추가) | competitors 행(+기준·경쟁 상품, 키워드) → 도메인 타입 |
| `src/lib/repositories/competitors.ts` (추가) | `listCompetitors` · `getCompetitorsForProduct` · `getCompetitorReferences` · `getCompetitorCandidates` · `createCompetitor` · `updateCompetitor` · `releaseCompetitor` |
| `src/app/competitors/actions.ts` (추가) | Server Functions: 후보 등록 · URL/ID 등록(미등록 상품은 상품 먼저 등록) · 수정 · 해제 · 다시 등록 |
| `src/app/competitors/page.tsx` | 안내 화면 → LIVE 목록·검색·필터 |
| `src/components/competitors/` (추가) | `competitors-table`(비교표, 목록/상품 모드) · `candidate-list` · `competitor-add-form` · `competitor-controls`(관계 배지·선택·수정·해제·다시 등록) · `metric-cells`(가격·리뷰·평점·판매량·배송 칸) |
| `src/app/products/[id]/page.tsx` | "경쟁상품" 섹션 추가 (비교표 · 후보 · 직접 등록 · 역방향 참조) |
| `src/lib/mappers/product.ts` | 현재 지표 변환을 `toProductMetrics()`로 분리해 경쟁상품 비교에 재사용 (동작 동일) |
| `supabase/verify/phase2_verify.sql` | 경쟁상품 검증 8개(CP01~CP08) 추가 |

## 3. DB 변경

**DB 변경 없음.** 기존 `competitors` 구조를 그대로 썼다. 운영 DB migration 수는 14개 그대로.

| 사용한 기존 구조 | 용도 |
|---|---|
| `product_id` → `competitor_product_id` | 관계 방향 (기준 → 경쟁) |
| `relation_type` CHECK (SAME_PRODUCT / SIMILAR / SUBSTITUTE) | 관계 유형 (값 추가 없음) |
| `keyword_id` (복합 FK, SET NULL) | 어떤 키워드 맥락에서 경쟁인지 |
| `is_active` | 해제 = false (행 보존) |
| `source_type` | 사용자가 판단해 등록 = MANUAL |
| `memo`, `created_at`, `updated_at` + `set_updated_at` 트리거 | 메모 · 최초 등록 시각 · 마지막 변경 시각 |
| UNIQUE `(product_id, competitor_product_id)` | 중복 방지 |
| CHECK `product_id <> competitor_product_id` | 자기 자신 금지 |
| 복합 FK `(owner_id, …)` + RLS 4종 | 사용자 간 차단 |

## 4. 경쟁상품 데이터 흐름

```
기준 상품 (products)
 ↓ keyword_product_ranks 에서 이 상품이 순위로 기록된 키워드
키워드
 ↓ 그 키워드의 가장 최근 수집일 검색 결과 (자연 노출 우선 · 순위 순 · 상품당 1건 · 키워드당 최대 10)
후보 상품 (products — FK 때문에 순위 행의 상품은 항상 master 에 존재)
 ↓ 사용자가 관계 유형을 골라 [등록]
competitors (기준 → 경쟁, MANUAL, 맥락 키워드)
 ↓
경쟁상품의 현재 지표 = v_product_latest (product_snapshots) → 비교표
```

- **후보에 상품 master가 없는 경우:** 지시 12의 상황은 현재 구조에서 생길 수 없다. `keyword_product_ranks.product_id`가 `products` 복합 FK이기 때문이다(P5-02로 확인).
- **URL/ID로 처음 보는 상품을 등록하는 경우:** 지시 12의 A안대로 기존 `createProduct()`로 상품 master를 먼저 만든 뒤 관계를 만든다. 지표는 그 상품 상세에서 입력한다.

## 5. 경쟁상품 등록 구조

- 등록 전에 `(product_id, competitor_product_id)` 기존 행을 조회한다.
  - **활성 행이 있으면:** 새 행 없이 "이미 등록된 경쟁상품입니다"
  - **해제된 행이 있으면:** 같은 행을 다시 활성화 (관계 유형·맥락 키워드 갱신, `created_at` 유지)
  - **없으면:** INSERT. 동시 등록으로 UNIQUE(23505)가 나면 "이미 등록"으로 처리
- **방향:** 한쪽뿐이다. "A를 분석할 때 B를 경쟁상품으로 본다"(A → B). B → A는 자동으로 만들지 않는다. B 상세에서는 A가 "이 상품을 경쟁상품으로 둔 상품"으로 보이고, 후보 목록에서 사용자가 직접 B → A를 등록할 수 있다(별도 행).
- **SAME_PRODUCT:** "같은 상품을 다른 판매자·다른 상품 페이지로 파는 경우"로 표시한다. 배지 색과 설명을 달리 하고, 유사·대체 상품과 섞지 않는다. 의미와 값은 기존 정의 그대로.

## 6. 경쟁상품 해제 구조

- 해제 = `is_active = false` UPDATE. **물리 삭제 없음.** 화면에 삭제 기능도 없다.
- 해제된 관계는 `/competitors` 기본 목록(활성)에서 빠진다. "해제됨"·"전체" 필터와 상품 상세 비교표(해제됨 표시)에서는 보인다.
- **다시 등록** = 같은 행을 `is_active = true`로 되돌린다. 등록 이력은 `created_at`(최초 등록) · `updated_at`(마지막 변경)으로 남는다.
- 별도 이력 테이블은 만들지 않았다 (지시 16). 그래서 **해제·재등록이 일어난 횟수와 시점별 이력은 남지 않는다** (10-2).

## 7. RLS 검증

운영 DB에서 다른 사용자 B로 시도 (본인 계정 데이터 + 가상 사용자 B, 트랜잭션 취소로 흔적 없음):

| 항목 | 결과 |
|---|---|
| B는 내 경쟁 관계·상품·스냅샷·순위 조회 | 0건 ✅ |
| B는 내 관계 해제·수정 / 삭제 | 0행 / 0행 ✅ |
| B는 자기 상품끼리 정상 등록 | ✅ |
| B 상품 → 내 상품 / 내 상품 → B 상품 연결 | 둘 다 차단 (복합 FK 23503) ✅ |
| B 관계에 내 키워드를 맥락으로 지정 | 차단 (23503) ✅ |
| B의 시도 후 내 관계 상태 | 그대로 ✅ |

PGlite 검증에도 CP07(B는 A 상품끼리 관계 생성 불가), CP08(B는 A 관계 해제 불가)을 추가했다.

## 8. 테스트 결과

| 테스트 | 결과 |
|---|---|
| 운영 DB 시나리오 (본인 권한 + 사용자 B) | **21 / 21** |
| PGlite 회귀 검증 (`npm run db:verify`) | **140 / 140** (기존 132 + 경쟁상품 CP01~CP08) |
| Typecheck | PASS |
| Lint | PASS (0 errors) |
| Build | PASS |
| 브라우저 UI (로그인 세션 이어받음, `[TEST]` 데이터) | 아래 항목 전부 확인 |

운영 DB 시나리오 21개: 후보 경로(연결 키워드 최신일·자기 제외·과거일 제외) · 후보 상품 master 존재 · 후보 지표 = 스냅샷 · 스냅샷 없는 후보 NULL · 등록(owner·맥락 키워드·MANUAL) · 역방향 자동 생성 없음 · 유형·메모 수정 · 해제(행 보존) · 재등록(같은 행) · 역방향 참조 조회 · 목록 조인 · 중복(23505) · 자기 자신(23514) · RLS 8개.

브라우저 UI에서 확인한 것:
- **URL 등록:** 미등록 상품을 상품명 없이 등록 → 안내 문구, 상품명을 넣으면 상품 생성 + 관계 생성 (추적 파라미터 제거)
- **경쟁상품 상세** (= 일반 상품 상세): 지표·순위 입력, 역방향 참조 표시, 기준 상품은 "후보"로만 표시 (자동 역방향 없음)
- **후보 목록:** 순위 순, 등록된 것은 "등록됨", 지표는 스냅샷 값 + 출처·신뢰도, 없는 값 `-` → 후보에서 "동일 상품"으로 등록 → 비교표 반영
- **관계 관리:** 유형 변경(대체 → 유사) · 해제 → "해제됨" · 같은 ID 재등록 → "이미 등록된 경쟁상품입니다" (행 수 그대로)
- **`/competitors`:** 기본(활성) 1건 · 해제됨 필터 · 관계·검색 필터 조합 · 결과 없음 문구 · 해제됨에서 "다시 등록" → 활성 2건
- **DB 대조:** 관계 2행만 존재, 재등록 행의 `created_at` 유지 · `updated_at` 갱신

repository 함수는 별도 단위 테스트 없이 위 UI 흐름과 운영 DB 시나리오로 검증했다 (기존 프로젝트에 JS 테스트 프레임워크가 없고, 새로 추가하지 않음).

## 9. 기존 기능 Regression 결과

- PGlite 기존 132개 전부 통과.
- 로그인 상태에서 12개 화면 응답 200, 오류 없음: `/` · `/keywords` · `/keywords/[id]` · `/products` · `/products/[id]` · `/watchlist` · `/watchlist?status=ALL` · `/profit` · `/settings` · `/categories` · `/import` · `/competitors`. Dashboard(`/`)는 DEMO 유지.
- 상품 상세의 기존 섹션(기본 정보·현재 지표·관심상품·지표 입력·수집 이력·키워드 순위)은 그대로 동작하고, 경쟁상품 섹션만 추가됐다.
- `toProductMetrics()` 분리는 기존 `/products` 목록·상세 표시 결과에 변화가 없다.

## 10. 발견된 문제

1. **PHASE 4 미결 사항 그대로:** `upsert_*_snapshot()`이 다른 사용자의 기존 행 대상일 때 오류 대신 빈 SKIPPED를 반환한다 (PHASE4_REPORT 10-1). 앱에서는 오류로 처리하고 있다. 함수 수정은 아직 결정 대기.
2. **경쟁 관계 변경 이력 없음:** 해제·재등록·유형 변경은 `updated_at`만 갱신되고 과거 상태는 남지 않는다. 지시 16대로 이력 테이블을 만들지 않았다. "언제 해제했다가 다시 경쟁상품이 됐나"가 필요해지면 별도 결정이 필요하다.
3. **후보는 "키워드 순위가 입력된 상품"만 대상이다.** 자동 수집이 없어서, 후보를 보려면 같은 키워드에서 다른 상품의 순위를 직접 입력해야 한다. 화면에 안내 문구가 있다.
4. **후보는 키워드별 최신 수집일만 본다.** 같은 키워드라도 수집일이 다르면(다른 상품은 어제 기록) 오늘 기록이 없는 상품은 후보에서 빠진다. 의도한 동작(같은 시점의 검색 결과 비교)이지만 사용자에게 헷갈릴 수 있다.
5. 브라우저 테스트로 운영 DB에 `[TEST]` 데이터가 늘었다: 상품 2개(`9900000002`, `9900000003`, 스냅샷·순위 포함), 경쟁 관계 2건. PHASE 4 테스트 데이터와 함께 정리 승인 대기.

## 11. 설계 변경 여부

**기존 설계 변경 없음.**
(DB 구조 · 관계 유형 값 · Opportunity Score · 가중치 · 판정 기준 · SourceType · Confidence · DataPoint · 판매량 actual/estimated/predicted · 스냅샷 구조 · RLS 원칙 모두 그대로)

## 12. 다음 Phase에 영향을 주는 사항

- **경쟁 지표의 기준:** 경쟁상품 비교값은 각 상품의 `v_product_latest`(항목별 최신·최고 신뢰도)다. 점수 엔진(PHASE 7)의 "경쟁 난이도·리뷰 장벽"에 쓸 때는 **활성 관계(`is_active = true`)만, 그리고 출처·신뢰도와 수집일을 함께** 봐야 한다. 관계 유형별 가중(SAME_PRODUCT 가격 비교 등)은 점수 설계 때 결정할 사항이다.
- **수익성(PHASE 6):** SAME_PRODUCT 경쟁상품의 가격은 판매가 시나리오의 참고값으로 쓸 수 있다. 카테고리 수수료율 기본값을 위한 `/categories` 최소 관리가 필요하다.
- **데이터 입력량:** 후보·비교가 의미 있으려면 키워드별로 여러 상품의 순위·스냅샷이 필요하다. 지금은 수동 입력이라 CSV import(PHASE 9)나 확장프로그램(PHASE 11)이 들어오면 후보가 자연스럽게 채워진다. 지금 구조(키워드 순위 → 후보)는 그대로 쓸 수 있다.
- 미결 결정: PHASE 4 10-1 (스냅샷 함수 수정), 테스트 데이터 정리, 띄어쓰기만 다른 키워드 처리 규칙.
