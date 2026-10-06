import { VERDICT_THRESHOLDS } from "@/config/scoring-weights";
import type { Verdict } from "@/types/common";

/** 0~100 점수를 판정으로 변환한다. 점수 계산 자체는 PHASE 7에서 구현한다. */
export function verdictFromScore(
  score: number,
  thresholds: { strongBuy: number; review: number } = VERDICT_THRESHOLDS,
): Verdict {
  if (score >= thresholds.strongBuy) return "STRONG_BUY";
  if (score >= thresholds.review) return "REVIEW";
  return "EXCLUDE";
}
