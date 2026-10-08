/**
 * Dashboard 집계 (순수 함수). 저장된 현재 점수와 점수 엔진 결과를 그대로 센다 — 새 판단 규칙을 만들지 않는다.
 * 타입만 import 한다 (Node 테스트 스크립트에서 직접 실행).
 *
 * - 점수가 없는 상품은 "미계산" 으로 따로 센다 (EXCLUDE 로 치지 않는다).
 * - 점수는 상품당 1개 (listCurrentScoresByProduct: 활성 버전 현재 점수 중 가장 최근 계산) — 이력은 세지 않는다.
 */

import type { ScoreFactor } from "@/config/scoring-weights";
import type { ScoreReason, Verdict } from "@/types/common";

export interface ScoredLike {
  productId: string;
  total: number;
  verdict: Verdict;
  calculatedAt: string;
}

export interface ScoreSummary {
  products: number;
  scored: number;
  unscored: number;
  byVerdict: Record<Verdict, number>;
}

/** 대상 상품 목록 기준으로 센다. 목록에 없는 상품(삭제 등)의 점수는 넣지 않는다 */
export function summarizeScores(productIds: string[], scores: Map<string, Pick<ScoredLike, "verdict">>): ScoreSummary {
  const byVerdict: Record<Verdict, number> = { STRONG_BUY: 0, REVIEW: 0, EXCLUDE: 0 };
  let scored = 0;
  for (const id of new Set(productIds)) {
    const s = scores.get(id);
    if (!s) continue;
    scored += 1;
    byVerdict[s.verdict] += 1;
  }
  const products = new Set(productIds).size;
  return { products, scored, unscored: products - scored, byVerdict };
}

const VERDICT_ORDER: Record<Verdict, number> = { STRONG_BUY: 0, REVIEW: 1, EXCLUDE: 2 };

/** 추천: STRONG_BUY 전부 → REVIEW, 각각 총점 높은 순 → 최근 계산 순. EXCLUDE · 미계산 제외 */
export function pickRecommendations<T extends ScoredLike>(scores: T[], limit: number): T[] {
  return scores
    .filter((s) => s.verdict === "STRONG_BUY" || s.verdict === "REVIEW")
    .sort(
      (a, b) =>
        VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.total - a.total || b.calculatedAt.localeCompare(a.calculatedAt),
    )
    .slice(0, limit);
}

/** 최근 계산 순 */
export function recentlyAnalyzed<T extends ScoredLike>(scores: T[], limit: number): T[] {
  return [...scores].sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt)).slice(0, limit);
}

/** 저장된 근거 중 가점 · 주의를 앞에서부터 몇 개만 (순서·문구 그대로) */
export function pickReasons(reasons: ScoreReason[], maxPositive = 3, maxCaution = 2): ScoreReason[] {
  return [
    ...reasons.filter((r) => r.kind === "POSITIVE").slice(0, maxPositive),
    ...reasons.filter((r) => r.kind === "CAUTION").slice(0, maxCaution),
  ];
}

/** 상품 1개의 현재 데이터 기준 점수 엔진 결과 (요약) */
export interface PreviewLike {
  productId: string;
  complete: boolean;
  factors: { factor: ScoreFactor; label: string; score: number | null; missing: string[] }[];
}

export interface DataQuality {
  /** 엔진을 돌려 본 상품 수 */
  checked: number;
  /** 9개 요소가 모두 계산되는 상품 */
  computable: number;
  insufficient: number;
  /** 계산은 되지만 아직 점수를 저장하지 않은 상품 */
  computableUnsaved: number;
  /** 요소별 미계산 상품 수 (많은 순) */
  missing: { factor: ScoreFactor; label: string; need: string; count: number }[];
}

export function summarizeDataQuality(previews: PreviewLike[], savedProductIds: Set<string>): DataQuality {
  const counts = new Map<ScoreFactor, { label: string; need: string; count: number }>();
  let computable = 0;
  let computableUnsaved = 0;
  for (const p of previews) {
    if (p.complete) {
      computable += 1;
      if (!savedProductIds.has(p.productId)) computableUnsaved += 1;
    }
    for (const f of p.factors) {
      if (f.score != null) continue;
      const c = counts.get(f.factor) ?? { label: f.label, need: f.missing[0] ?? "", count: 0 };
      c.count += 1;
      counts.set(f.factor, c);
    }
  }
  return {
    checked: previews.length,
    computable,
    insufficient: previews.length - computable,
    computableUnsaved,
    missing: [...counts.entries()].map(([factor, c]) => ({ factor, ...c })).sort((a, b) => b.count - a.count),
  };
}
