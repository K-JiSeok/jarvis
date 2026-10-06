# JARVIS

쿠팡 상품 발굴 및 분석을 위한 **개인용** 웹 애플리케이션.
목표: 상품 하나 또는 키워드 하나를 선택했을 때, 판매할 가치가 있는지 빠르게 판단하는 것.

## 기술 스택

- Next.js 16 (App Router) · TypeScript · React 19
- Tailwind CSS v4 · shadcn/ui (new-york, neutral)
- Supabase PostgreSQL (PHASE 2부터 사용)
- Vercel 배포

## 실행

```bash
npm install
cp .env.example .env.local   # PHASE 2부터 값 입력
npm run dev                  # http://localhost:3000
```

## 폴더 구조

```
src/
├─ app/                 # 페이지 (메뉴 9개)
├─ components/
│  ├─ ui/               # shadcn/ui 기본 컴포넌트
│  ├─ layout/           # 사이드바, 모바일 헤더
│  ├─ common/           # 점수/판정/출처 배지, DEMO 배너 등
│  └─ dashboard/        # Dashboard 전용 컴포넌트
├─ config/              # 메뉴, 점수 가중치 (조정 가능한 상수)
├─ lib/
│  ├─ scoring/          # 점수 엔진 (PHASE 7) — UI·수집 방식과 분리
│  ├─ mock/             # DEMO 데이터 (실데이터 아님)
│  └─ format.ts
└─ types/               # 도메인 타입 (source_type, confidence 포함)
```

## 데이터 원칙

- 모든 외부 데이터는 `source`(OFFICIAL_API, COUPANG_PAGE, WING_SESSION, EXTENSION, CALCULATED, MANUAL, ESTIMATED)와 `confidence`(A/B/C)를 함께 가진다.
- 판매량은 `actual` / `estimated` / `predicted`로 구분한다.
- 실제 데이터가 없는 화면은 반드시 **DEMO** 배너를 표시한다.

## 개발 단계

| PHASE | 내용 | 상태 |
|---|---|---|
| 1 | 프로젝트 초기화 및 기본 UI | ✅ |
| 2 | Supabase DB 설계 및 연결 | |
| 3 | 키워드 데이터 구조 | |
| 4 | 상품 데이터 구조 | |
| 5 | 경쟁상품 데이터 구조 | |
| 6 | 수익성 계산 | |
| 7 | 기회점수 계산 엔진 | |
| 8 | Dashboard | |
| 9 | CSV/Excel import | |
| 10 | 실제 쿠팡 데이터 연결 | |
| 11 | Chrome Extension | |
| 12 | 실제 데이터로 검증 | |

## 참고

- shadcn/ui 컴포넌트를 추가할 때: `npx shadcn@latest add <component>`
