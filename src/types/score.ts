import type { ScoreFactor } from "@/config/scoring-weights";

import type { Confidence, RiskSeverity, RiskType, SourceType, Verdict } from "./common";

/** 저장된 Opportunity Score (opportunity_scores 1행) */
export interface SavedScoreView {
  id: string;
  productId: string;
  /** 점수 맥락 키워드 (NULL = 키워드 무관) */
  keywordId: string | null;
  keyword: string | null;
  scoringVersion: string;
  engineVersion: string | null;
  total: number;
  verdict: Verdict;
  dataConfidence: Confidence | null;
  /** 요소 점수 0~100 */
  factorScores: Record<ScoreFactor, number | null>;
  factorBasis: Record<ScoreFactor, string | null>;
  calculatedAt: string;
  /** 점수 자체는 항상 자체 계산 */
  source: Extract<SourceType, "CALCULATED">;
  isCurrent?: boolean;
}

/** 점수 맥락으로 고를 수 있는 키워드 */
export interface ScoreKeywordOption {
  id: string;
  keyword: string;
  origin: "WATCHLIST" | "RANK" | "COMPETITOR";
}

export interface ProductRiskView {
  id: string;
  type: RiskType;
  level: RiskSeverity;
  description: string;
  source: string;
  detectedAt: string;
}
