import "server-only";

import { DEFAULT_SCORE_WEIGHTS, SCORE_FACTORS, type ScoreFactor } from "@/config/scoring-weights";
import {
  calculateOpportunityScore,
  type HistoryPoint,
  type ScoreInput,
  type ScoreProductMetrics,
  type ScoreResult,
  type ScoringConfig,
} from "@/lib/scoring/engine";
import { createClient } from "@/lib/supabase/server";
import { isConfidence, isRiskType, isVerdict, type Json, type Tables, type TablesInsert } from "@/types/db";
import type { ScoreReason } from "@/types/common";
import type { ProductMetrics, ProductSnapshotView } from "@/types/product";
import type { SavedScoreView, ScoreKeywordOption, ProductRiskView } from "@/types/score";

import { getCompetitorsForProduct } from "./competitors";
import { getKeywordDetail } from "./keywords";
import { getProductDetail, kstToday } from "./products";
import { listScenariosForProduct } from "./profit";
import { diffWithCodeWeights } from "./scoring";

/*
 * Opportunity Score repository. 로그인 사용자 세션(RLS)으로만 접근한다.
 * DB → ScoreInput → calculateOpportunityScore() (순수 함수) → opportunity_scores.
 * opportunity_scores 는 append-only (수정 방지 트리거): 재계산은 이전 현재 행 is_current = false → 새 행 INSERT.
 * total_score · verdict 가 NOT NULL 이라 9개 요소가 모두 계산될 때만 저장한다 (부족하면 미리 보기만).
 */

type ScoreRow = Tables<"opportunity_scores">;

/** 활성 점수 버전(v1)을 읽어 엔진 설정으로. 코드 상수와 다르면 계산하지 않는다 */
export async function getScoringConfig(): Promise<ScoringConfig> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoring_versions")
    .select("version, weights, thresholds, factor_definitions")
    .eq("is_active", true)
    .single();
  if (error) throw error;
  const diffs = diffWithCodeWeights(data.weights, data.thresholds);
  if (diffs.length > 0) throw new Error(`scoring_versions(${data.version}) 와 코드 가중치가 다릅니다: ${diffs.join(", ")}`);
  const w = data.weights as Record<ScoreFactor, number>;
  const t = data.thresholds as { strongBuy: number; review: number };
  const defs = (data.factor_definitions ?? {}) as Record<string, { label?: string }>;
  return {
    version: data.version,
    weights: Object.fromEntries(SCORE_FACTORS.map((k) => [k, w[k]])) as Record<ScoreFactor, number>,
    thresholds: { strongBuy: t.strongBuy, review: t.review },
    labels: Object.fromEntries(SCORE_FACTORS.map((k) => [k, defs[k]?.label ?? DEFAULT_SCORE_WEIGHTS[k].label])) as Record<ScoreFactor, string>,
  };
}

/** DB factor_definitions.column 과 같은 매핑 (seed 0012) */
const FACTOR_COLUMN = {
  demand: "demand_score",
  salesVolume: "sales_score",
  salesGrowth: "growth_score",
  competition: "competition_score",
  wingEntry: "wing_score",
  reviewBarrier: "review_barrier_score",
  conversion: "conversion_score",
  margin: "margin_score",
  marketStability: "stability_score",
} as const satisfies Record<ScoreFactor, keyof ScoreRow>;

function toScoreMetrics(m: ProductMetrics | null): ScoreProductMetrics | null {
  if (!m) return null;
  return {
    price: m.price,
    reviewCount: m.reviewCount,
    salesActual: m.salesActual,
    salesEstimated: m.salesEstimated,
    conversionRate: m.conversionRate,
    sellerTypeObserved: m.sellerTypeObserved,
  };
}

/** 제외되지 않은 스냅샷 → 이력 (판매량은 30일 환산, 집계 기간을 모르면 뺀다) */
function histories(snapshots: ProductSnapshotView[]) {
  const live = snapshots.filter((s) => !s.isExcluded);
  const point = (s: ProductSnapshotView, value: number): HistoryPoint => ({
    snapshotId: s.id,
    capturedOn: s.capturedOn,
    value,
    source: s.source,
    confidence: s.confidence,
  });
  const sales = (pick: (s: ProductSnapshotView) => number | null) =>
    live.filter((s) => pick(s) != null && s.salesPeriodDays).map((s) => point(s, (pick(s)! * 30) / s.salesPeriodDays!));
  return {
    salesHistory: { actual: sales((s) => s.salesActual), estimated: sales((s) => s.salesEstimated) },
    priceHistory: live.filter((s) => s.price != null).map((s) => point(s, s.price!)),
  };
}

/** 점수 맥락으로 고를 수 있는 키워드: 관심상품 발견 키워드 · 검색 순위 · 경쟁관계 키워드 */
export async function listScoreKeywordOptions(productId: string): Promise<ScoreKeywordOption[]> {
  const supabase = await createClient();
  const [watch, ranks, comps] = await Promise.all([
    supabase.from("watchlist").select("keyword_id, keywords!watchlist_keyword_fk(keyword)").eq("product_id", productId).not("keyword_id", "is", null),
    supabase.from("keyword_product_ranks").select("keyword_id, captured_on, keywords!keyword_product_ranks_keyword_fk(keyword)").eq("product_id", productId).order("captured_on", { ascending: false }),
    supabase.from("competitors").select("keyword_id, keywords!competitors_keyword_fk(keyword)").eq("product_id", productId).eq("is_active", true).not("keyword_id", "is", null),
  ]);
  for (const r of [watch, ranks, comps]) if (r.error) throw r.error;
  const out = new Map<string, ScoreKeywordOption>();
  const add = (id: string | null, keyword: string | undefined, origin: ScoreKeywordOption["origin"]) => {
    if (id && keyword && !out.has(id)) out.set(id, { id, keyword, origin });
  };
  for (const w of watch.data ?? []) add(w.keyword_id, w.keywords?.keyword, "WATCHLIST");
  for (const r of ranks.data ?? []) add(r.keyword_id, r.keywords?.keyword, "RANK");
  for (const c of comps.data ?? []) add(c.keyword_id, c.keywords?.keyword, "COMPETITOR");
  return [...out.values()];
}

/** 상품 + (선택) 키워드 맥락으로 점수 입력을 모은다. 상품이 없으면 null */
export async function buildScoreInput(productId: string, keywordId: string | null): Promise<ScoreInput | null> {
  const [product, keyword, competitors, scenarios] = await Promise.all([
    getProductDetail(productId),
    keywordId ? getKeywordDetail(keywordId) : null,
    getCompetitorsForProduct(productId),
    listScenariosForProduct(productId),
  ]);
  if (!product) return null;
  // 고른 키워드가 보이지 않으면(삭제·다른 사용자) 키워드 없이 계산하지 않고 오류로 끝낸다
  if (keywordId && !keyword) throw Object.assign(new Error("키워드를 찾을 수 없습니다."), { code: "23503" });
  const primary = scenarios.find((s) => s.isPrimary && s.current);
  return {
    asOf: kstToday(),
    product: { id: product.id, name: product.productName, metrics: toScoreMetrics(product.metrics) },
    keyword: keyword
      ? {
          id: keyword.id,
          keyword: keyword.keyword,
          metrics: {
            searchVolume: keyword.metrics.searchVolume,
            searchGrowthRate: keyword.metrics.searchGrowthRate,
            competitionIntensity: keyword.metrics.competitionIntensity,
            brandConcentration: keyword.metrics.brandConcentration,
            wingRatio: keyword.metrics.wingRatio,
            averageReviews: keyword.metrics.averageReviews,
          },
        }
      : null,
    competitors: competitors.map((c) => ({
      productId: c.competitor.id,
      productName: c.competitor.productName,
      relationType: c.relationType,
      isActive: c.isActive,
      metrics: toScoreMetrics(c.competitorMetrics),
    })),
    ...histories(product.snapshots),
    margin: primary?.current
      ? {
          scenarioId: primary.id,
          scenarioName: primary.name,
          calculationId: primary.current.id,
          formulaVersion: primary.current.formulaVersion,
          netMarginRate: primary.current.netMarginRate,
          salePrice: primary.salePrice,
          calculatedAt: primary.current.calculatedAt,
        }
      : null,
  };
}

export async function previewScore(productId: string, keywordId: string | null): Promise<{ input: ScoreInput; result: ScoreResult } | null> {
  const [input, config] = await Promise.all([buildScoreInput(productId, keywordId), getScoringConfig()]);
  if (!input) return null;
  return { input, result: calculateOpportunityScore(input, config) };
}

/** 재현용 입력 기록: 요소별 원본 값·출처·신뢰도·수집일 + 참조 id */
function inputRefs(input: ScoreInput, result: ScoreResult): Json {
  return {
    engine: result.engineVersion,
    as_of: input.asOf,
    keyword_id: input.keyword?.id ?? null,
    keyword: input.keyword?.keyword ?? null,
    profit_scenario_id: input.margin?.scenarioId ?? null,
    profit_calculation_id: input.margin?.calculationId ?? null,
    competitors: input.competitors.filter((c) => c.isActive).map((c) => ({ product_id: c.productId, relation_type: c.relationType })),
    product_snapshot_ids: [...new Set([...input.salesHistory.actual, ...input.salesHistory.estimated, ...input.priceHistory].map((p) => p.snapshotId))],
    date_range: result.dateRange,
    factors: Object.fromEntries(
      result.factors.map((f) => [
        f.factor,
        {
          score: f.score,
          points: f.points,
          weight: f.weight,
          basis: f.basis,
          missing: f.missing,
          inputs: f.inputs.map((x) => ({
            name: x.name,
            value: x.value,
            source: x.source ?? null,
            confidence: x.confidence ?? null,
            captured_on: x.capturedOn ?? null,
            ref: x.ref ?? null,
          })),
        },
      ]),
    ),
  } as Json;
}

export type SaveScoreOutcome =
  | { saved: true; scoreId: string; result: ScoreResult }
  | { saved: false; result: ScoreResult };

/** 다시 계산 → 9개 요소가 모두 있으면 새 현재 점수로 저장. 부족하면 저장하지 않는다 (이전 점수 유지) */
export async function recalculateScore(productId: string, keywordId: string | null): Promise<SaveScoreOutcome | null> {
  const preview = await previewScore(productId, keywordId);
  if (!preview) return null;
  const { input, result } = preview;
  if (!result.complete || result.total == null || result.verdict == null) return { saved: false, result };

  const supabase = await createClient();
  let down = supabase
    .from("opportunity_scores")
    .update({ is_current: false })
    .eq("product_id", productId)
    .eq("scoring_version", result.scoringVersion)
    .eq("is_current", true);
  down = input.keyword ? down.eq("keyword_id", input.keyword.id) : down.is("keyword_id", null);
  const { data: previous, error: downError } = await down.select("id");
  if (downError) throw downError;

  const row: TablesInsert<"opportunity_scores"> = {
    product_id: productId,
    keyword_id: input.keyword?.id ?? null,
    scoring_version: result.scoringVersion,
    total_score: result.total,
    verdict: result.verdict,
    data_confidence: result.dataConfidence,
    missing_factors: result.missingFactors,
    reasons: result.reasons as unknown as Json,
    input_refs: inputRefs(input, result),
    is_current: true,
  };
  for (const f of result.factors) row[FACTOR_COLUMN[f.factor]] = f.score;

  const { data, error } = await supabase.from("opportunity_scores").insert(row).select("id").single();
  if (error) {
    // 저장 실패: 내렸던 이전 점수를 되돌린다 (is_current 는 수정 방지 트리거가 허용하는 유일한 변경)
    if (previous.length > 0) await supabase.from("opportunity_scores").update({ is_current: true }).eq("id", previous[0].id);
    throw error;
  }
  return { saved: true, scoreId: data.id, result };
}

function toReasons(value: Json): ScoreReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    const o = r as { kind?: unknown; message?: unknown } | null;
    return o && (o.kind === "POSITIVE" || o.kind === "CAUTION") && typeof o.message === "string" ? [{ kind: o.kind, message: o.message }] : [];
  });
}

function toSavedScore(row: ScoreRow): SavedScoreView {
  const refs = (row.input_refs ?? {}) as { keyword?: string | null; engine?: string; factors?: Record<string, { basis?: string; inputs?: unknown[] }> };
  return {
    id: row.id,
    productId: row.product_id,
    keywordId: row.keyword_id,
    keyword: refs.keyword ?? null,
    scoringVersion: row.scoring_version,
    engineVersion: refs.engine ?? null,
    total: row.total_score,
    verdict: isVerdict(row.verdict) ? row.verdict : "EXCLUDE",
    dataConfidence: isConfidence(row.data_confidence) ? row.data_confidence : null,
    factorScores: Object.fromEntries(SCORE_FACTORS.map((k) => [k, row[FACTOR_COLUMN[k]] as number | null])) as Record<ScoreFactor, number | null>,
    factorBasis: Object.fromEntries(SCORE_FACTORS.map((k) => [k, refs.factors?.[k]?.basis ?? null])) as Record<ScoreFactor, string | null>,
    reasons: toReasons(row.reasons),
    calculatedAt: row.calculated_at,
    source: "CALCULATED",
  };
}

/** 활성 버전의 현재 점수 (상품마다 가장 최근 계산 1개) */
export async function listCurrentScoresByProduct(productIds?: string[]): Promise<Map<string, SavedScoreView>> {
  const supabase = await createClient();
  let query = supabase.from("v_current_scores").select("*").order("calculated_at", { ascending: false });
  if (productIds) {
    if (productIds.length === 0) return new Map();
    query = query.in("product_id", productIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  const out = new Map<string, SavedScoreView>();
  for (const row of data) {
    if (row.product_id && !out.has(row.product_id)) out.set(row.product_id, toSavedScore(row as ScoreRow));
  }
  return out;
}

/** 상품의 점수 이력 (최신순, 모든 버전·키워드 맥락) */
export async function listScoreHistory(productId: string, { limit = 10 } = {}): Promise<SavedScoreView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunity_scores")
    .select("*")
    .eq("product_id", productId)
    .order("calculated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map(toSavedScore).map((s, i) => ({ ...s, isCurrent: data[i].is_current }));
}

/** 활성 위험 요소 (참고 표시용 — 점수 계산에는 넣지 않는다) */
export async function listActiveRisks(productId: string): Promise<ProductRiskView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_risks")
    .select("id, risk_type, risk_level, description, source_type, detected_at")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("detected_at", { ascending: false });
  if (error) throw error;
  return data
    .filter((r) => isRiskType(r.risk_type))
    .map((r) => ({
      id: r.id,
      type: r.risk_type as ProductRiskView["type"],
      level: r.risk_level as ProductRiskView["level"],
      description: r.description,
      source: r.source_type,
      detectedAt: r.detected_at,
    }));
}

/** 특정 키워드 맥락(NULL = 키워드 없음)의 현재 점수 */
export async function getCurrentScore(productId: string, keywordId: string | null): Promise<SavedScoreView | null> {
  const supabase = await createClient();
  let query = supabase.from("v_current_scores").select("*").eq("product_id", productId);
  query = keywordId ? query.eq("keyword_id", keywordId) : query.is("keyword_id", null);
  const { data, error } = await query.order("calculated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? toSavedScore(data as ScoreRow) : null;
}
