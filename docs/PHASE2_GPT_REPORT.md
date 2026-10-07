# JARVIS PHASE 2 완료 보고 (GPT 검토용)

> 작성: Claude · 2026-10-07 · 저장소: https://github.com/K-JiSeok/jarvis (`main`)
> 상세 문서: `docs/PHASE2_DB_DESIGN.md`(설계) · `docs/PHASE2_2_REPORT.md`(구현·검증 전체 기록)
> **요청: 아래 "결정 요청" 2건을 확정하고, PHASE 3 범위를 확인해 주세요.**

---

## 1. 한 줄 요약

승인된 DB 설계(19개 테이블)를 Supabase 운영 DB에 그대로 구축했습니다. 운영 DB 검증 108개 항목이 전부 통과했고, 본인 계정 로그인과 RLS가 적용된 실제 조회까지 확인했습니다. 설계에서 뺀 것이나 의미를 바꾼 것은 없습니다.

## 2. 진행 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 2-1 | DB 설계안 (`PHASE2_DB_DESIGN.md`) | ✅ 승인 |
| 2-2 사전 점검 | 설계·구현 충돌 B-1 ~ B-7 보고 → 승인 | ✅ |
| 2-2 구현 | migration 12개, 함수·트리거·뷰·RLS, 로컬(PGlite) 검증 | ✅ |
| 2-2 적용 | Supabase **JARVIS** 프로젝트(서울, PostgreSQL 17.11)에 적용 | ✅ |
| 2-3 | 로그인 · 세션 갱신 · RLS 실조회 화면 | ✅ (사용자가 로그인/로그아웃 직접 확인) |

## 3. 구축 결과

| 항목 | 결과 |
|---|---|
| 테이블 | 19개 (설계 Part B 그대로) |
| View | 4개, 모두 `security_invoker` — `v_product_latest`, `v_keyword_latest`, `v_current_scores`, `v_prediction_vs_actual` |
| DOMAIN | 5개 (`source_type_t`, `confidence_t`, `verdict_t`, `risk_type_t`, `risk_level_t`). ENUM은 쓰지 않음 |
| 함수 | `upsert_product_snapshot`, `upsert_keyword_snapshot` (NULL이면 기존 값 유지), `rollback_import` (충돌 시 전체 중단 + 충돌 목록) |
| 트리거 | `set_updated_at` 8개 테이블, `log_watchlist_status` (상태 이력 자동 기록) |
| RLS | 18개 테이블 × select/insert/update/delete 정책 (`owner_id = auth.uid()`). `scoring_versions`는 읽기 전용. anon 권한 전면 제거 |
| 복합 FK (B-1) | 테이블 간 FK 53개가 모두 `(owner_id, …_id)` 구조 → 다른 사용자의 행을 참조할 수 없음 |
| Scoring V1 | DB seed = `scoring-weights.ts` **완전 일치** (15/15/10/15/10/10/5/15/5 = 100, 판정 80/60) |
| 인증 | 이메일+비밀번호 로그인만 있음. Supabase에서 신규 가입 차단, 계정은 1개 |
| 앱 구조 | `src/lib/supabase` (client/server/admin), `src/lib/repositories`, `src/proxy.ts` (세션 갱신), 공식 생성 타입 `src/types/database.ts` |
| DEMO | DB에 넣지 않음. Dashboard는 계속 DEMO 모드 |

## 4. 검증

| 검증 | 결과 |
|---|---|
| 운영 DB 검증 스크립트 | **108 / 108 통과**. BEGIN … ROLLBACK 방식이라 실행 후 테스트 사용자·데이터 0건 |
| 검증 범위 | 구조(테이블·뷰·DOMAIN·정책·권한·UNIQUE·NULLS NOT DISTINCT·복합 FK·생성 컬럼), 10단계 전체 흐름 입력, 스냅샷 UPSERT·현재값 우선순위, V1/V2 점수 공존, file_hash·idempotency_key 중복 차단, rollback(성공·REFERENCED·LATER_IMPORT·MODIFIED 충돌), 예측 vs 실제, 사용자 A/B RLS 차단, anon 차단 |
| 로컬 ↔ 운영 스키마 비교 | 함수·뷰·컬럼·제약·정책·트리거·seed 일치 (인덱스 1개는 표기 차이만 있음) |
| Security Advisor | 경고 0건 |
| Performance Advisor | 정보성 알림만 있음: FK 커버링 인덱스 41건(예상된 항목), 미사용 인덱스 18건(데이터가 없어서) |
| 앱 | typecheck · lint · build 통과. 로그인 → 설정 화면 "연결 정상 · 점수 버전 v1 코드와 일치 · 내 데이터 0건" → 로그아웃까지 사용자가 확인 |

## 5. 설계 대비 추가한 것 (의미 변경 없음)

- 복합 FK와 이를 위한 `UNIQUE(owner_id, id)` (B-1 승인)
- 같은 상품끼리만 연결되도록 하는 FK 2개: 수익성 계산 → 시나리오, 위험요소 → 점수
- 설계 공통 규칙에 맞춘 CHECK: 비율 0~1, 점수 0~100, 평점 0~5 등
- `import_job_id`의 의미를 "그 행을 마지막으로 쓴 import"로 정함 (롤백 충돌 검사용)
- upsert 함수 2개 (B-2 승인), 정의되지 않은 키가 오면 오류
- migration 파일 이름을 Supabase 적용 버전 번호(`20261007…`)로 맞춤

---

## 6. 결정 요청 ① — 비율 컬럼 범위 `numeric(7,4)`

**문제:** `numeric(7,4)`는 ±999.9999까지만 저장됩니다. 대상 컬럼은 다음 3개입니다.
- `sales_results.net_margin_rate`: 생성 컬럼(DB가 자동 계산)
- `profit_calculations.net_margin_rate`
- `predictions.net_margin_predicted`

손실이 매출의 1,000배를 넘으면 범위를 벗어나고, 그 행의 INSERT가 **실패**합니다. 예를 들어 하루 매출 9,900원에 광고비 1,000만 원이면 이렇게 됩니다.

`sales_results`는 DB가 값을 계산하는 생성 컬럼이라, 앱에서 값을 조정해 넣는 식으로 피할 수도 없습니다. 이 경우 **실제 판매 결과 자체를 저장할 수 없게 됩니다.**

| 선택지 | 내용 | 장단점 |
|---|---|---|
| **A (Claude 권장)** | 3개 컬럼을 `numeric(12,4)`로 확대 | 범위 ±99,999,999로 사실상 문제 없음. 의미 변경 없음. migration 1개 추가 (데이터가 0건이라 위험 없음) |
| B | 현행 유지 | 극단적 손실 기록이 실패할 수 있음. 실적 데이터 누락 위험 |
| C | 값을 ±999.9999로 잘라서 저장 | 실제 값이 왜곡됨 → "NULL = 모름 / 값은 사실" 원칙 위반, 비권장 |

## 7. 결정 요청 ② — 수정 금지 규칙을 DB가 강제할지

**문제:** 설계상 아래 3가지는 "수정하지 않고 새로 쌓는" 데이터입니다. 지금은 이 규칙을 **관례로만** 지키고 있고, DB는 막지 않습니다. 본인 계정은 자기 점수 행을 UPDATE할 수 있습니다.
- `scoring_versions`: 릴리스된 가중치·판정 기준
- `opportunity_scores`: 계산된 점수 (`is_current`만 변경 가능해야 함)
- `predictions`: 예측값

점수나 예측이 나중에 덮어써지면 **"그때 JARVIS가 뭐라고 했나"라는 학습 기준이 오염**됩니다.

| 선택지 | 내용 | 장단점 |
|---|---|---|
| **A (Claude 권장)** | 수정 방지 트리거 추가. `opportunity_scores`는 `is_current` 외 컬럼 UPDATE 차단, `predictions`는 UPDATE 차단, `scoring_versions`는 릴리스 후 `weights`·`thresholds` 변경 차단. 잘못 넣은 행의 DELETE는 허용 | 학습 데이터 무결성 보장. migration 1개 추가 |
| B | A + DELETE도 차단 (`my_listings`가 참조하는 baseline 점수는 이미 FK로 삭제가 막혀 있음) | 가장 엄격함. 테스트·오입력 정리가 불편 |
| C | 현행 유지 (관례) | 앱 버그 한 번으로 과거 점수가 덮어써질 수 있음 |

---

## 8. 그 밖의 운영 규칙 (DB가 강제하지 않음, 앱이 지켜야 함)

- 스냅샷 변경은 항상 `upsert_*_snapshot()`으로 합니다. 직접 UPDATE하면 롤백 충돌 검사가 놓칩니다.
- 키워드는 삭제하지 않고 `is_tracking = false`로 둡니다. 점수와의 유니크 충돌 때문입니다.
- `normalized_keyword`는 앱의 `normalizeKeyword()`(소문자·공백 정리)로 만듭니다.
- 같은 `file_hash` 재업로드는 처리 전에 조회해서 경고합니다. DB는 성공 확정 시점에 차단합니다.

## 9. 다음 단계 제안 — PHASE 3 키워드 데이터 구조

PHASE 2에서 만든 테이블·함수를 화면과 연결하는 첫 단계입니다. 크롤링·자동수집은 하지 않습니다.

1. **키워드 화면 (`/keywords`):** 등록·목록·상세, `normalizeKeyword` 중복 방지, 카테고리 연결, 추적 on/off
2. **키워드 지표 수동 입력:** `upsert_keyword_snapshot`으로 날짜별 검색량·상품수·WING/로켓 비율 등을 입력. `source_type = MANUAL`
3. **현재값 + 이력 표시:** `v_keyword_latest`의 값을 출처·신뢰도·수집일 배지와 함께 표시하고, 날짜별 스냅샷 이력도 보여줌
4. **잘못된 스냅샷 처리:** 삭제 대신 `is_excluded` 처리
5. **DEMO/LIVE 표시:** 로그인했으면 LIVE, 아니면 키워드 화면은 로그인 안내

**제외:** CSV import (PHASE 9), 키워드 점수 계산 (PHASE 7), 쿠팡·네이버 데이터 연동

**확인 요청:** 위 PHASE 3 범위가 맞는지, 추가하거나 뺄 것이 있는지 알려주세요.
