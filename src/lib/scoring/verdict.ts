import { VERDICT_THRESHOLDS } from "@/config/scoring-weights";
import type { Verdict } from "@/types/common";

import { verdictFor } from "./engine";

/** 0~100 점수를 판정으로 변환한다. 규칙은 점수 엔진(verdictFor)과 같은 함수 */
export function verdictFromScore(
  score: number,
  thresholds: { strongBuy: number; review: number } = VERDICT_THRESHOLDS,
): Verdict {
  return verdictFor(score, thresholds);
}
