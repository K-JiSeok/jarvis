# JARVIS PHASE 27 — 검색 결과 자동 수집 (확장 프로그램) · 매일 추천 일시 중지 · 보고서

작성일: 2026-10-28 · 기준 커밋: PHASE 25-26 `d8cf68c`

표기: **[실제]** 운영 DB · 실제 Chrome 에서 확인 · **[미실행]** 아직 돌지 않음

---

## 1. 사용자 결정 (2026-10-28)

- **매일 추천을 멈춘다.** 추천 3개를 실제로 팔았을 때 수익이 나는 상품을 고를 수 있을 때까지는 테스트로 발굴하며 점검만 한다.
- **수집은 토큰을 쓰지 않는 방식으로.** 확장 프로그램이 검색 결과를 자동으로 수집한다 (방법 A).
  - 쿠팡 이용약관상 자동화된 접근에 해당할 수 있다는 위험을 알고 선택했다.
  - 그래서 사람이 검색하는 속도를 넘지 않도록 규칙으로 막는다 (2절).

## 2. 검색 결과 자동 수집

**왜 검색 결과만 모으는가 [실제]**
- 10-28 에 검색 결과를 15일 만에 다시 수집했다.
- 그것만으로 키워드당 약 30개 상품의 판매량이 리뷰 증가로 추정됐다 (신뢰도 B).
- 그래서 상품 페이지를 하나씩 열 필요가 없다.

**동작**
```
1시간마다 확인 (Chrome 이 켜져 있을 때)
  → 켜져 있음 · 실행 중 아님 · 오전 9시(KST) 이후 · 마지막 완료 뒤 7일이면 시작
  → JARVIS 서버에서 추적 키워드 목록을 받는다 (/api/extension/keywords)
  → 최근 6일 안에 수집한 키워드는 빼고, 오래된 것부터 최대 20개
  → 키워드마다: 쿠팡 검색 결과 1페이지를 뒤쪽 탭으로 열기
       → [현재 검색 결과 수집]과 같은 흐름 실행 → 탭 닫기
       → 30초~2분 무작위로 기다린 뒤 다음 키워드
  → 결과를 팝업에 표시
```
- 새로 보인 미등록 상품은 기존 예약 자동 발굴(PHASE 17)이 다음 실행 때 등록한다.

**안전 규칙** — 코드(`extension/src/shared/auto-collect.ts`)와 테스트로 고정했다:

| 규칙 | 값 |
|---|---|
| 여는 주소 | `https://www.coupang.com/np/search?q=…&page=1` 하나뿐. 열기 전과 뜬 뒤 두 번 확인 |
| 열지 않는 것 | 상품 페이지 · 다음 페이지 · 그 밖의 쿠팡 주소. 탭 이동 · 창 만들기 없음 · 배경에서 쿠팡에 직접 요청 없음 |
| 동시에 | 탭 1개 |
| 간격 | 키워드 사이 30초~2분 무작위 |
| 횟수 | 주 1회 · 한 번에 최대 20개 · 같은 키워드는 6일 안에 다시 수집 안 함 |
| 끄기 | 팝업의 [켜기] 체크 해제 (실행 중이면 남은 키워드는 건너뜀) |
| 검색어 확인 | 화면 검색어가 요청과 다르면(쿠팡이 검색어를 바꿈) 수집하지 않음 |

**바뀐 파일**
- `extension/src/shared/auto-collect.ts` (신규): 규칙 · 주기 · 대상 고르기 · 주소 확인. 순수 함수
- `extension/src/background/service-worker.ts`: 알람 2개
  - `jarvis-auto-collect-check`: 1시간마다 확인
  - `jarvis-auto-collect-step`: 키워드 1개 = 알람 1번. 진행 상태는 chrome.storage 에 저장해서 서비스 워커가 잠들어도 이어서 한다
- `extension/src/content/coupang-search.ts`: 배경 요청(`jarvis:auto-search`)을 받아 기존 `runSearch()` 실행
- `extension/src/popup/*`: [켜기] · [지금 실행] · 진행 상황 · 키워드별 결과
- `extension/src/shared/{api,storage,types}.ts`
- `src/app/api/extension/keywords/route.ts` (신규): 추적 키워드 + 마지막 수집일. 읽기 전용, 사용자 토큰(RLS)
- `scripts/extension/test.mjs`
  - 기존 "쿠팡 탭을 열지 않는다" 검사를 "검색 1페이지만 · 탭 여는 곳 1곳 · 상품 페이지 없음 · 쿠팡 fetch 없음"으로 바꿨다
  - 규칙 테스트 3개를 추가했다

## 3. 매일 추천 일시 중지

- `src/config/picks.ts`: `DAILY_PICKS.enabled = false` (2026-10-28~)
- `scripts/picks/save.mjs`: 꺼져 있으면 저장을 거부한다 (`--force` 로만 저장). `picks:candidates` 는 읽기만 하므로 테스트 발굴에 계속 쓴다.
- /discover "오늘의 추천": "매일 추천을 멈춰 두었습니다" 안내 · 지난 추천은 참고용
- Claude 앱 예약 작업은 이미 없다 (10-28 확인). 다시 켤 때 새로 만든다.

## 4. 테스트

| 항목 | 결과 |
|---|---|
| test:extension | 36/37 — 신규 · 변경 4개 통과. 남은 1개는 `.env.local` 필요 검사 (변경 전과 같음) |
| score · judge · estimate · costs · ingest · automation · sourcing · profit · dashboard · import | 모두 통과 |
| db:verify | 258 |
| tsc · eslint · next build (`/api/extension/keywords` 포함) | 통과 |
| 실제 Chrome 자동 수집 | **[미실행]** 사용자 PC 에서 확장 다시 빌드 · 로드 후 [지금 실행]으로 확인 |

## 5. 사용자가 할 일

1. 명령 프롬프트:
   ```
   cd /d D:\project\jarvis\my-coupilot
   npm run ext:build
   npm run dev
   ```
2. `chrome://extensions` → JARVIS 수집기 → 새로고침(↻)
3. 툴바 JARVIS 아이콘 → "검색 결과 자동 수집" → [켜기] 확인 → [지금 실행]
   - 지금은 추적 키워드 11개 중 오늘 수집한 3개를 뺀 8개가 대상이다: 캠핑랜턴 · 실리콘 트레이 · 식탁매트 · 캠핑용품 · 보온병 · 나무도마 · 코일매트 · 젓가락.
   - 약 10~20분 동안 뒤쪽 탭이 열렸다 닫힌다.
4. 그 뒤로는 마지막 실행 7일 뒤 오전 9시 이후에 자동으로 돈다 (그때 PC · Chrome · JARVIS 서버가 켜져 있어야 함). 꺼져 있었으면 켠 뒤 1시간 안에 돈다.
