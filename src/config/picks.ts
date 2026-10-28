/**
 * 매일 오전 추천 (PHASE 24) 운영 스위치.
 *
 * 2026-10-28 사용자 결정: "추천 3개를 실제로 팔았을 때 수익이 나는 상품을 발굴할 수 있을 때까지" 매일 추천을 멈춘다.
 * 그동안은 테스트로만 발굴 · 점검한다 (npm run picks:candidates 는 읽기만 하므로 계속 쓸 수 있다).
 * 다시 켜려면 enabled 를 true 로 바꾸고 예약 작업을 새로 만든다.
 */
export const DAILY_PICKS = {
  enabled: false,
  pausedOn: "2026-10-28",
  reason: "판정 엔진 검증 전 — 실제 판매 시 수익이 나는 상품을 확실히 고를 수 있을 때까지 테스트 발굴만",
} as const;
