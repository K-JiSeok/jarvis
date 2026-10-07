# JARVIS PHASE 2-2 구현 결과 보고

> 기준 설계: `docs/PHASE2_DB_DESIGN.md` + 사전 점검 결정사항 (B-1 ~ B-7, anon REVOKE)
> 실제 Supabase 프로젝트는 아직 없음 → **연결·적용은 하지 않았다.** 마이그레이션·코드를 준비하고 PGlite(실제 PostgreSQL 엔진)로 로컬 검증했다.
> PHASE 2-3 은 진행하지 않았다.

---

## 1. Supabase 연결

| 항목 | 결과 |
|---|---|
| 패키지 | `@supabase/supabase-js` 2.117.2, `@supabase/ssr` 0.12.7, `server-only` 설치. 검증용 dev: `@electric-sql/pglite` 0.5.8 |
| 클라이언트 | `src/lib/supabase/client.ts`(브라우저), `server.ts`(서버, 쿠키 세션), `admin.ts`(service role, `server-only`) |
| 환경변수 | `src/lib/supabase/env.ts` — 값이 없으면 `isSupabaseConfigured() = false` → 화면은 DEMO 그대로. `SUPABASE_SERVICE_ROLE_KEY` 는 `admin.ts` 에서만 읽는다 |
| 실제 프로젝트 연결 | **미연결** (프로젝트 생성 전). `.env.local` 없음, 비밀값은 코드·채팅에 기록하지 않음 |
| 데이터 계층 | `src/lib/repositories/` products · keywords · scores · watchlist · dashboard. Dashboard 페이지는 `getDashboardData()` 만 호출 (현재 항상 DEMO) |

## 2. 생성된 migration

```
supabase/migrations/
  0001_extensions_and_domains.sql   pg_trgm, DOMAIN 5개
  0002_core_tables.sql              categories, keywords, products
  0003_import_tables.sql            import_jobs, import_rows
  0004_snapshot_tables.sql          keyword_snapshots, product_snapshots, keyword_product_ranks, competitors
  0005_profit_tables.sql            profit_scenarios, profit_calculations
  0006_scoring_tables.sql           scoring_versions, opportunity_scores, product_risks
  0007_watchlist_tables.sql         watchlist, watchlist_events
  0008_sales_tables.sql             my_listings, sales_results, predictions
  0009_views.sql                    뷰 4개 + 우선순위 헬퍼 2개
  0010_functions_triggers.sql       트리거·함수
  0011_rls.sql                      RLS 정책, anon REVOKE, 실행 권한
  0012_seed_scoring_v1.sql          scoring v1
supabase/verify/phase2_verify.sql   검증 스크립트 (BEGIN … ROLLBACK, 108개 항목)
```

## 3. 생성된 테이블 — 19개 확인

categories, keywords, keyword_snapshots, products, product_snapshots, keyword_product_ranks, competitors, profit_scenarios, profit_calculations, scoring_versions, opportunity_scores, product_risks, watchlist, watchlist_events, my_listings, sales_results, predictions, import_jobs, import_rows

컬럼명·타입은 설계안 Part B 그대로다. 객체 수: 인덱스 83 · FK 54 · UNIQUE 제약 23 · CHECK 46 · RLS 정책 73.

## 4. 생성된 View — 4개 확인 (모두 `security_invoker = true`)

| 뷰 | 내용 |
|---|---|
| `v_product_latest` | 상품별 현재 값. 항목마다 `값 / _source / _confidence / _captured_on`, 판매량·매출은 `_period_days` 추가 |
| `v_keyword_latest` | 키워드별 현재 값 (같은 규칙) |
| `v_current_scores` | `is_current` + 활성 버전 점수만 |
| `v_prediction_vs_actual` | 예측 vs 실제 (판매량·매출·순이익의 예측/실제/오차/절대오차/오차율, `coverage_days`, `is_complete`) |

현재 값 우선순위: 최신 `captured_on` → confidence A > B > C → 출처 MANUAL > WING_SESSION > OFFICIAL_API > COUPANG_PAGE > EXTENSION > CALCULATED > ESTIMATED → `captured_at`, `id`. `is_excluded` 행은 제외하고, 항목별 출처는 `metric_meta`를 먼저 본다.

## 5. DOMAIN — 5개 확인

`source_type_t`(7개 값), `confidence_t`(A/B/C), `verdict_t`(3), `risk_type_t`(8), `risk_level_t`(3). 허용값은 `src/types/common.ts`와 동일하고, ENUM은 쓰지 않았다.

## 6. RLS

| 대상 | 정책 |
|---|---|
| 사용자 데이터 18개 테이블 | `authenticated` 대상 SELECT / INSERT / UPDATE / DELETE 4개씩. 조건 `owner_id = (select auth.uid())`, INSERT·UPDATE는 WITH CHECK 포함 |
| `scoring_versions` | `authenticated` SELECT만 허용. INSERT/UPDATE/DELETE 권한도 REVOKE → 변경은 마이그레이션 또는 service_role만 가능 |
| anon | 정책 없음. 모든 테이블·뷰·시퀀스·함수 권한 REVOKE. 이후 public에 만드는 객체도 기본 권한 REVOKE |
| 함수 실행 | upsert 2개, rollback_import, 우선순위 헬퍼 2개 → `authenticated`, `service_role`만 실행 가능 |
| 복합 FK (B-1) | public 테이블 간 FK 53개가 모두 `(owner_id, …_id)` 복합 FK다. 예외는 `scoring_version` 1개(전역 테이블). 다른 사용자의 행을 참조할 수 없다 |

**테스트 결과: 통과.** B01~B12(사용자 간 차단), N01~N05(anon 차단), S04~S09·S16(구조).

## 7. Trigger

| 트리거 | 대상 |
|---|---|
| `set_updated_at` (BEFORE UPDATE) | categories, keywords, products, competitors, profit_scenarios, watchlist, my_listings, sales_results — updated_at이 있는 8개 테이블 전부 |
| `log_watchlist_status_before` (BEFORE UPDATE OF status) | 상태가 바뀌면 `status_changed_at = now()` |
| `log_watchlist_status_after` (AFTER INSERT / UPDATE OF status) | `watchlist_events` 기록. 등록 시 `from_status = NULL`, 같은 상태로 UPDATE하면 기록 안 함. 메모는 `set_config('jarvis.watchlist_note', '…', true)` → `note` |

## 8. Function

| 함수 | 내용 |
|---|---|
| `rollback_import(uuid) → jsonb` | 충돌 검사 6종(UNSUPPORTED_TARGET, MISSING_PREVIOUS_VALUES, TARGET_MISSING, LATER_IMPORT, MODIFIED_AFTER_IMPORT, REFERENCED). 하나라도 있으면 아무것도 바꾸지 않고 `{"ok": false, "conflicts": [...]}`를 반환한다. 없으면 UPDATED 복원 → INSERTED를 하위→상위 순서로 삭제 → `ROLLED_BACK`. SKIPPED/FAILED는 건드리지 않고, 부분 롤백도 없다 |
| `upsert_product_snapshot(jsonb) → jsonb` | (product_id, captured_on, source_type) UPSERT. NULL은 기존 값 유지, non-null은 갱신. `{"action": INSERTED/UPDATED/SKIPPED, "row", "previous"}` 반환 → `import_rows`에 그대로 기록 가능 |
| `upsert_keyword_snapshot(jsonb) → jsonb` | 위와 같은 규칙 (keyword_id 기준) |
| `set_updated_at()`, `log_watchlist_status()` | 트리거 함수 |
| `source_priority(text)`, `confidence_rank(text)` | 뷰 정렬용 헬퍼 (IMMUTABLE) |

모든 함수는 SECURITY INVOKER이고 `search_path = ''`다.

## 9. Scoring V1

- DB seed: `0012_seed_scoring_v1.sql`, `is_active = true`
- 가중치 demand 15 · salesVolume 15 · salesGrowth 10 · competition 15 · wingEntry 10 · reviewBarrier 10 · conversion 5 · margin 15 · marketStability 5 = **100**
- 판정 80 / 60 (`>= 80` STRONG_BUY, `>= 60` REVIEW, `< 60` EXCLUDE — `verdictFromScore`와 동일)
- **TS 일치 여부: 일치.** `npm run db:verify`가 `src/config/scoring-weights.ts` 원본을 직접 import해서 가중치·라벨·판정 기준을 DB와 1:1로 비교한다
- 키 매핑: `factor_definitions.<TS 키>.column` → `demand_score`, `sales_score`, `growth_score`, `competition_score`, `wing_score`, `review_barrier_score`, `conversion_score`, `margin_score`, `stability_score`

## 10. TypeScript

| 파일 | 역할 |
|---|---|
| `src/types/database.ts` | DB 타입 (자동 생성). 테이블 19, 뷰 4, RPC 함수 5. `supabase gen types`와 같은 모양(Row/Insert/Update/Relationships) |
| `src/types/db.ts` | DB ↔ 앱 연결: 행 타입 별칭, `isSourceType` 등 타입 가드, watchlist 상태·결과 상수 |
| `src/types/common.ts` | 변경 없음 (앱 레벨 SourceType, Confidence, Verdict, RiskType 유지) |

- **공식 `supabase gen types`는 아직 실행하지 못했다** (프로젝트 없음, Docker 없음). 대신 `npm run db:types:local`이 마이그레이션을 PGlite에 적용한 뒤 카탈로그에서 같은 형식으로 생성한다.
- 생성 컬럼(`net_profit`, `net_margin_rate`)과 identity `id`는 Insert/Update에서 `never`다.
- 타입 테스트로 supabase-js 쿼리 결과 타입, 뷰 select, RPC 인자, 복합 FK 조인(embedding) 추론을 확인했다.

## 11. 테스트 결과

`npm run db:verify` → **마이그레이션 12개 적용 + TS seed 비교 + 108개 항목 전부 통과**

| 구분 | 항목 | 결과 |
|---|---|---|
| migration | 0001~0012 순서대로 적용 | 통과 |
| 구조 | S01~S21: 테이블 19, 뷰 4(security_invoker), DOMAIN 5, RLS 19, 정책, anon 권한 0, 함수 5(INVOKER), 트리거, 핵심 UNIQUE 8, NULLS NOT DISTINCT, file_hash 부분 UNIQUE, 복합 FK, 생성 컬럼, seed | 통과 |
| insert | F01~F04: category → keyword → keyword_snapshot → product → product_snapshot → profit_scenario → profit_calculation → opportunity_score → product_risk → watchlist 10단계 연결, owner_id 기본값 | 통과 |
| update / trigger | W01~W04 watchlist 이벤트·status_changed_at·note, U01 updated_at 8개 테이블 | 통과 |
| upsert / view | P01~P18: 10-06 / 10-07 두 행 저장, 최신값, confidence 우선, 출처 우선, 항목별 선택, is_excluded, metric_meta, 같은 날짜+출처 UPSERT(NULL 유지·non-null 갱신·행 수 유지), SKIPPED, 0 저장, KST 날짜, 키워드 스냅샷, 미정의 키·필수값 오류 | 통과 |
| score version | V01~V05: 현재 점수 중복 금지(NULLS NOT DISTINCT), 재계산 시 과거 보존, **v1과 v2 현재 점수 동시 존재**, v_current_scores는 활성 버전만, 일반 사용자 버전 등록 불가 | 통과 |
| CHECK / UNIQUE | C01~C12, K01~K02, G06~G07 | 통과 |
| import 중복 | I01~I04: 같은 file_hash 두 번째 성공 처리 차단, dry run 허용, 같은 idempotency_key 차단 | 통과 |
| rollback | R01~R12: 삭제 2·복원 1 성공, ROLLED_BACK, REFERENCED 충돌 시 무변경, LATER_IMPORT 충돌, 역순 롤백 후 성공, MODIFIED_AFTER_IMPORT, 재롤백 오류 | 통과 |
| 판매·예측 | G01~G08: 생성 컬럼, 비용 NULL → 순이익 NULL, 예측 vs 실제(DAY 7행 합산·오차율), period_type/출처별 분리(이중 합산 없음), 기간 밖 제외, baseline 점수 삭제 차단 | 통과 |
| RLS | B01~B12, N01~N05 | 통과 |

그 밖에 확인한 것:
- **변이 테스트:** seed 가중치 변경, 정책을 `using (true)`로 교체, 뷰 security_invoker 해제, anon 권한 복구, 이벤트 트리거 삭제 — 5개 모두 검증 스크립트가 FAIL로 잡아냈다.
- **앱 검사:** `npx tsc --noEmit`, `npm run lint`, `npm run build` 모두 통과. 10개 페이지가 정적 생성되고 Dashboard는 DEMO로 동작한다.

## 12. 문제 / 주의사항

### 12-1. 설계안 대비 구현에서 추가·확정한 것 (의미 변경 없음, 투명성 목적)

| 항목 | 내용 | 근거 |
|---|---|---|
| 복합 FK 대상 UNIQUE | 부모 테이블에 `UNIQUE (owner_id, id)` | B-1 승인 |
| 같은 상품 정합성 FK | `profit_calculations → profit_scenarios (owner_id, product_id, id)`, `product_risks → opportunity_scores (owner_id, product_id, id)`. 다른 상품의 시나리오·점수를 참조하지 못한다 | B-1 범위 (보안·정합 제약만 추가) |
| CHECK | 비율 0~1, 점수 0~100, 평점 0~5, `sales_period_days > 0`, priority 1~5, `exchange_rate > 0` | 설계 "공통 규칙" 명시값 |
| 기본값 | `products.first_seen_at / last_seen_at = now()`, `my_listings.status = 'PREPARING'`, `import_jobs.status = 'PENDING'` | NOT NULL 컬럼 편의 |
| 인덱스 | `import_rows (target_table, target_id)` | rollback 충돌 검사용 |
| `import_job_id` 의미 | "이 행을 **마지막으로 쓴** import"(수동 갱신이면 NULL) | rollback의 MODIFIED_AFTER_IMPORT 검사에 필요 |
| upsert 함수 | 반환값 `{action,row,previous}`, 정의되지 않은 키는 오류, `is_excluded`는 키가 있을 때만 변경 | B-2 구현 세부 |
| watchlist note | `set_config('jarvis.watchlist_note', …)`로 전달 | 지시 11 "note 가능 여부" |
| 뷰 헬퍼 | `source_priority`, `confidence_rank` | 뷰 정렬 규칙 구현 |

### 12-2. 발견된 문제 (변경하지 않고 보고만 함 — 결정 필요)

1. **`net_margin_rate numeric(7,4)` 범위 초과.** ±999.9999까지만 저장된다. 손실이 매출의 1,000배를 넘으면(예: 하루 매출 9,900원에 광고비 1,000만 원) `sales_results` INSERT가 실패한다. 생성 컬럼이라 앱이 값을 바꿔 넣을 수도 없다. `profit_calculations`, `predictions`의 같은 타입도 마찬가지다.
   - 권장: `numeric(12,4)`로 변경 (타입 변경이라 승인 필요).
2. **키워드 삭제 시 충돌 가능.** `opportunity_scores.keyword_id`가 `ON DELETE SET NULL`이다. 같은 상품의 종합 점수(keyword NULL)가 이미 현재 점수로 있으면, 키워드를 삭제할 때 유니크 충돌로 삭제가 실패한다.
   - 권장: 키워드는 삭제하지 않고 `is_tracking = false`로 둔다 (운영 규칙).
3. **불변성은 관례로만 지켜진다.** `scoring_versions`(릴리스 후), `opportunity_scores`(is_current 외), `predictions`의 "수정 금지"는 트리거로 강제하지 않았다. 본인 계정은 자기 점수 행을 UPDATE할 수 있다.
   - 권장: 다음 단계에서 수정 방지 트리거 추가 (설계에 없는 동작이라 승인 필요).
4. **Supabase Performance Advisor 경고 예상.** FK 54개 중 41개는 FK 컬럼 순서와 정확히 같은 인덱스가 없다. 예: 복합 FK `(owner_id, product_id)`에 대해 인덱스는 설계대로 `(product_id, …)`다. product_id가 선택도가 높아 실제 조회·CASCADE에는 문제없지만, Advisor는 "unindexed foreign key"로 표시할 수 있다.
   - 권장: 데이터가 쌓인 뒤 실제 쿼리 계획을 보고 판단.
5. **rollback이 감지하지 못하는 수정.** 스냅샷을 upsert 함수가 아닌 직접 UPDATE(예: `is_excluded`만 변경)로 바꾸면 MODIFIED_AFTER_IMPORT로 감지되지 않는다. 롤백 시 previous_values로 덮인다.
   - 규칙: 스냅샷 변경은 항상 `upsert_*_snapshot()`으로 한다.
6. **같은 날·같은 출처 UPSERT의 신뢰도.** 행의 `confidence`는 마지막 수집값으로 바뀐다. 이전 수집에서 유지된(NULL로 덮이지 않은) 항목도 새 confidence를 따르게 된다. 항목별로 정확해야 하면 `metric_meta`를 쓴다.
7. **앱이 지켜야 하는 규칙 (DB가 강제하지 않음):**
   - `normalized_keyword`는 `normalizeKeyword()`로 만든다.
   - `captured_on`과 `captured_at`의 일치는 강제하지 않는다 (날짜만 있는 CSV 대비).
   - 같은 file_hash 재업로드는 처리 전에 조회해서 경고한다 (DB는 성공 확정 시점에 차단).

### 12-3. PGlite 검증의 한계 (실제 Supabase에서 다시 확인해야 함)

| 항목 | 차이 |
|---|---|
| PostgreSQL 버전 | PGlite 18.3 / Supabase 15 또는 17. PG15 기능까지만 사용했다(`NULLS NOT DISTINCT`, `ON DELETE SET NULL (col)`, `security_invoker`, `indnullsnotdistinct`). PG16+ 전용 문법은 쓰지 않았지만 **PG15에서 실제 실행은 하지 않았다** |
| auth | `auth.users(id, email)`와 `auth.uid()`만 흉내 냈다. 실제 auth.users는 컬럼이 더 많다(검증 스크립트의 INSERT는 id·email만 사용) |
| 역할·권한 | anon/authenticated/service_role과 public 기본 권한을 Supabase와 같게 구성했다. 실제에는 supabase_admin 등 다른 역할과 기존 기본 권한이 있다 |
| PostgREST | **미검증.** supabase-js 쿼리, RPC(jsonb 인자), 뷰 노출, 스키마 캐시, 복합 FK embedding 실동작. 타입 추론만 확인했다 |
| SQL Editor | `BEGIN … ROLLBACK` 스크립트가 SQL Editor에서 한 세션으로 실행되는지, `set local role`, `pg_temp` 헬퍼 실행이 되는지 미검증 |
| 동시성 | 동시 UPSERT·롤백 경합은 단일 세션 PGlite에서 재현할 수 없다 |
| 타입 생성 | 공식 `supabase gen types` 결과와 세부 표기(`__InternalSupabase`, Constants 등)는 다를 수 있다. 연결 후 교체 필요 |

## 13. 실제 Supabase 적용 전에 해야 할 작업 (직접)

1. **프로젝트 생성:** supabase.com → New project. Region은 Seoul(ap-northeast-2) 권장. DB 비밀번호는 비밀번호 관리자에 보관.
2. **가입 차단:** Authentication → Sign In / Providers → "Allow new users to sign up" 끄기. 본인 계정은 Authentication → Users → Add user로 1개 생성.
3. **`.env.local` 작성:** `.env.example`을 복사해 Project Settings → API의 값 입력.
   - 새 키 체계: publishable 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, secret 키 → `SUPABASE_SERVICE_ROLE_KEY`. legacy anon/service_role 키도 동작한다.
   - 채팅·커밋에 쓰지 않는다 (`.gitignore`에 `.env*` 포함).
4. **마이그레이션 적용** (터미널에서 직접. 비밀번호 입력 단계가 있음):
   ```bash
   npx supabase login
   npx supabase init
   npx supabase link --project-ref <프로젝트 ref>
   npx supabase db push
   ```
   `init`은 `supabase/config.toml`만 만든다(기존 migrations 유지). 질문에는 모두 N으로 답하면 된다. `db push` 전에 적용될 0001~0012 목록을 확인한다.
5. **운영 DB 검증:** SQL Editor에 `supabase/verify/phase2_verify.sql` 전체를 붙여넣고 실행한다. 결과가 `passed = 108`이어야 하고, ROLLBACK으로 끝나서 테스트 데이터는 남지 않는다.
6. **공식 타입 생성:** `npm run db:types` → `npm run build`로 확인.
7. **Advisors 확인:** Database → Advisors (Security / Performance). 12-2-4의 경고는 예상된 것이다.

## 14. 다음 단계 제안 (진행하지 않음)

- **PHASE 2-3 (권장):** 위 13번 작업 후 실제 연결 검증.
  - 운영 DB에서 verify 108 통과, 공식 타입 교체
  - 본인 계정 로그인만 있는 최소 인증 (가입 UI 없음, `proxy`에서 세션 갱신)
  - 로그인 상태에서 repository 1개(예: `listCurrentScores`)로 RLS가 적용된 실제 조회 확인
  - 12-2의 1·3번 결정 반영 여부 확정
- **그다음 PHASE 3:** 키워드 데이터 구조. 키워드 등록·정규화, `upsert_keyword_snapshot` 기반 입력, `v_keyword_latest` 화면 연결.

---

## 15. 운영 DB 적용 기록 (2026-10-07)

| 항목 | 결과 |
|---|---|
| 프로젝트 | JARVIS (`ogfldnhumdqawcbunehl`), 서울 리전, PostgreSQL 17.11 |
| 적용 방법 | Supabase 커넥터 `apply_migration`으로 12개를 순서대로 적용, 모두 성공 |
| 파일 이름 | 로컬 `0001_…` ~ `0012_…`를 Supabase에 기록된 버전 번호로 변경. 예: `20261007003705_extensions_and_domains.sql`. 이후 `supabase db push` / `migration list`와 일치 |
| 스키마 일치 | `scripts/db/fingerprint.sql`로 로컬(PGlite)과 운영 DB를 비교: 함수 7 · 뷰 4 · 컬럼 313 · 제약 137 · 정책 73 · 트리거 10 · 코멘트 51 · DOMAIN 5 · seed **완전 일치**. 인덱스 83개 중 1개는 표기만 다름(운영 DB가 `extensions.gin_trgm_ops`를 `gin_trgm_ops`로 표시) |
| 운영 DB 검증 | `phase2_verify.sql` **108개 전부 통과** (12-3의 "SQL Editor 미검증" 항목 해소). 실행 후 auth.users 0명, 사용자 데이터 0행, scoring_versions는 `v1`만 남음 → 테스트 흔적 없음 |
| Security Advisor | **경고 0건** |
| Performance Advisor | `unindexed_foreign_keys` 41건(12-2-4에서 예상), `unused_index` 18건(데이터가 없어서 생기는 정상 결과) |
| TypeScript | `src/types/database.ts`를 Supabase 공식 생성 타입으로 교체(PostgREST 14.18). tsc · lint · build 통과 |

공식 타입과 로컬 생성기의 차이: 공식 타입은 생성 컬럼(`sales_results.net_profit`, `net_margin_rate`)을 Insert에서 `never`로 막지 않는다. 그래도 DB가 직접 거부하므로 값이 잘못 들어가지는 않는다.

남은 작업 (직접):
1. Authentication → "Allow new users to sign up" 끄기, 본인 계정 1개 생성
2. `.env.local` 작성: URL, publishable(anon) 키, secret(service role) 키
