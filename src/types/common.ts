/**
 * JARVIS 공통 도메인 타입.
 *
 * 모든 외부 데이터는 "값 + 출처(source_type) + 신뢰도(confidence)" 단위로 다룬다.
 * 수집 방식이 바뀌어도 분석 엔진은 이 타입만 바라보도록 한다.
 */

/** 데이터 출처 */
export const SOURCE_TYPES = [
  "OFFICIAL_API",
  "COUPANG_PAGE",
  "WING_SESSION",
  "EXTENSION",
  "CALCULATED",
  "MANUAL",
  "ESTIMATED",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  OFFICIAL_API: "공식 API",
  COUPANG_PAGE: "쿠팡 페이지",
  WING_SESSION: "WING",
  EXTENSION: "확장프로그램",
  CALCULATED: "자체 계산",
  MANUAL: "직접 입력",
  ESTIMATED: "추정",
};

/**
 * 데이터 신뢰도
 * A = 직접 확인 데이터 / B = 신뢰도 높은 추정 / C = 참고용 추정
 */
export const CONFIDENCE_LEVELS = ["A", "B", "C"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  A: "직접 확인",
  B: "신뢰도 높은 추정",
  C: "참고용 추정",
};

/** 출처와 신뢰도가 붙은 단일 데이터 값 */
export interface DataPoint<T = number> {
  /** 값이 아직 확보되지 않았으면 null (임의 값으로 채우지 않는다) */
  value: T | null;
  source: SourceType;
  confidence: Confidence;
  /** 수집/계산 시각 (ISO 8601) */
  collectedAt?: string;
}

/**
 * 판매량은 절대 하나의 필드로 합치지 않는다.
 * - actual: 실제 판매량
 * - estimated: 추정 판매량 (조회수·리뷰 증가 등으로 역산)
 * - predicted: 예측 판매량 (미래 시점)
 */
export interface SalesFigures {
  actual: DataPoint | null;
  estimated: DataPoint | null;
  predicted: DataPoint | null;
}

/** 최종 판정 */
export const VERDICTS = ["STRONG_BUY", "REVIEW", "EXCLUDE"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  STRONG_BUY: "강력추천",
  REVIEW: "검토",
  EXCLUDE: "제외",
};

/** 점수와 별도로 관리하는 위험 요소 */
export const RISK_TYPES = [
  "BRAND_MONOPOLY",
  "REVIEW_OVERLOAD",
  "PRICE_WAR",
  "COUPANG_PB",
  "LOW_MARGIN",
  "BULKY_HEAVY",
  "SEASONALITY",
  "AD_DEPENDENCY",
] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_LABELS: Record<RiskType, string> = {
  BRAND_MONOPOLY: "브랜드 독점",
  REVIEW_OVERLOAD: "리뷰 과다",
  PRICE_WAR: "가격 경쟁",
  COUPANG_PB: "쿠팡 PB 영향",
  LOW_MARGIN: "낮은 마진",
  BULKY_HEAVY: "대형/중량 상품",
  SEASONALITY: "계절성",
  AD_DEPENDENCY: "광고 의존도",
};

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface RiskWarning {
  type: RiskType;
  severity: RiskSeverity;
  message: string;
}

/** 점수 근거: 가점(+) / 주의(-) 항목 */
export interface ScoreReason {
  kind: "POSITIVE" | "CAUTION";
  message: string;
}

/**
 * 화면에 표시되는 데이터가 실데이터인지 데모인지 구분.
 * DEMO 데이터는 반드시 화면에 명시적으로 표시한다.
 */
export type DataMode = "LIVE" | "DEMO";
