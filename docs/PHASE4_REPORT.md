# JARVIS PHASE 4 완료 보고

> 작성: Claude · 2026-10-07 · 기준: PHASE 4 구현 지시 (D1~D4 = A, migration 0개)
> PHASE 5는 시작하지 않음.

## 1. 구현 완료 기능

| 영역 | 기능 | 상태 |
|---|---|---|
| 상품 | 등록 (쿠팡 URL 또는 상품 ID → productId·itemId·vendorItemId 자동 추출, 사용자가 확인 후 저장, 서버에서 재검증) | ✅ |
| | 중복: 같은 `(owner_id, coupang_product_id)`면 새 행을 만들지 않고 "이미 등록된 상품입니다" + 기존 상품 링크 (조회 + DB UNIQUE 이중 방어) | ✅ |
| | 목록 (상품명·브랜드·ID·카테고리·가격·리뷰·평점·카테고리 순위·키워드 순위·배송·최근 수집·상태, 출처·신뢰도, NULL은 `-`) · 상태 필터(기본 DELETED 숨김) | ✅ |
| | 상세 · 기본 정보 수정(master 컬럼만, 쿠팡 상품 ID 고정) · lifecycle 변경(ACTIVE / UNAVAILABLE / DELETED, 행 삭제 없음, DELETED 시 `deleted_detected_at` 기록) | ✅ |
| 스냅샷 | 등록 시 가격·배송 유형을 입력하면 첫 MANUAL 스냅샷 (입력 안 하면 만들지 않음) | ✅ |
| | 수동 입력 → `upsert_product_snapshot()` (MANUAL, A/B/C, KST 수집일, 미래 불가) · 같은 날짜 UPSERT, NULL은 기존 값 유지 | ✅ |
| | 현재 지표 16개 (`v_product_latest`, 값·출처·신뢰도·수집일) · 이력(최신 → 과거) · 제외/복원 | ✅ |
| | **sales_actual / sales_estimated 분리 입력** + `sales_period_days`(기본 28, 변경 가능, 판매량·매출이 있을 때만 저장). sales_predicted는 입력하지 않음, `predictions` 미사용 | ✅ |
| | `last_seen_at`: 더 최신 수집일일 때만 갱신 (과거로 되돌리지 않음) | ✅ |
| | 할인율: 판매가·정가를 함께 입력하고 비우면 계산 → `metric_meta` CALCULATED | ✅ |
| 키워드 ↔ 상품 | 상품 상세에서 키워드 선택 + 순위·페이지·광고 여부·수집일·신뢰도 입력 (MANUAL) · 같은 조건 재입력은 UPSERT | ✅ |
| | 상품별 순위 이력 · `/keywords/[id]`에 "이 키워드의 상품 순위" · 목록의 대표 키워드 순위(D4-A: 최근 수집일 · 자연 노출 · 최고 순위 + 키워드명) | ✅ |
| | MANUAL 순위만 삭제 (D3-A, repository에서 출처 확인 + 삭제 조건에 `source_type = MANUAL`) | ✅ |
| 관심상품 | 상품 상세에서 등록(발견 키워드 선택) · 상태 변경 · 메모(`watchlist.memo`) · 상태 이력 표시(트리거 기록) | ✅ |
| | 해제 = `DROPPED` (D1-A, 행·이력 보존) · 다시 등록 = 같은 행 `DROPPED → WATCHING` · 상태 변경 메모 전달 없음 (D2-A) | ✅ |
| | `/watchlist`: 목록 · 상태 필터(기본 DROPPED 숨김, DROPPED·전체 보기 가능) · 상태 변경 · 메모 · 이력 펼치기 · 해제 | ✅ |

## 2. 변경 / 추가 파일

**추가**
- 라우트: `src/app/products/[id]/page.tsx`, `src/app/products/actions.ts`, `src/app/watchlist/actions.ts`
- 컴포넌트: `src/components/products/` (`product-create-form`, `products-table`, `product-edit-form`, `product-snapshot-form`, `product-snapshot-history`, `rank-form`, `rank-history`, `labels`), `src/components/watchlist/` (`watchlist-controls`, `watchlist-forms`)
- 라이브러리: `src/lib/coupang.ts` (URL 해석), `src/lib/forms.ts` (폼 공통 규칙), `src/lib/category-form.ts`
- repository: `src/lib/repositories/ranks.ts`
- mapper: `src/lib/mappers/product.ts`, `src/lib/mappers/watchlist.ts`
- 도메인 타입: `src/types/product.ts`, `src/types/watchlist.ts`

**수정**
- `src/app/products/page.tsx`, `src/app/watchlist/page.tsx` — 안내 화면 → LIVE
- `src/app/keywords/[id]/page.tsx` — 상품 순위 섹션 + 설정 폼 key (아래 9-2)
- `src/app/keywords/actions.ts` — 공통 폼 규칙(`lib/forms.ts`)으로 정리 (동작 동일)
- `src/lib/repositories/products.ts`, `watchlist.ts` — PHASE 4 함수로 교체 · `keywords.ts` — `listKeywordOptions` 추가, 스냅샷 결과 검증
- `src/components/common/category-field.tsx`, `form-message.tsx` — keywords → common으로 이동 (상품과 공용) + 폼 초기화 버그 수정 (9-1)
- `src/components/common/data-point-value.tsx` — 숫자·텍스트 값 공용 (generic)
- `src/types/keyword.ts`, `src/lib/mappers/keyword.ts` — `updatedAt` 추가 (폼 다시 그리기 기준)

## 3. DB migration 여부

**없음 (0개).** 테이블·컬럼·도메인·함수·트리거·뷰·RLS·복합 FK 모두 변경하지 않음. 운영 DB migration 목록은 14개로 그대로.

## 4. repository 목록

| 파일 | 함수 |
|---|---|
| `products.ts` | `listProducts({status})` · `getProductDetail` · `findProductByCoupangId` · `listProductOptions` · `createProduct` · `updateProduct` · `saveManualProductSnapshot` · `setProductSnapshotExcluded` |
| `ranks.ts` | `saveKeywordProductRank` · `listRanksForProduct` · `listRanksForKeyword` · `latestKeywordRanks` · `deleteManualRank` |
| `watchlist.ts` | `listWatchlist({status})` · `getWatchlistForProduct` · `addToWatchlist` (ADDED / RESTORED / ALREADY) · `releaseFromWatchlist` · `updateWatchlistStatus` · `updateWatchlistMemo` · `listWatchlistEvents` · `listWatchlistEventsFor` |
| `keywords.ts` | (추가) `listKeywordOptions` |

모든 함수는 `getCurrentUser()`로 확인한 뒤 일반 authenticated 클라이언트 + RLS로 실행한다. **service role 미사용.** UI는 mapper가 만든 도메인 타입만 사용한다.

## 5. UI route

| 경로 | 내용 |
|---|---|
| `/products` | LIVE · 등록 · 목록 · 상태 필터 (`?status=ACTIVE / UNAVAILABLE / DELETED / ALL`) |
| `/products/[id]` | 기본 정보·수정·상태 · 현재 지표 · 관심상품 · 지표 입력 · 수집 이력 · 키워드 순위 입력·이력 |
| `/keywords/[id]` | 기존 기능 + 이 키워드의 상품 순위 |
| `/watchlist` | 목록 · 필터 (`?status=…`) · 상태 변경 · 메모 · 이력 · 해제 |

## 6. 테스트 결과

| 구분 | 결과 |
|---|---|
| 운영 DB 시나리오 (본인 계정 권한, 트랜잭션 취소로 흔적 없음) | **36 / 36 통과** — 상품 등록·중복(23505)·다른 상품 · 첫 스냅샷 · 같은 날짜 UPSERT·NULL 유지 · 새 날짜 · actual/estimated 분리·기간·0 저장 · 할인율 CALCULATED · 제외/복원 · last_seen_at · 수정·lifecycle · 순위 UPSERT·여러 키워드·대표 순위·MANUAL 삭제·비MANUAL 보존 · 관심상품 등록→WATCHING·상태 이벤트·memo는 이벤트 없음·DROPPED·재등록 같은 행·이력 보존·중복 생성 불가 · 상태값·배송 유형 CHECK |
| 쿠팡 URL 해석 단위 테스트 | 9 / 9 — PC·모바일 URL, 추적 파라미터 제거, 숫자 ID, 다른 도메인·`notcoupang.com`·비숫자 ID 거부 |
| 회귀: 로컬 PGlite | **132 / 132** |
| typecheck · lint · build | ✅ · ✅ (0 errors) · ✅ |

## 7. RLS 결과

다른 사용자 B로 시도 (운영 DB):

| 항목 | 결과 |
|---|---|
| 내 상품·스냅샷·순위·관심상품·이력·현재값 조회 | 0건 ✅ |
| 내 상품 수정 / 내 순위 삭제 / 내 관심상품 상태 변경 | 0행 ✅ |
| 내 상품에 새 스냅샷 연결 | 차단 (복합 FK 23503) ✅ |
| 내 상품·내 키워드로 순위 연결 | 차단 (23503) ✅ |
| 내 상품을 관심상품으로 연결 | 차단 (23503) ✅ |
| 내 상품의 **기존** (날짜·출처) 스냅샷 대상 호출 | 데이터 변경 없음 ✅, 다만 오류 대신 빈 SKIPPED 반환 → 10-1 |
| B의 시도 후 내 데이터 (이름·가격·제외 여부·관심상품 상태·순위 수) | 그대로 ✅ |

## 8. 브라우저 검증 결과

사용자가 앱 브라우저 창에서 직접 로그인한 세션을 이어받아 확인했다 (비밀번호 입력 없음). 테스트 데이터는 모두 `[TEST]` 표시.

| 화면 | 확인 | 결과 |
|---|---|---|
| `/products` | LIVE · URL 붙여넣기 → ID 3개 자동 채움(추적 파라미터 제거) · 새 카테고리 · 등록 + 첫 지표 · 목록 행(없는 값 `-`) · 같은 ID 재등록 → "이미 등록된 상품입니다" + 기존 상품 링크 · 상태 필터(DELETED 기본 숨김, 필터로 표시) | ✅ |
| `/products/[id]` | 기본 정보 · 수정(이름·PB·상태) · 현재 지표 16개 · 같은 날짜 저장 → "갱신"(가격·배송 유지, 실제 0 / 추정 500 · 28일) · 과거 날짜 → 새 행, 할인율 "자체 계산", 최근 관측일 유지 · 제외 → 현재값 재계산 · 복원 | ✅ |
| 키워드 순위 | 23위 → 21위 재입력 시 1행 갱신 · 광고 3위 별도 · 다른 키워드 8위 · 목록 대표 순위 "8위 · [TEST] 접이식의자"(광고 제외) · MANUAL 삭제 | ✅ |
| `/keywords/[id]` | 상품 순위 섹션 · 기존 지표 입력(경쟁강도 자체 계산) · 설정 저장 | ✅ |
| `/keywords` | 등록 · 대소문자·공백 다른 중복 차단 (PHASE 3 회귀) | ✅ |
| 관심상품 | 등록(발견 키워드) → "등록 → 관찰" · 소싱 검토 · 메모(이벤트 없음) · 해제 · 다시 등록(같은 행, 이력 이어짐) · `/watchlist` 기본 목록에서 해제 항목 숨김, "해제(제외)" 필터로 표시, 이력 5건 | ✅ |
| DB 대조 | 화면 결과와 운영 DB 값 일치 (MCP 조회) | ✅ |

## 9. 검증 중 발견해서 고친 문제 (DB 변경 없음)

1. **등록 폼 초기화 불일치:** 등록이 끝나면 React가 폼을 reset하는데, 카테고리 선택칸만 "미지정"으로 돌아가고 "새 카테고리" 입력칸이 남아 다음 등록을 막았다. → reset 이벤트 때 선택 상태도 되돌리도록 수정. 쿠팡 ID 칸도 함께 비움.
2. **수정 폼이 저장 후 옛 값으로 되돌아감 (데이터 위험):** 상품 기본 정보를 저장하면 DB와 제목은 바뀌는데, 폼의 상태·PB 선택은 이전 값으로 reset됐다. 그대로 다시 저장하면 상태가 조용히 되돌아갈 수 있었다. **PHASE 3 키워드 설정 폼에도 같은 문제가 있었다.** → 폼에 서버 `updated_at`을 key로 주어 저장 후 새 값으로 다시 그리도록 수정(상품 기본 정보, 키워드 설정, 관심상품 메모). 재확인 완료.
3. **자동 계산 안내 문구:** "비우면 계산"이 기존 저장값까지 쓰는 것처럼 읽혔다. → "두 값을 함께 입력하고 비우면 계산"으로 수정 (상품 할인율, 키워드 경쟁강도·검색량 증감).

## 10. 발견된 문제 (결정 필요 / 참고)

1. **[결정 필요] `upsert_*_snapshot()`의 다른 사용자 행 처리.** 다른 사용자의 상품·키워드 ID로, 이미 존재하는 (날짜·출처) 행을 대상으로 호출하면, `ON CONFLICT DO NOTHING`이 복합 FK 검사보다 먼저 걸린다. 그래서 **오류 대신 빈 행 + "SKIPPED"를 반환한다.**
   - 데이터는 바뀌지 않는다 (운영 DB에서 확인).
   - 상대 UUID를 알아야 하므로 실제 위험은 매우 낮다.
   - 그래도 "다른 사용자 행이 존재한다"는 정보가 간접적으로 드러날 수 있다.
   - **PHASE 4 조치:** 앱 repository가 이 결과를 "본인 데이터가 아님" 오류로 처리 (DB 변경 없음).
   - **근본 수정:** 함수가 이 경우 예외를 던지도록 바꾸는 migration 1개 (`insert` 결과가 없고 재조회도 안 되면 `raise`). 승인 필요.
2. **폼 오류 시 입력값 초기화.** React의 폼 액션은 결과(성공·실패)와 관계없이 끝나면 폼을 reset한다. 중복 안내가 나와도 입력했던 값이 지워진다 (PHASE 3 키워드 폼과 같은 동작). 불편하면 다음 단계에서 오류 시 입력값을 유지하도록 개선 가능 (DB 무관).
3. **상품 등록과 첫 스냅샷은 한 트랜잭션이 아니다.** 상품은 등록됐는데 첫 지표 저장만 실패하면, 화면에 "지표 저장 실패 — 상세에서 다시 입력"이라고 안내한다. 상품 행은 남는다.
4. **`/keywords` 목록에 키워드 2개가 따로 있다.** "실리콘 주방 트레이"와 "실리콘주방 트레이"다. 띄어쓰기 유무는 중복 판정 규칙(소문자 + 공백 정리)상 다른 키워드로 본다. 같은 키워드로 볼지는 규칙 결정 사항이다 (현재 설계 유지).
5. 개발 서버 로그의 hydration 경고(`<body ap-style>`)는 브라우저 창이 넣는 속성이며 앱 코드와 무관.

## 11. 사용자 확인이 필요한 항목

1. **브라우저 테스트로 운영 DB에 남은 `[TEST]` 데이터 정리 여부.** 상품 1개(`9900000001`, 스냅샷 2 · 순위 2 · 관심상품 1 + 이력 5), 카테고리 `[TEST] 캠핑용품`, 키워드 `[TEST] 캠핑의자`(스냅샷 1), `[TEST] 접이식의자`. 앱에는 삭제 기능이 없어서(설계) 승인하시면 Claude가 DB에서 정리한다.
2. 10-1 결정 (함수 근본 수정 migration 여부)
3. 직접 화면을 둘러보고 불편한 점 확인 (특히 등록 폼·지표 입력 폼 구성)

## 12. 다음 PHASE 제안 (진행하지 않음)

- **PHASE 5 — 경쟁상품 데이터 구조:** `competitors` 테이블(상품 ↔ 경쟁상품, 관계 유형 SAME_PRODUCT / SIMILAR / SUBSTITUTE, 맥락 키워드)을 `/competitors`·상품 상세와 연결한다. 키워드 순위 데이터로 "같은 키워드 상위 상품"을 경쟁 후보로 보여주고, 사용자가 확정하는 방식.
- 그전에 10-1 함수 수정 여부와 `/categories` 최소 관리(이름·경로·수수료율·비활성)를 결정하면, PHASE 6 수익성 계산(카테고리 수수료율 기본값)이 수월해진다.
