import type {
  DataMode,
  DataPoint,
  RiskWarning,
  SalesFigures,
  ScoreReason,
} from "./common";

/**
 * Dashboard 추천상품 카드에 필요한 뷰 모델.
 * DB/수집 구조와 분리된 화면 전용 타입이다. (PHASE 8에서 실제 엔진 결과로 채운다)
 */
export interface RecommendationView {
  rank: number;
  productName: string;
  category: string;
  /** 기회 점수 0~100 */
  opportunityScore: number;
  sales: SalesFigures;
  monthlyRevenue: DataPoint;
  monthlyNetProfit: DataPoint;
  /** 0~1 비율 */
  marginRate: DataPoint;
  /** 쿠팡 상품 수 / 월 검색량 */
  competitionRatio: DataPoint;
  /** 상위 상품 평균 리뷰 수 */
  topReviewAvg: DataPoint;
  /** 0~1 비율 */
  wingRatio: DataPoint;
  /** 0~1 비율, 전월 대비 */
  growthRate: DataPoint;
  reasons: ScoreReason[];
  risks: RiskWarning[];
}

export interface DashboardData {
  mode: DataMode;
  generatedAt: string;
  recommendations: RecommendationView[];
}
