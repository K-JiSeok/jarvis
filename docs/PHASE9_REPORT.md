# JARVIS PHASE 9 — CSV / Excel Import · 완료 보고서

작성일: 2026-10-08 · 저장소: `K-JiSeok/jarvis` (main)

---

## 1. 구현 요약

`/import` 를 실제 기능으로 바꿨다. 흐름:

```text
파일 선택 (유형 + .csv/.xlsx)
  → 파일 분석 (서버: 형식 판별 · 인코딩 · 표 추출 · 컬럼 자동 매칭 · 같은 파일 이력 확인)
  → 컬럼 매핑 (자동 결과 확인 · 수동 변경 · 뜻이 둘인 컬럼은 직접 선택 · 비율 단위 · 출처 · 신뢰도 · 판매량 기간)
  → 검증 · 미리 보기 (행별 정상 / 주의 / 오류 / 중복, 변환된 값, 미등록 상품·키워드)
  → 가져오기 실행 (import_jobs 생성 → 행마다 기존 저장 경로 → import_rows 기록 → 결과)
  → 이력 · 행별 결과 · 되돌리기
```

구조 (공통 입력 계층):

```text
파일 ─ parse-file.ts (서버) ─▶ ParsedTable ─ core.ts (순수) ─▶ 매핑 · 변환 · 검증 ─▶ NormalizedRecord
                                                                                    │
            imports.ts (repository) ◀───────────────────────────────────────────────┘
              ├ upsert_product_snapshot() / upsert_keyword_snapshot()  (기존 RPC)
              ├ keyword_product_ranks 자연키 UPSERT
              └ import_jobs / import_rows
```

`NormalizedRecord` (상품 스냅샷 · 키워드 스냅샷 · 키워드 순위)는 파일 형식과 무관하다. 이후 확장 프로그램도 같은 레코드를 만들어 같은 저장 경로를 쓰면 된다.

---

## 2. 지원 파일 형식

| 형식 | 처리 |
|---|---|
| `.csv` (`.txt`) | UTF-8(BOM 포함) 우선, UTF-8 이 아니면 EUC-KR(엑셀 한글 CSV 기본)로 해석. 구분자 `,` · 탭 · `;` 자동. RFC 4180 따옴표 처리 (쉼표·줄바꿈·`""`) — 직접 구현 (라이브러리 없음) |
| `.xlsx` | `read-excel-file` 9.3.12 (신규 의존성), 첫 번째 시트. 날짜 서식 셀 → 날짜, 수식은 실행하지 않고 저장된 결과 값만 |
| `.xls` | **지원하지 않음** — 구형 바이너리. 안내 문구로 .xlsx/.csv 저장을 요청 |

- 파일 판별: 확장자 + 시그니처 (xlsx = ZIP `PK..`, xls = OLE `D0 CF 11 E0`, CSV 에 NUL 바이트·ZIP 이면 거부).
- 제한: **파일 10MB**, **데이터 2,000행** (행마다 저장 요청을 보내므로). 클라이언트와 서버 둘 다 검사한다.
- Next.js 설정: Server Function 요청 본문 한도 `11mb`, proxy 버퍼 한도 `11mb` (`next.config.ts`).
- 라이브러리 선택: npm 의 `xlsx`(SheetJS 0.18.5)는 알려진 보안 취약점이 수정되지 않은 상태라 제외했다. `read-excel-file` 은 의존성이 적고(fflate·saxen 등 4개) `npm audit` 0건이다.

---

## 3. 지원 Import 유형

기존 `import_jobs.import_type` CHECK 값을 그대로 썼다 (새 값을 추가하지 않음).

| 화면 | 내부 (`import_type`) | 지시서 이름 | 저장 대상 | 필수 |
|---|---|---|---|---|
| 상품 데이터 | `PRODUCT_SNAPSHOTS` | PRODUCT_SNAPSHOT | `product_snapshots` | 쿠팡 상품 ID, 수집일 |
| 키워드 데이터 | `KEYWORD_METRICS` | KEYWORD_SNAPSHOT | `keyword_snapshots` | 키워드, 수집일 |
| 키워드 순위 데이터 | `SEARCH_RANKS` | KEYWORD_PRODUCT_RANK | `keyword_product_ranks` | 키워드, 쿠팡 상품 ID, 수집일, 순위 |

필드:
- **상품:** 관측 상품명, 판매가, 정가, 할인율, 리뷰 수, 평점, 카테고리 순위, 실제 판매량, 추정 판매량, 판매량 집계 기간, 실제 매출, 추정 매출, 전환율, 28일 조회수, 배송 유형, 판매자 유형
- **키워드:** 월 검색량, 이전 검색량, 검색량 증감률, 쿠팡 상품 수, 경쟁강도, WING 비율, 로켓 비율, 브랜드 집중도, 평균 가격, 평균 리뷰 수, 광고 입찰가
- **순위:** 순위, 광고 여부, 페이지

상품·키워드는 **이미 등록된 것만** 쓴다. 자동 생성하지 않는다.

---

## 4. 컬럼 자동 매칭

헤더를 정규화한다 (소문자, 공백·밑줄·하이픈·괄호·점·슬래시·콜론 제거). 정확히 일치하는 별칭이면 자동 지정하고, 뜻이 둘 이상이면 후보만 보여 준다.

| 필드 | 자동 매칭 별칭 (정규화 후) |
|---|---|
| 쿠팡 상품 ID | coupangproductid, productid, 상품id, 상품아이디, 쿠팡상품id, 쿠팡상품아이디, 쿠팡상품번호, 상품번호 |
| 수집일 | capturedon, date, 날짜, 수집일, 수집일자, 기준일, 기준일자, 조회일, 일자 |
| 키워드 | keyword, 키워드, 검색어, 검색키워드 |
| 판매가 | price, 판매가, 판매가격, 가격, 현재가, 할인가 |
| 정가 | originalprice, 정가, 원가격, 할인전가격 |
| 리뷰 수 | reviewcount, 리뷰수, 리뷰, 상품평수, 리뷰개수 |
| 실제 / 추정 판매량 | salesactual·실제판매량·실판매량 / salesestimated·추정판매량·예상판매량 |
| 28일 조회수 | views28d, 28일조회수, 조회수28일, viewcount28d |
| 전환율 | conversionrate, 전환율, 구매전환율 |
| 순위 | rank, rankposition, 순위, 노출순위, 검색순위, 랭킹 |
| (그 밖) | `src/lib/import/core.ts` `FIELDS` 에 필드별 별칭 전체 |

**자동으로 정하지 않는 것 (후보만, 사용자가 선택):**
- `판매량 · 월판매량 · 28일판매량 · 30일판매량 · sales · 판매수량` → 실제 판매량 / 추정 판매량
- `매출 · 월매출 · 28일매출 · revenue · 매출액` → 실제 매출 / 추정 매출
- `조회수 · viewcount · views · 상품조회수` → 28일 조회수 (기간이 28일인지 알 수 없어서)

예측 판매량 필드는 아예 없다 (가져오지 않는다). 같은 필드에 두 열이 맞으면 앞 열만 자동 지정한다. 매칭되지 않는 열은 "사용 안 함"이다. 모든 자동 결과는 매핑 표에서 바꿀 수 있다.

---

## 5. 데이터 검증

**전체 차단 (가져오기 불가):** 필수 컬럼 미연결, 한 필드에 두 열 연결, 판매량·매출 열이 있는데 기간 열도 기간 입력도 없음, 출처·신뢰도 미선택, 파일 형식·크기·행 수 오류.

**행 단위:**

| 상태 | 조건 | 저장 |
|---|---|---|
| 정상 | 문제 없음 | 저장 |
| 주의 | 선택 항목 값이 잘못됨 (숫자 아님, 정수 아님, 범위 밖, 알 수 없는 배송·판매자 유형 등) → 그 칸만 NULL | 나머지 저장 |
| 오류 | 필수값 없음·잘못됨, 잘못된 날짜, 미래 날짜(KST), 등록되지 않은 상품·키워드, 가져올 지표 값이 하나도 없음 | 저장 안 함 (실패 기록) |
| 중복 | 같은 파일 안에서 같은 대상·수집일·출처(순위는 + 광고 여부) | 첫 행만 사용, 나머지 건너뜀 |

**값 변환:**
- **숫자:** `12,500` · `12500원` · `12,500원` · `₩` · `개`·`건`·`회`·`위` 제거, `+3`, `1e3`. 숫자가 아니면 문제로 표시.
- **NULL / 0:** 빈 칸, `-`, `N/A`, `null`, `없음`, `모름` = NULL. `0`, `0%` = 실제 0.
- **날짜:** `2026-10-08`, `2026/10/08`, `2026.10.08(.)`, `20261008`, 시각 `HH:mm(:ss)` 포함 형식. 시각이 있으면 `captured_at` 에 KST 로 넣고, 없으면 그 날짜 00:00 KST. 없는 날짜(2/30, 25시)는 오류.
- **비율** (전환율, 할인율, WING·로켓 비율, 브랜드 집중도: 0~1 / 검색량 증감률: 음수·1 초과 허용): `%` 가 붙으면 항상 ÷100. % 없는 숫자는 열마다 고른 단위대로 읽는다 (퍼센트 `15.5` = 15.5% / 소수 `0.155` = 15.5%). 단위 기본값은 % 없는 값 중 1 을 넘는 값이 있으면 퍼센트, 아니면 소수이고, 화면에서 바꿀 수 있다. 0~1 칸이 범위를 벗어나면 주의(NULL).
- **경쟁강도**(상품수÷검색량)는 비율이 아닌 소수다.
- **광고 여부:** 광고/AD/Y/1/true/O → 광고, 자연/일반/N/0/false/X → 자연, 빈 칸 → 자연 (DB 기본값 false 와 같음).
- **상품 ID:** 숫자만, 쿠팡 URL(`/products/123`)에서 추출, 엑셀 `.0` 제거.
- **배송·판매자 유형:** 한글(로켓배송, 로켓그로스, 판매자배송, 해외배송, 쿠팡 직매입, WING …) 또는 DB 코드.
- **파생 값** (수동 입력 화면과 같은 규칙, `metric_meta` 에 CALCULATED 표시): 할인율 = 1 − 판매가 ÷ 정가 (판매가 ≤ 정가, 할인율 열이 없을 때), 경쟁강도 = 상품수 ÷ 검색량, 증감률 = (검색량 − 이전 검색량) ÷ 이전 검색량.

---

## 6. Preview

- 개수: 총 행 / 정상 / 주의(일부 값 비움) / 오류(저장 안 함) / 파일 내 중복(건너뜀).
- 미등록 상품·키워드 목록과 등록 화면 링크 ("자동으로 만들지 않습니다").
- 행 표: 행 번호(원본 파일 기준), 상태, 연결한 필드의 **변환 결과**(예: `4.1%`, `17.43% (계산)`, `28 (입력값)`, `ROCKET_GROWTH`), 메시지. 문제 있는 행부터 최대 300행.
- 같은 파일을 이미 가져왔으면 경고하고 실행 버튼을 막는다.

---

## 7. Import 실행

- 실행 버튼은 처리 중 비활성화하고, 중복 클릭을 막는 잠금을 둔다 (두 번 클릭 → job 1개 확인).
- 서버는 파일을 **다시 받아 다시 검증**한다 (미리 보기 결과를 믿지 않음).
- 저장할 수 있는 행이 0개면 확인 후 실패 기록만 남긴다 (job `FAILED`).
- 행마다 저장 경로를 호출한다 (동시 5개). 행 하나의 실패가 다른 행을 막지 않는다.
- 상품 데이터면 `products.last_seen_at` 을 가져온 데이터 중 더 최신 시각으로만 갱신한다 (과거로 되돌리지 않음).
- 완료 화면: 성공(추가·갱신) / 건너뜀 / 실패 수, 실패 사유 요약, 결과 상세 링크, "점수는 상품 상세에서 다시 계산" 안내.
- Opportunity Score 는 자동으로 다시 계산하지 않는다.

---

## 8. import_jobs / import_rows 사용 방식

기존 컬럼을 그대로 썼다.

**import_jobs**

| 컬럼 | 값 |
|---|---|
| owner_id | auth.uid() 기본값 (RLS) |
| channel | `FILE` |
| import_type | `PRODUCT_SNAPSHOTS` / `KEYWORD_METRICS` / `SEARCH_RANKS` |
| source_type | 선택한 출처 |
| file_name · file_size_bytes · file_hash | 원본 이름 · 크기 · SHA-256 |
| schema_version | `import-v1` |
| column_mapping | `{columns: {원본 헤더: 필드}, options: {confidence, sales_period_days, ratio_units}, file: {format, encoding}}` |
| status | `PROCESSING` → `SUCCEEDED`(실패 0) / `PARTIAL`(일부 저장 + 일부 실패) / `FAILED`(저장 0 + 실패) / `ROLLED_BACK` |
| total_rows · inserted_rows · updated_rows · skipped_rows · failed_rows | 지시서의 success_rows = inserted + updated |
| error_summary | 실패 코드별 개수 (예: `PRODUCT_NOT_FOUND 1, INVALID 1`) |
| started_at · finished_at · created_at | 지시서의 completed_at = finished_at |

**import_rows**

| 컬럼 | 값 |
|---|---|
| row_number | 원본 파일 행 번호 (헤더 = 1행) |
| record_key | 자연키, 예: `product_snapshot:9900000601:2026-10-07:WING_SESSION` |
| payload | `{raw: 원본 셀, converted: 변환 결과, messages, status}` |
| result | `INSERTED` / `UPDATED` / `SKIPPED` / `FAILED` |
| target_table · target_id | 저장된 행 (`product_snapshots` · `keyword_snapshots` · `keyword_product_ranks`) |
| previous_values | UPDATED 일 때 변경 전 행 전체 (되돌리기 복원용) |
| error_code · error_message | `REQUIRED` · `INVALID` · `PRODUCT_NOT_FOUND` · `KEYWORD_NOT_FOUND` · `FUTURE_DATE` · `NO_VALUES` · `DUPLICATE_IN_FILE` · `FORBIDDEN` · `NOT_FOUND` · `OUT_OF_RANGE` + 문구 |

---

## 9. Snapshot 저장 방식

- **상품 · 키워드 스냅샷:** 기존 `upsert_product_snapshot()` / `upsert_keyword_snapshot()` 을 그대로 호출한다 (`import_job_id` 포함).
  - 자연키 (대상, 수집일, 출처) UPSERT
  - 파일에 없는 값(NULL)은 넣지 않으므로 기존 값을 보존한다 (NULL 보존)
  - 다른 사용자 행은 42501
  - 반환된 action / previous 를 import_rows 에 기록한다
- **키워드 순위:** 자연키 (키워드, 상품, 수집일, 출처, 광고 여부)로 기존 행을 찾는다.
  - 순위·페이지·신뢰도가 같으면 SKIPPED
  - 다르면 UPDATED (이전 행 전체를 previous_values 로)
  - 없으면 INSERTED
  - `import_job_id` 를 기록한다. 지금 순위 UPSERT 와 같은 키 정책이다.
  - MANUAL 순위만 화면에서 삭제할 수 있는 기존 규칙은 그대로다 (가져온 순위는 "되돌리기"로만 지운다).
- **되돌리기 (추가 기능):** 이력 상세의 "가져오기 되돌리기"가 기존 `rollback_import()` 를 호출한다.
  - 추가된 행은 삭제하고, 갱신된 행은 previous_values 로 복원한다
  - 이후 다른 수정이 있으면 아무것도 바꾸지 않고 충돌을 알린다
  - DB 함수는 PHASE 2 에 이미 있었고, 이번에 화면만 연결했다

---

## 10. Source / Confidence 처리

- **출처 선택지:** MANUAL(기본) · EXTENSION · COUPANG_PAGE · WING_SESSION. CALCULATED · ESTIMATED · OFFICIAL_API 는 선택지에서 뺐고, 서버도 이 4개 외에는 거부한다.
- **신뢰도:** A(직접 확인) · B(기본) · C(참고용 추정).
- 모든 행에 그대로 저장된다: `source_type`, `confidence`, `captured_on`, `captured_at`.
- 파생 값만 `metric_meta.{필드} = {source: CALCULATED, confidence}`.
- import 자체는 출처가 아니다. "파일 데이터가 어디서 왔는지"를 출처로 기록한다 (예: WING 에서 받은 파일 → WING_SESSION).

---

## 11. 중복 / idempotency 처리

1. **같은 파일 (SHA-256 + 유형):** 이미 SUCCEEDED·PARTIAL 이거나 최근 15분 안에 PROCESSING 이면 분석·미리 보기에서 경고하고 실행을 막는다. 서버도 실행 직전에 다시 확인하고, DB 부분 UNIQUE(`import_jobs_file_hash_succeeded_key`)가 최종 방어선이다.
2. **다시 가져오기:** DB UNIQUE 때문에 같은 파일을 두 번 "완료" 처리할 수 없다. 이전 가져오기를 **되돌린 뒤** 다시 올리면 된다. 실패(FAILED)한 파일은 바로 다시 올릴 수 있다 (상품 등록 후 재업로드 → PARTIAL 확인).
3. **파일 안 중복 행:** 첫 행만 사용한다.
4. **다른 파일, 같은 데이터:** 스냅샷·순위 자연키 UPSERT 로 행이 늘지 않는다 (같은 값이면 SKIPPED, 다르면 갱신).
5. **실행 버튼 중복 클릭:** 클라이언트 잠금 + 서버 중복 확인.

---

## 12. 오류 처리

| 수준 | 처리 |
|---|---|
| 파일 (형식·크기·빈 파일·헤더만·행 수·손상된 xlsx) | 분석 단계에서 안내, job 만들지 않음 |
| 매핑 (필수·중복 연결·기간) | 미리 보기에 문제 목록, 실행 버튼 없음 |
| 행 (검증 오류) | import_rows FAILED + 사유, 나머지 행은 계속 |
| 행 (저장 오류: 권한·FK·범위) | FAILED + 코드 (FORBIDDEN / NOT_FOUND / OUT_OF_RANGE) |
| import_rows 기록 자체 실패 | job FAILED + error_summary, 오류 반환 |
| 같은 파일 동시 실행 | 23505 → "동시에 두 번 실행됨" |

실패 행은 이력 상세에서 행 번호·원본 값·사유로 확인할 수 있다. 파일을 고친 뒤 다시 올리면 된다.

---

## 13. UI 변경

`/import` (기존 placeholder 페이지를 교체, 새 페이지 없음):
- **파일 가져오기 카드:**
  1. 단계 표시 (파일 선택 → 컬럼 매핑 → 검증·미리 보기 → 완료)
  2. 유형 3개 선택
  3. 파일 선택 ("파일 없음" 상태 표시)
  4. 매핑 표 (원본 컬럼 · 값 예시 · 필드 선택 · 비율 단위 · 상태 ✓ 자동 / 선택 / 선택 필요 / 사용 안 함)
  5. 출처 · 신뢰도 · 판매량 기간
  6. 미리 보기
  7. 실행 ("가져오는 중… (창을 닫지 마세요)")
  8. 결과 (완료 / 부분 성공 / 실패)
- **가져오기 결과 상세 카드** (`?job=`): 요약, 행별 결과 (실패 → 건너뜀 → 갱신 → 추가 순), 되돌리기 버튼
- **가져오기 이력 카드:** 파일명 · 유형 · 출처·신뢰도 · 상태 · 총 행 · 성공 · 건너뜀 · 실패 · 등록일 (최근 30건)
- **화면 상태:** 파일 없음 / 파일 선택 / 파일 분석 중 / 컬럼 매핑 / 검증 중 / 미리 보기 / 가져오는 중 / 완료 / 부분 성공 / 실패
- **보안 표시:** 원본 값은 React 텍스트로만 출력한다 (HTML 해석 없음). `=` `+` `-` `@` 로 시작하는 수식형 값은 앞에 `'` 를 붙여 데이터임을 보여 준다. JARVIS 는 CSV/Excel 파일을 새로 만들지 않으므로 수식이 다시 실행될 출력 경로가 없다.

---

## 14. DB Migration

```text
DB 변경 없음
```

기존 `import_jobs` · `import_rows` · `upsert_*_snapshot()` · `rollback_import()` · `keyword_product_ranks` 를 그대로 사용했다. migration·테이블·컬럼·인덱스·RLS 변경 없음.

DB 이외 설정 변경: `next.config.ts` (Server Function 본문 한도 11mb, proxy 버퍼 한도 11mb), 의존성 `read-excel-file@9.3.12` 추가.

---

## 15. RLS 테스트

- **원격 Supabase (가짜 사용자 B, 롤백) 12/12:**
  - B 조회 0건 6종: import_jobs, import_rows, products, product_snapshots, keyword_snapshots, keyword_product_ranks
  - B 의 수정·삭제 0행 3종: A job 수정, rows 삭제, 스냅샷 수정
  - B 의 A job 되돌리기 → P0002 (보이지 않음)
  - B 가 A job 에 행 추가 → 23503
  - anon 의 import_jobs 조회 → 42501
- **PGlite IM08~IM11:** B → A job 행 기록 23503, 되돌리기 P0002, A 의 jobs·rows 조회 0, A job 수정 0행.
- 모든 저장은 로그인 세션 `createClient()` (RLS)를 쓴다. service role 은 사용하지 않는다. 파일 업로드 Server Function 은 모두 로그인 확인 후 동작한다.

---

## 16. 테스트 결과

```text
Import tests (npm run test:import):       36/36
  CSV tests:                                6/6
  XLSX tests:                               3/3
  Mapping tests:                            6/6
  Value tests:                             10/10
  Validation tests:                         4/4
  Snapshot tests:                           7/7
DB tests (npm run db:verify, PGlite):     187/187   (기존 176 + IM 11)
  └ Import 저장·되돌리기·RLS (IM01~11):     11/11
RLS tests (원격 Supabase, 롤백):            12/12
UI tests (로그인 세션, [TEST] 데이터):       15/15
  └ 잘못된 파일:                             7/7
Dashboard regression:                      12/12
Score regression:                          22/22
Profit regression:                         20/20
Typecheck:                                 PASS
Lint:                                      PASS
Build:                                     PASS
npm audit (production):                    0 vulnerabilities
```

**PGlite IM 11개:**
1. 가져온 스냅샷 INSERTED, 출처·신뢰도·수집일·실제 0·import_job_id 보존
2. 재가져오기 UPDATED, 파일에 없는 값 보존, previous 반환
3. 행 결과·실패 사유·원본 기록
4. PARTIAL 파일도 같은 해시 재완료 차단
5. 유형이 다르면 같은 해시 허용
6. 되돌리기 시 순위 이전 값 복원, 새 행 삭제, ROLLED_BACK
7. 되돌린 뒤 같은 파일 재가져오기 허용
8. ~ 11. RLS 4종

**UI 15개** (실제 로그인 세션):
1. 상품 CSV 분석: 9개 열 자동 매칭, "판매량"은 선택 필요, 수식형 셀 `'=HYPERLINK` 표시
2. 수동 매핑 (판매량 → 추정 판매량), 기간 28일 입력, 출처 WING_SESSION, 신뢰도 A
3. 미리 보기: 총 7 / 정상 3 / 주의 1 / 오류 2 / 중복 1. 미등록 상품 안내, 잘못된 날짜, 숫자 아님, 알 수 없는 배송 유형, 할인율 `17.43% (계산)`, 기간 `28 (입력값)`
4. 실행 → 부분 성공 (추가 4 · 건너뜀 1 · 실패 2). 실행 버튼 두 번 클릭 → job 1개
5. DB 값 확인: WING_SESSION·A, `14:30` → captured_at 05:30Z(KST 14:30), 날짜만 → 00:00 KST, 할인율 metric_meta CALCULATED, 리뷰 0 = 0, 없는 값 NULL, last_seen_at 과거로 안 바뀜
6. 상품 상세 점수 미리 보기: 시장 안정성 "가격 기록 1회 → 3회, 5/5", 판매량·전환율 계산 시작. 판매 성장률은 간격 3일이라 미계산 유지
7. 같은 파일 재업로드 → 경고, 실행 버튼 비활성
8. XLSX 키워드 파일: 엑셀 날짜 → 2026-10-07, `45%`·`0.5` 비율 변환, 경쟁강도 2.5 계산, 미등록 키워드 1 → 부분 성공. DB: EXTENSION·C·metric_meta 확인
9. 순위 CSV 1차: 자연 5위 · 광고 1위 · `12위` → 추가 3
10. 순위 CSV 2차 (다른 파일, 같은 키): 5→4 갱신 1, 같은 값 건너뜀 1
11. 이력 표 (4건) + 결과 상세 (행별 원본·결과)
12. 되돌리기 → 순위 4 → 5 복원, import_job_id 원래 값, 상태 "되돌림"
13. 잘못된 파일 7종: 빈 파일 · 헤더만 · .xls · .pdf · 가짜 .xlsx · 10MB 초과(클라이언트) · 10.5MB(서버 검사, 클라이언트 검사를 잠시 끄고 확인 후 원복)
14. 잘못된 컬럼 (매칭 0개) → 필수 컬럼 2개 연결 요청, 실행 버튼 없음
15. 전체 실패 파일 → 확인창 → job 실패 기록. 상품 1개 등록 후 같은 파일 재업로드 → 부분 성공 (FAILED 는 재업로드 허용)

테스트 데이터 ([TEST] 키워드 1, 상품 3, 스냅샷 6, 순위 3, 키워드 스냅샷 1, import job 6)는 모두 삭제했다. 운영 DB 에는 실제 키워드 2개와 그 스냅샷 1건만 남아 있다 (import_jobs · import_rows 0건).

---

## 17. Regression

| 페이지 | 결과 |
|---|---|
| `/` | 200 (가져온 데이터가 데이터 상태·최신 수집일에 반영됨) |
| `/keywords`, `/keywords/[id]` | 200 |
| `/products`, `/products/[id]` | 200 |
| `/competitors` | 200 |
| `/profit` | 200 |
| `/categories` | 200 |
| `/watchlist` | 200 |
| `/import`, `/import?job=` | 200 |
| `/settings` | 200 |

PHASE 1~8 PGlite 176개, Dashboard 12, Score 22, Profit 20 모두 통과.

---

## 18. 발견된 문제

1. **행마다 저장 요청을 보낸다** (RPC 1회 + import_rows 일괄 기록). 그래서 2,000행 제한을 뒀다. 큰 파일은 수십 초~수 분 걸릴 수 있고 진행률 표시가 없다. 배포 환경(서버 함수 실행 시간 제한)에서는 문제가 될 수 있다. 개선하려면 DB 일괄 함수(migration)나 백그라운드 처리가 필요하다.
2. **트랜잭션이 아니다.** 행 단위 저장이라 중간에 서버가 멈추면 일부만 저장되고, job 이 `PROCESSING` 으로 남는다. 15분 뒤에는 같은 파일을 다시 올릴 수 있지만 그 job 은 이력에 처리 중으로 남는다. 저장된 부분은 import_rows 기록이 없을 수 있어 되돌리기로 정리되지 않는다.
3. **키워드 순위 UPSERT 는 앱에서 조회 → 갱신/추가 두 단계다.** 같은 키를 동시에 가져오면 한쪽이 UNIQUE 위반으로 실패(FAILED)할 수 있다.
4. **같은 파일 "다시 가져오기"는 되돌린 뒤에만** 가능하다 (DB 부분 UNIQUE). 되돌리지 않고 강제로 다시 가져오는 버튼은 없다.
5. **비율 단위 기본값은 추정이다** (% 없는 숫자 중 1 초과 값이 있으면 퍼센트). 화면에서 보이고 바꿀 수 있지만, 모든 값이 1 이하인 퍼센트 열(예: `0.5` = 0.5%)은 소수로 잘못 읽힐 수 있다. 미리 보기의 변환 결과로 확인해야 한다.
6. `.xls` 미지원, `.xlsx` 는 첫 시트만. 인코딩은 UTF-8 / EUC-KR 만 지원한다.
7. 엑셀에서 숫자 서식으로 저장된 15자리 넘는 ID 는 정밀도가 깨질 수 있다 (쿠팡 상품 ID 는 보통 10~11자리라 안전). 텍스트 서식을 권장한다.
8. 조회수는 `views_28d` 컬럼뿐이라 28일이 아닌 기간의 조회수는 가져올 수 없다 (자동 매칭도 하지 않음).
9. 광고 여부 칸이 비어 있으면 "자연 노출"로 본다 (DB 기본값과 같은 가정).
10. "새 파일 가져오기"를 눌러도 출처·신뢰도 선택은 유지된다. 연속 작업에는 편하지만, 다른 성격의 파일에 이전 선택이 따라갈 수 있다 (테스트에서 순위 파일이 이전 키워드 파일의 신뢰도 C 를 이어받음).
11. 단계마다 파일을 서버로 다시 보낸다 (분석·미리 보기·실행 3회, 최대 10MB × 3).
12. 이력 상세는 최대 500행까지만 보여 준다.
13. 되돌리기 기능은 지시서에 없던 추가 기능이다 (기존 DB 함수 연결만, DB 변경 없음).
14. 이번 PHASE 시작 시 dev 서버가 PHASE 8 빌드 중에 비정상 종료(exit 134)되어 있었다. 이번 빌드 전에는 dev 서버를 멈추고 실행했다.

---

## 19. 설계 변경 여부

```text
기존 설계 변경 없음
```

- Opportunity Score V1 가중치·판정 기준, SourceType, Confidence, captured_on, 스냅샷 구조·NULL 보존·자연키, 실제/추정/예측 판매량 분리, RLS 를 바꾸지 않았다. DB 변경 없음.
- 기존 `import_type` 이름(`PRODUCT_SNAPSHOTS` / `KEYWORD_METRICS` / `SEARCH_RANKS`)을 그대로 썼다 (지시서의 예시 이름과 다름).
- 설정·의존성 추가: `next.config.ts` 본문 한도, `read-excel-file`.

---

## 20. PHASE 10 영향 (실제 쿠팡 데이터 수집)

- **재사용할 경계는 `NormalizedRecord`** (`NormalizedProductSnapshot` / `NormalizedKeywordSnapshot` / `NormalizedRank`, `src/lib/import/core.ts`) **와 `runImport()`** (`src/lib/repositories/imports.ts`) 이다. 수집기는 파일 파싱·컬럼 매핑을 건너뛰고 이 레코드를 바로 만들면 된다.
  - 출처 `EXTENSION` / `COUPANG_PAGE` / `WING_SESSION`
  - 신뢰도
  - 수집일·시각
  - DB 컬럼명 기준 metrics
- **import_jobs 를 그대로 쓴다:** `channel = 'EXTENSION'` 이 이미 허용되어 있고, `idempotency_key` UNIQUE 로 배치 재전송을 막을 수 있다 (이번에는 쓰지 않음). 행 기록·되돌리기·이력 화면도 그대로 쓸 수 있다.
- **상품·키워드 자동 생성:** 지금은 미등록이면 오류다 (`Lookups` 에 없으면 PRODUCT_NOT_FOUND). 수집기에서 자동 생성이 필요하면 `prepareRows` 의 미등록 처리를 옵션으로 바꾸고, 생성한 상품을 import_rows(target_table `products`)에 남기면 된다. rollback_import 는 products 삭제를 이미 지원한다.
- **값 변환 규칙 재사용:** 숫자·날짜·비율·배송/판매자 유형 변환(`convertCell`)은 페이지에서 읽은 텍스트에도 그대로 쓸 수 있다.
- **같이 해결해야 할 것:** 18절 1~3번 (행 단위 저장 속도, 트랜잭션, 순위 UPSERT 원자성). 자동 수집은 빈도가 높아 DB 일괄 저장 함수(migration)를 먼저 검토하는 게 좋다.
- 자동 점수 재계산은 여전히 없다. 수집 후 점수 갱신 방식(수동 / 배치)을 정해야 한다.
