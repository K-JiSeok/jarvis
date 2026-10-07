import type { Confidence, DataPoint, SourceType } from "./common";

/**
 * 키워드 화면용 도메인 타입. DB 행(src/types/database.ts)과 분리한다.
 * 변환은 src/lib/mappers/keyword.ts.
 * 모든 지표는 DataPoint(값 + 출처 + 신뢰도 + 수집일). 값이 없으면 null (0 으로 채우지 않는다).
 */

export interface CategoryOption {
  id: string;
  name: string;
  path: string | null;
}

/** v_keyword_latest 의 현재 값 */
export interface KeywordMetrics {
  searchVolume: DataPoint | null;
  searchVolumePrevious: DataPoint | null;
  /** 0~1 비율 기준 증감 (-0.25 = -25%) */
  searchGrowthRate: DataPoint | null;
  coupangProductCount: DataPoint | null;
  /** 상품 수 ÷ 월 검색량 */
  competitionIntensity: DataPoint | null;
  /** 0~1 */
  wingRatio: DataPoint | null;
  /** 0~1 */
  rocketRatio: DataPoint | null;
  averagePrice: DataPoint | null;
  averageReviews: DataPoint | null;
  /** 0~1 */
  brandConcentration: DataPoint | null;
  sampleSize: DataPoint | null;
  adBid: DataPoint | null;
}

export interface KeywordSummary {
  id: string;
  keyword: string;
  normalizedKeyword: string;
  category: CategoryOption | null;
  isTracking: boolean;
  memo: string | null;
  /** keywords.updated_at (상세 조회 때만). 수정 폼 다시 그리기 기준 */
  updatedAt: string | null;
  snapshotCount: number;
  /** 가장 최근 스냅샷 수집일 (YYYY-MM-DD, KST) */
  latestCapturedOn: string | null;
  metrics: KeywordMetrics;
}

/** keyword_snapshots 1행 (이력) */
export interface KeywordSnapshotView {
  id: number;
  capturedOn: string;
  capturedAt: string;
  source: SourceType;
  confidence: Confidence;
  searchVolume: number | null;
  searchVolumePrevious: number | null;
  searchGrowthRate: number | null;
  coupangProductCount: number | null;
  competitionIntensity: number | null;
  wingRatio: number | null;
  rocketRatio: number | null;
  averagePrice: number | null;
  averageReviews: number | null;
  brandConcentration: number | null;
  sampleSize: number | null;
  adBid: number | null;
  /** 항목별 출처 덮어쓰기 (예: 자동 계산된 경쟁강도) */
  calculatedFields: string[];
  isExcluded: boolean;
  excludedReason: string | null;
}

export interface KeywordDetail extends KeywordSummary {
  snapshots: KeywordSnapshotView[];
}
