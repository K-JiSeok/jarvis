# PHASE 3 완료 보고 — 키워드 데이터 구조 (`/keywords` ↔ Supabase)

> 작성: Claude · 2026-10-07 · 저장소 `main`
> 사전 작업(PHASE 2-2 마무리: 결정 ①②)은 `docs/PHASE2_2_REPORT.md` 17장에 기록.
> PHASE 4는 시작하지 않음.

## 1. 구현한 기능

| 요구 | 구현 |
|---|---|
| 키워드 등록 | `/keywords` 등록 폼. 원문 정리(앞뒤 공백, 연속 공백) 후 `normalizeKeyword()`로 중복 판정 키 생성 |
| normalized 중복 방지 | 저장 전 조회 + DB UNIQUE(23505) 이중 확인. 중복이면 "이미 등록된 키워드" + 기존 키워드 링크 |
| 카테고리 연결 | 기존 카테고리 선택, 또는 "+ 새 카테고리…"로 이름 입력 → `categories`에 `source_type = MANUAL`로 생성 (같은 이름이면 기존 것 사용) |
| tracking ON/OFF | 등록 시 체크박스, 목록의 배지를 눌러 바로 전환, 상세 설정. **삭제 기능 없음** (중지로 대신) |
| 키워드 목록 | 키워드 · 카테고리 · 월 검색량 · 상품 수 · 경쟁강도 · WING · 로켓 · 최근 수집일 · 추적. 각 값 아래 **출처·신뢰도 배지**, 값이 없으면 `-` (0으로 채우지 않음) |
| 키워드 상세 | 기본 정보(키워드, normalized, 카테고리, 추적, 메모 수정) · 현재 지표 12개(`v_keyword_latest`, 항목별 출처·신뢰도·수집일) · 수집 이력(`keyword_snapshots`) |
| 수동 지표 입력 | 상세 화면 폼 → **`upsert_keyword_snapshot()`**, `source_type = MANUAL`, 신뢰도 A/B/C 선택(기본 B), 수집일(KST, 미래 불가) |
| 입력 검증 | 음수 검색량·상품 수·가격·리뷰 불가, 비율 0~100%, 정수 항목 확인. 화면은 %로 입력받고 저장은 0~1 (DB CHECK와 같은 범위) |
| 파생 지표 | 경쟁강도·검색량 증감을 비워 두면 같은 입력값으로 계산하고 `metric_meta`에 `CALCULATED`로 기록 (직접 입력값과 구분) |
| 잘못된 스냅샷 | 이력의 행마다 "제외"(사유 입력) / "복원". `upsert_keyword_snapshot`의 `is_excluded`만 바꿈 → 현재값에서 빠지고 **원본은 남음** |
| LIVE / 로그인 | 로그인 시 `LIVE` 배지와 실데이터 표시. 비로그인 시 로그인 안내(로그인 후 같은 화면으로 복귀). Dashboard는 DEMO 그대로 |

## 2. 변경한 파일

**추가**
- `src/app/keywords/actions.ts` — Server Functions
- `src/app/keywords/[id]/page.tsx` — 상세
- `src/components/keywords/` — `keyword-create-form.tsx`, `keywords-table.tsx`, `keyword-settings-form.tsx`, `snapshot-form.tsx`, `snapshot-history.tsx`, `category-field.tsx`, `form-message.tsx`
- `src/components/common/data-point-value.tsx` — 값 + 출처·신뢰도 (+수집일), NULL은 `-`
- `src/components/common/login-required.tsx`
- `src/components/ui/input.tsx` — Input / NativeSelect / Label
- `src/lib/keywords.ts` — `normalizeKeyword` / `cleanKeyword` (서버·클라이언트 공용으로 이동)
- `src/lib/mappers/keyword.ts` — DB 행 → 도메인 타입
- `src/types/keyword.ts` — 도메인 타입 (DataPoint 기반)

**수정**
- `src/app/keywords/page.tsx` — 안내 화면 → LIVE 목록·등록
- `src/lib/repositories/keywords.ts` — 조회·저장 함수 추가 (아래)
- `src/lib/format.ts` — `formatDecimal`, `formatShortDate` 추가

## 3. 추가한 repository / API

구조: **DB → repository → mapper(도메인 타입) → UI**. UI는 Supabase 원시 응답을 직접 쓰지 않는다.

| 함수 | 내용 |
|---|---|
| `listCategories()` | 활성 카테고리 |
| `listKeywords()` | `v_keyword_latest` + 카테고리 → `KeywordSummary[]` |
| `getKeywordDetail(id)` | 현재값 + 메모 + 스냅샷 이력(제외 포함) → `KeywordDetail` (본인 것이 아니면 null → 404) |
| `findKeywordIdByText(keyword)` | normalized 기준 중복 조회 |
| `findOrCreateCategory(name)` | MANUAL 카테고리 |
| `createKeyword` / `updateKeyword` | 등록 / 추적·카테고리·메모 (삭제 없음) |
| `saveManualKeywordSnapshot` | `rpc('upsert_keyword_snapshot')`, MANUAL, 계산 항목은 `metric_meta` |
| `setKeywordSnapshotExcluded` | `rpc('upsert_keyword_snapshot')`로 `is_excluded` / `excluded_reason`만 변경 |

Server Functions: `createKeywordAction`, `updateKeywordAction`, `setTrackingAction`, `saveSnapshotAction`, `setSnapshotExcludedAction`. 모두 `getCurrentUser()` 확인 후 **로그인 사용자 세션 클라이언트(anon/publishable 키 + RLS)**로 실행. service role 사용 없음.

## 4. DB 변경 여부

**PHASE 3: 없음.** 테이블·컬럼·함수·정책 변경 없이 PHASE 2 구조를 그대로 사용.

(PHASE 3 시작 전 GPT 결정 ①②에 따라 migration 2개를 적용함 — `20261007015755_widen_margin_rate_columns`, `20261007015802_immutability_triggers`. 상세는 PHASE2_2_REPORT 17장.)

## 5. 실제 Supabase 테스트 결과

운영 DB에서 **본인 계정 권한(authenticated + 본인 uid)**으로, repository가 실행하는 것과 같은 SQL을 재현함. 트랜잭션은 마지막에 취소해서 흔적 없음. **14 / 14 통과**

| # | 항목 | 결과 |
|---|---|---|
| K3-01 | 키워드 등록 (owner = 본인, 카테고리 연결) | ✅ |
| K3-02 | 같은 normalized keyword 중복 등록 차단 (23505) | ✅ |
| K3-03 | 추적 OFF · 메모 수정 | ✅ |
| K3-04 | 수동 지표 저장 → INSERTED, MANUAL | ✅ |
| K3-05 | 현재값: 직접 입력 = MANUAL, 자동 계산 경쟁강도 = CALCULATED | ✅ |
| K3-06 | 입력하지 않은 값은 NULL (0 아님) | ✅ |
| K3-07 | 같은 날짜 재저장 → UPDATED, 빈 칸은 기존 값 유지, 행 1개 | ✅ |
| K3-08 | 새 날짜 → 최신값 반영, 다른 항목은 이전 날짜 값 유지 | ✅ |
| K3-09 | 제외 → 현재값에서 빠짐, 원본 행·사유 유지 | ✅ |
| K3-10 | 복원 → 다시 반영 | ✅ |
| K3-11 | 범위 밖 비율(WING 150%) DB 차단 (23514) | ✅ |
| K3-12~14 | 다른 사용자 차단 (6장) | ✅ |

**앱 화면을 통한 등록·조회·수정** (로그인 필요 → 사용자 확인 항목): 8장 체크리스트.

## 6. RLS 테스트 결과

| 항목 | 결과 |
|---|---|
| 다른 사용자(B)는 내 키워드·스냅샷·현재값·카테고리 0건 | ✅ K3-12 |
| B는 내 키워드 수정 불가 (0행) | ✅ K3-13 |
| B는 내 키워드에 스냅샷 입력 불가 (복합 FK 23503) | ✅ K3-14 |
| 기존 RLS 검증 (B01~B12, N01~N05 포함 132개) | ✅ 로컬·운영 모두 통과 |
| 비로그인 접근 | `/keywords`, `/keywords/[id]` 모두 로그인 안내, 데이터 조회 없음 ✅ |
| service role | 키워드 기능에서 사용 안 함 (`admin.ts` import 없음) ✅ |

## 7. typecheck / lint / build

- typecheck ✅ · lint ✅ (0 errors) · build ✅
- 새 라우트 `ƒ /keywords`, `ƒ /keywords/[id]`
- 로컬 DB 검증 132/132 ✅

## 8. UI 확인 결과

| 확인 | 결과 |
|---|---|
| 비로그인 `/keywords` | 로그인 안내 표시 ✅ |
| 비로그인 `/keywords/[id]` | 로그인 안내 표시 ✅ |
| 서버 오류 로그 | 없음 ✅ |
| **로그인 후 화면** | **사용자 확인 대기.** Claude는 실제 계정 비밀번호를 입력하지 않음 |

사용자 확인 체크리스트:
1. 로그인 → `/keywords`에 `LIVE` 배지, 빈 목록 안내
2. 키워드 등록 (새 카테고리 입력 포함) → 목록에 표시
3. 대소문자·공백만 바꾼 같은 키워드 등록 → "이미 등록된 키워드" + 링크
4. 목록에서 추적 배지 클릭 → 중지 ↔ 추적 중
5. 상세 → 지표 입력 (검색량·상품 수만 넣고 경쟁강도는 비움) → 현재 지표에 경쟁강도가 "자체 계산"으로 표시
6. 같은 날짜에 다른 칸만 다시 저장 → 기존 값 유지 + "갱신" 메시지
7. 이력에서 "제외" → 현재 지표에서 빠짐, 이력에는 "제외됨"으로 남음 → "복원"

## 9. 기존 JARVIS 설계에서 변경된 사항

**없음.** (DB 구조·컬럼 의미·snapshot 구조·source_type/confidence 의미·RLS·owner_id 모두 그대로)

설계 범위 안에서 UI가 정한 것 (보고 목적):
- 카테고리가 0개라 "선택"이 불가능해서, 등록 폼에서 새 카테고리 이름 입력을 허용함 (`categories`에 MANUAL 행 생성, 기존 컬럼만 사용)
- 비율은 화면에서 %로 받고 0~1로 저장
- 파생 지표(경쟁강도·검색량 증감)는 비워 두면 계산하고 `metric_meta`에 CALCULATED로 표시 (설계의 항목별 출처 덮어쓰기 기능 사용)
- 수동 입력 신뢰도 기본값 B (사용자가 A/C로 변경 가능)
- 키워드 문자열 자체는 수정 불가 (중복 판정 키 보호). 바꾸려면 새로 등록하고 기존 것은 추적 중지

## 10. 발견된 문제

1. **빈 칸으로 값을 "지울" 수 없음.** 설계상 NULL은 기존 값을 유지한다. 잘못 넣은 값은 그 스냅샷을 "제외"한 뒤 다시 입력해야 한다. 정상 동작이지만 사용자 안내가 필요하다 (화면 문구 반영).
2. **한 날짜에 직접 입력(MANUAL) 행은 1개.** 같은 날짜에 다시 저장하면 그 행이 갱신된다. 신뢰도도 마지막 저장값으로 바뀐다 (PHASE2_2_REPORT 12-2-6과 같은 성질).
3. **카테고리 관리 화면 없음.** 이름 변경·비활성화는 `/categories` 단계에서 다룰 예정.
4. Security Advisor 권고 1건 (Auth 유출 비밀번호 차단 꺼짐) — DB 무관, 계정 설정 (PHASE2_2_REPORT 17장).

## 11. 다음 PHASE 제안 (진행하지 않음)

- **PHASE 4 — 상품 데이터 구조:** `/products` 상품 등록(쿠팡 productId 기준 중복 방지), `upsert_product_snapshot` 수동 입력, `v_product_latest` 현재값과 이력, 이름 변경·삭제 감지(`lifecycle_status`), 키워드 ↔ 상품 순위(`keyword_product_ranks`) 수동 입력, `/watchlist` 등록과 상태 이력(`log_watchlist_status`)
- 또는 그전에 **`/categories` 최소 관리**(이름·경로·수수료율·비활성) — 수익성 계산(PHASE 6)의 카테고리 수수료율 기본값이 여기에 의존
