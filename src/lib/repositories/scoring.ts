import "server-only";

import { DEFAULT_SCORE_WEIGHTS, SCORE_FACTORS, VERDICT_THRESHOLDS } from "@/config/scoring-weights";
import { createClient } from "@/lib/supabase/server";

/** 활성 점수 버전 (scoring_versions.is_active). 로그인 사용자만 읽을 수 있다. */
export async function getActiveScoringVersion() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoring_versions")
    .select("version, weights, thresholds, released_at")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** DB 버전의 가중치·판정 기준이 src/config/scoring-weights.ts 와 다른 항목 목록 (빈 배열 = 일치) */
export function diffWithCodeWeights(weights: unknown, thresholds: unknown): string[] {
  const w = (weights ?? {}) as Record<string, unknown>;
  const t = (thresholds ?? {}) as Record<string, unknown>;
  const diffs: string[] = [];

  for (const key of SCORE_FACTORS) {
    if (w[key] !== DEFAULT_SCORE_WEIGHTS[key].weight) diffs.push(`${DEFAULT_SCORE_WEIGHTS[key].label} 가중치`);
  }
  for (const key of Object.keys(w)) {
    if (!(SCORE_FACTORS as readonly string[]).includes(key)) diffs.push(`알 수 없는 요소 ${key}`);
  }
  for (const key of Object.keys(VERDICT_THRESHOLDS) as (keyof typeof VERDICT_THRESHOLDS)[]) {
    if (t[key] !== VERDICT_THRESHOLDS[key]) diffs.push(`판정 기준 ${key}`);
  }
  return diffs;
}
