/**
 * 상품 기회 점수 가중치 (V1 기본안).
 *
 * - 이 값은 절대값이 아니다. 실제 판매 결과가 쌓이면 조정한다.
 * - 계산 로직은 PHASE 7(기회점수 엔진)에서 구현하며, 엔진은 이 상수를 주입받아 사용한다.
 * - 이후 Supabase 설정 테이블로 옮길 수 있도록 순수 데이터 구조로만 둔다.
 */

export const SCORE_FACTORS = [
  "demand",
  "salesVolume",
  "salesGrowth",
  "competition",
  "wingEntry",
  "reviewBarrier",
  "conversion",
  "margin",
  "marketStability",
] as const;
export type ScoreFactor = (typeof SCORE_FACTORS)[number];

export interface ScoreFactorConfig {
  label: string;
  weight: number;
  description: string;
}

export const DEFAULT_SCORE_WEIGHTS: Record<ScoreFactor, ScoreFactorConfig> = {
  demand: { label: "수요", weight: 15, description: "월 검색량 및 검색 추세" },
  salesVolume: { label: "판매량", weight: 15, description: "상위 상품 판매량 규모" },
  salesGrowth: { label: "판매 성장률", weight: 10, description: "최근 판매량 증감" },
  competition: {
    label: "경쟁 난이도",
    weight: 15,
    description: "상품수/검색량, 브랜드 집중도, 가격 경쟁",
  },
  wingEntry: {
    label: "WING 진입 가능성",
    weight: 10,
    description: "상위권 내 WING 판매자 비율",
  },
  reviewBarrier: { label: "리뷰 장벽", weight: 10, description: "상위 상품 리뷰 수 수준" },
  conversion: { label: "전환율", weight: 5, description: "조회수 대비 판매 전환" },
  margin: { label: "마진", weight: 15, description: "예상 순이익률" },
  marketStability: {
    label: "시장 안정성",
    weight: 5,
    description: "계절성, 가격 변동성",
  },
};

/** 판정 기준 점수 (조정 가능) */
export const VERDICT_THRESHOLDS = {
  /** 이 점수 이상이면 강력추천 */
  strongBuy: 80,
  /** 이 점수 이상이면 검토, 미만이면 제외 */
  review: 60,
} as const;

export function totalWeight(
  weights: Record<ScoreFactor, ScoreFactorConfig> = DEFAULT_SCORE_WEIGHTS,
): number {
  return SCORE_FACTORS.reduce((sum, key) => sum + weights[key].weight, 0);
}
