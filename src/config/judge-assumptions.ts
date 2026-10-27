/**
 * 판정 엔진 V2 가정값 (PHASE 26 · judge-v2).
 *
 * 목표: "쿠팡 로켓그로스로 팔았을 때 확실히 남는 상품"만 강력추천한다.
 * 그래서 모든 가정은 이익을 적게 잡는(보수적인) 쪽으로 정했다. 값을 바꾸면 JUDGE_VERSION 을 올린다.
 * 각 값의 근거는 basis 에 적고 설정 화면에 그대로 보여 준다.
 */

export const JUDGE_ASSUMPTIONS = {
  /** 광고비 (판매가 대비). 단위 경제성 · 허용 원가 계산에 쓴다 */
  adRate: {
    value: 0.15,
    label: "광고비 (판매가 대비)",
    basis:
      "신규 로켓그로스 광고는 목표 ROAS 300% 이상으로 시작하는 것이 일반적 → 광고로 난 매출의 약 33%가 광고비. 출시 초기 매출의 절반이 광고를 거친다고 보면 전체 매출의 약 15%.",
    source: "https://inside.ampm.co.kr/insight/60609",
  },
  /** 목표 순이익률 (수수료 · 물류 · 광고 · 원가를 모두 뺀 뒤) */
  targetNetMargin: {
    value: 0.25,
    label: "목표 순이익률",
    basis: "광고까지 뺀 뒤 판매가의 25%가 남아야 반품 · 할인 · 가격 경쟁을 버틸 수 있다고 본 값. 이전 기본값(마진 30% + 광고 10%)보다 광고를 현실적으로 잡고 합계는 더 엄격하게 했다.",
    source: null,
  },
  /** 계산에서 빠진 비용 여유분 (보관 · 반품 · 포장 손실) */
  otherCostBuffer: {
    value: 0.03,
    label: "빠진 비용 여유분 (보관 · 반품 등)",
    basis: "허용 원가 계산에 보관료 · 반품 회수비가 들어 있지 않아 판매가의 3%를 따로 뺀다.",
    source: null,
  },
  /** 확인된 최소 월 판매량 (추정 범위의 최소값 기준) */
  minMonthlySales: {
    value: 30,
    label: "최소 월 판매량 (추정 최소값)",
    basis: "리뷰 작성률을 가장 높게(5%) 잡은 보수적 추정으로도 월 30개는 팔려야 시장이 있다고 본다. 리뷰 작성률은 믿을 만한 공개 자료가 없어 1~5% 범위로 둔다.",
    source: null,
  },
  /** 주력 가격대 */
  priceBand: {
    value: [15_000, 40_000] as const,
    label: "주력 가격대",
    basis: "PHASE 23 분석: 로켓그로스 입출고 · 배송비가 개당 2,000~2,900원 붙어 1만원 미만 단품은 남기 어렵다. 4만원 초과는 재고 자금 부담이 크다.",
    source: null,
  },
} as const;

/** 판정 기준 점수 (V1 과 같은 80 / 60) */
export const JUDGE_THRESHOLDS = { strongBuy: 80, review: 60 } as const;

/** 시장 점수 · 상품 점수 안의 요소 가중치 (각 100) */
export const JUDGE_WEIGHTS = {
  market: { demand: 30, reviewBarrier: 30, sellerMix: 30, adBurden: 10 },
  product: { economics: 45, salesEvidence: 35, priceFit: 20 },
} as const;
