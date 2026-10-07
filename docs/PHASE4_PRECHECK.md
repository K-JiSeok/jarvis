# PHASE 4 사전 점검 (GPT 검토용)

> 작성: Claude · 2026-10-07 · **구현은 시작하지 않음** (지시 18번)
> 실제 운영 DB 스키마를 직접 조회해 확인했다. migration 파일과 같다.

## 1. 현재 구조

| 대상 | 실제 상태 |
|---|---|
| `products` (마스터) | coupang_product_id(필수) · coupang_item_id · coupang_vendor_item_id · product_url · product_name(필수) · brand · category_id · seller_type(COUPANG_RETAIL / ROCKET_GROWTH_SELLER / WING_SELLER / UNKNOWN) · option_count · is_coupang_pb · is_own_product · **lifecycle_status(ACTIVE / UNAVAILABLE / DELETED)** · first_seen_at · last_seen_at · deleted_detected_at. UNIQUE(owner_id, coupang_product_id) |
| `product_snapshots` (시계열) | price · original_price · discount_rate · delivery_type(ROCKET / ROCKET_GROWTH / ROCKET_FRESH / SELLER_DELIVERY / OVERSEAS / OTHER) · seller_type_observed · review_count · rating(0~5) · **category_rank** · option_count · views_28d · sales_period_days · **sales_actual · sales_estimated** · revenue_actual · revenue_estimated · conversion_rate · product_name_observed · metric_meta · is_excluded. UNIQUE(product_id, captured_on, source_type) |
| `keyword_product_ranks` | keyword_id · product_id · captured_on · captured_at · source_type · confidence · rank_position(>0) · is_ad · page. UNIQUE(keyword, product, 날짜, 출처, is_ad). **is_excluded 없음** |
| `watchlist` | product_id · keyword_id(발견 키워드) · status(8개) · outcome · memo · priority · tags · status_changed_at. UNIQUE(owner_id, product_id) |
| `watchlist_events` | from_status · to_status · note · changed_at. **watchlist 삭제 시 CASCADE로 함께 삭제됨** |
| `v_product_latest` | 상품 마스터 + 16개 지표 × (값, source, confidence, captured_on). 판매량·매출은 `_period_days` 포함 |
| `upsert_product_snapshot()` | 키워드용과 같은 규칙 (NULL 유지, 미정의 키 오류, is_excluded는 키가 있을 때만 변경) |
| `log_watchlist_status` | 등록 시 NULL → WATCHING, 상태 변경 시 이력 자동 기록. note는 같은 트랜잭션의 `set_config('jarvis.watchlist_note')`로 전달 |
| RLS / 복합 FK | 5개 테이블 모두 owner_id 정책 4종 + `(owner_id, …_id)` 복합 FK. 다른 사용자의 상품·키워드 참조 불가 |
| `/products`, `/watchlist` UI | 둘 다 안내 화면(PhasePlaceholder)뿐 |
| 앱 구조 | PHASE 3의 DB → repository → mapper → UI, `DataPointValue`, `SourceBadge`, `CategoryField`, `Input`, Server Function 패턴을 그대로 재사용 가능 |

## 2. 구현할 기능

| 영역 | 기능 |
|---|---|
| 상품 | 등록(쿠팡 상품 ID 또는 URL 입력, 중복이면 기존 상품 안내) · 목록 · 상세 · 기본 정보 수정 · 상태(lifecycle) 변경 |
| 스냅샷 | 수동 입력(`upsert_product_snapshot`, MANUAL, 신뢰도 A/B/C, KST 수집일) · 이력 · 제외/복원 |
| 키워드 ↔ 상품 | 상품 상세에서 키워드 선택 + 순위 입력 · 상품별 순위 이력 · 키워드 상세에 "이 키워드의 상품 순위" 목록 |
| 관심상품 | 상품 상세의 등록 버튼 · `/watchlist` 목록 · 상태 변경 · 상태 이력(트리거 기록 표시) · 해제 |

## 3. 기존 DB를 그대로 사용할 수 있는 부분

전부 사용할 수 있다. **migration 없이 구현 가능하다** (아래 결정 요청 D2에서 B를 고르는 경우만 예외).

- 상품 식별: `UNIQUE(owner_id, coupang_product_id)` → 중복 판정. 다른 사용자의 같은 상품 ID는 RLS 때문에 보이지 않고, 각자 따로 등록된다.
- 상품명 변경: `products.product_name`(최신 이름) 갱신. 관측 당시 이름은 스냅샷의 `product_name_observed`에 이력으로 남는다.
- 판매종료·삭제 감지: 이미 있는 `lifecycle_status`와 `deleted_detected_at`을 사용한다. 행 삭제 기능은 만들지 않는다.
- 하나의 상품 ↔ 여러 키워드: `keyword_product_ranks` 관계 테이블. 상품을 복제하지 않는다.

## 4. 충돌 / 문제 — 결정 요청

### D1. 관심상품 "해제" 방식 ⚠️

`watchlist` 행을 DELETE하면 FK CASCADE로 **`watchlist_events`(상태 이력)까지 삭제된다.** "과거 데이터는 가능한 한 삭제하지 않는다" 원칙과 충돌한다.

| 선택지 | 내용 |
|---|---|
| **A (Claude 권장)** | "해제" = 상태를 `DROPPED`(검토 후 제외, 이미 정의된 값)로 변경. 행과 이력이 유지되고, 다시 등록하면 상태가 WATCHING으로 돌아가며 이력이 이어진다. 목록은 기본적으로 DROPPED를 숨김 |
| B | "해제" = DELETE. 이력이 사라지고, 다시 등록하면 새 행으로 처음부터 시작한다 |

### D2. 상태 변경 메모(note) 🔸

트리거는 같은 트랜잭션의 `set_config`로 메모를 받는다. 그런데 앱(supabase-js)은 요청마다 트랜잭션이 따로라서 **메모를 전달할 방법이 없다.**

| 선택지 | 내용 |
|---|---|
| **A (Claude 권장)** | PHASE 4에서는 상태 변경 메모 없음. 상태 이력(누가 언제 무엇에서 무엇으로)은 트리거가 기록하고, 메모는 watchlist의 `memo` 필드로 관리. DB 변경 없음 |
| B | DB 함수 `set_watchlist_status(watchlist_id, status, note)` 추가 (SECURITY INVOKER, 함수 안에서 set_config 후 UPDATE). **migration 필요 = DB 변경** |

### D3. 키워드 순위의 잘못된 입력 처리 🔸

`keyword_product_ranks`에는 `is_excluded`가 없다 (스냅샷과 다름).

| 선택지 | 내용 |
|---|---|
| **A (Claude 권장)** | 같은 날짜·출처·광고 여부로 다시 입력하면 순위가 갱신된다(UNIQUE 기준 UPSERT). 그래도 잘못 만든 행은 **직접 입력(MANUAL) 행에 한해 삭제** 허용 |
| B | 삭제 불가, 같은 날짜 재입력으로만 수정 |
| C | `is_excluded` 컬럼 추가 (**DB 변경**) |

### D4. 목록의 "현재 순위" 의미 🔸

상품 자체의 순위 컬럼은 **카테고리 순위(`category_rank`, 스냅샷)뿐**이다. 검색 순위는 키워드마다 다르다 (`keyword_product_ranks`).

| 선택지 | 내용 |
|---|---|
| **A (Claude 권장)** | 목록에 "카테고리 순위"(v_product_latest)와 "키워드 순위"(가장 최근 수집일의 자연 노출 최고 순위 + 해당 키워드명)를 둘 다 표시. 키워드 순위는 repository에서 조회 (DB 변경 없음) |
| B | 카테고리 순위만 표시 |

## 5. 확인 사항 (결정 불필요, 이렇게 구현 예정)

1. **`sales_predicted`는 `product_snapshots`에 없다.** 지시 14번의 "snapshot에 이미 sales_predicted 구조가 있다"는 사실과 다르다. 설계대로 예측은 `predictions` 테이블에만 있다. PHASE 4는 예측을 만들지 않으므로 **수동 입력 폼에는 `sales_actual`(실제 판매량)과 `sales_estimated`(외부 도구 추정)만** 두고, 두 칸을 분리된 라벨로 명확히 구분한다. `predictions`는 건드리지 않는다.
2. **"28일 판매량/매출"은 고정 28일이 아니다.** `sales_period_days`와 함께 저장한다 (입력 기본값 28일).
3. **가격·배송 유형은 `products`가 아니라 스냅샷에 있다.** 상품 등록 폼에서 가격·배송 유형을 함께 입력하면 같은 요청에서 **첫 MANUAL 스냅샷**으로 저장한다. 마스터에는 넣지 않는다.
4. **판매자 유형:** 마스터 `seller_type`(현재 판단)과 스냅샷 `seller_type_observed`(관측 당시)가 둘 다 있다. 등록·수정은 마스터에, 수동 지표 입력은 스냅샷에 저장한다.
5. **쿠팡 URL 입력:** `coupang.com/vp/products/{productId}?itemId=…&vendorItemId=…`에서 productId·itemId·vendorItemId를 꺼내 채운다. 기존 컬럼만 사용하고, 사용자가 확인한 뒤 저장한다.
6. **`last_seen_at`:** 수동 스냅샷을 저장할 때, 수집일이 더 최근이면 `products.last_seen_at`을 갱신한다 (기존 컬럼의 의미대로).
7. **관심상품 `outcome`(성과 판정):** 이번 범위가 아니라 표시만 하고 편집은 PHASE 8 이후로 둔다 (판매 결과와 함께).

## 6. 필요한 repository

`src/lib/repositories/products.ts`
- `listProducts()` · `getProductDetail()` · `findProductByCoupangId()` · `createProduct()` (+ 선택: 첫 스냅샷) · `updateProduct()` (이름·브랜드·카테고리·URL·판매자 유형·상태)
- `saveManualProductSnapshot()` · `setProductSnapshotExcluded()`

`src/lib/repositories/ranks.ts`
- `saveKeywordProductRank()` · `listRanksForProduct()` · `listRanksForKeyword()` · `latestKeywordRanks()` (D4-A) · `deleteManualRank()` (D3-A)

`src/lib/repositories/watchlist.ts` (기존 파일 확장)
- `addToWatchlist()` · `releaseFromWatchlist()` (D1에 따라) · `updateWatchlistStatus()` · `listWatchlist()` · `listWatchlistEvents()`

mapper: `src/lib/mappers/product.ts`, `watchlist.ts` · 도메인 타입: `src/types/product.ts`, `watchlist.ts`

## 7. 필요한 UI

- `/products`: LIVE 배지 · 등록 폼(상품 ID 또는 URL, 이름, 브랜드, 카테고리, 판매자 유형, 선택: 가격·배송 유형) · 목록(9장 열 + 출처·신뢰도, NULL은 `-`) · 상태 필터(기본: DELETED 숨김)
- `/products/[id]`: 기본 정보·수정·상태 · 현재 지표(v_product_latest 16개) · 지표 수동 입력 · 스냅샷 이력(제외/복원) · 키워드 순위 입력과 이력 · 관심상품 등록·상태
- `/keywords/[id]`: "이 키워드의 상품 순위" 섹션 추가
- `/watchlist`: 목록(상품, 상태, 발견 키워드, 변경일, 메모) · 상태 변경 · 상태 이력 펼치기 · 해제

## 8. 테스트 계획

| 구분 | 방법 |
|---|---|
| 회귀 | 로컬 PGlite 검증 132개 |
| 운영 DB 시나리오 | 본인 계정 권한(authenticated + 본인 uid)으로 repository와 같은 SQL 재현, 트랜잭션 취소: 상품 등록·중복(23505) · 첫 스냅샷 · 같은 날짜 UPSERT(NULL 유지) · 새 날짜 최신값 · 제외/복원 · actual/estimated 분리 · 0 저장 · 순위 입력/갱신/삭제(D3) · 여러 키워드 연결 · 관심상품 등록 → 상태 변경 → 이력 자동 기록 · 해제(D1) |
| RLS | 다른 사용자(B): 내 상품·스냅샷·순위·관심상품 0건, 수정 0행, 내 상품에 스냅샷·순위·관심상품 연결 불가(복합 FK), 내 키워드에 내 상품 순위 연결 불가 |
| 품질 | typecheck · lint · build |
| UI | 사용자가 앱 브라우저 창에서 **직접 로그인한 상태**를 Claude가 이어받아 화면 조작으로 확인 (비밀번호는 Claude가 입력하지 않음) |

---

**요청:** D1~D4를 결정해 주세요. 권장안(전부 A)이면 DB 변경 없이 바로 구현할 수 있습니다.
