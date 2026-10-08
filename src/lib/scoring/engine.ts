/**
 * Opportunity Score 엔진 (score-engine-v1). 순수 함수 — DB 와 무관하다.
 * 다른 모듈은 타입만 import 한다 (Node 테스트 스크립트에서 직접 실행).
 *
 * - 가중치·판정 기준은 scoring_versions(v1) 값을 주입받는다. 엔진이 바꾸지 않는다.
 * - 요소 점수는 0~100 정규화 값 (opportunity_scores.*_score 와 같은 척도). 총점 = Σ 가중치 × 요소 점수 ÷ 100.
 * - 데이터가 없는 요소는 0점이 아니라 "미계산"(null). 9개 요소가 모두 계산될 때만 총점과 판정을 낸다.
 *   일부만 계산되면 확보 점수와 가능 범위(미계산 요소가 0점~만점일 때)만 보여 준다.
 * - 정규화 구간(아래 RULES)은 이 엔진 버전의 정의다. 값을 바꾸면 SCORE_ENGINE_VERSION 을 올린다.
 */

import type { ScoreFactor } from "@/config/scoring-weights";
import type { Confidence, DataPoint, ScoreReason, SourceType, Verdict } from "@/types/common";

export const SCORE_ENGINE_VERSION = "score-engine-v1";

// 입력 --------------------------------------------------------------------------------

export type PeriodPoint = DataPoint & { periodDays: number | null };

export interface ScoreProductMetrics {
  price: DataPoint | null;
  reviewCount: DataPoint | null;
  salesActual: PeriodPoint | null;
  salesEstimated: PeriodPoint | null;
  conversionRate: DataPoint | null;
  sellerTypeObserved: DataPoint<string> | null;
}

export interface ScoreKeywordMetrics {
  searchVolume: DataPoint | null;
  searchGrowthRate: DataPoint | null;
  competitionIntensity: DataPoint | null;
  brandConcentration: DataPoint | null;
  wingRatio: DataPoint | null;
  averageReviews: DataPoint | null;
}

export interface ScoreCompetitor {
  productId: string;
  productName: string;
  relationType: string;
  isActive: boolean;
  metrics: ScoreProductMetrics | null;
}

/** 대상 상품의 스냅샷 이력 한 줄 (제외된 스냅샷은 넣지 않는다) */
export interface HistoryPoint {
  snapshotId: number;
  capturedOn: string;
  value: number;
  source: SourceType;
  confidence: Confidence;
}

export interface ScoreInput {
  /** 계산 기준일 (YYYY-MM-DD, KST) */
  asOf: string;
  product: { id: string; name: string; metrics: ScoreProductMetrics | null };
  /** 점수 맥락 키워드 (없으면 키워드 기반 요소는 미계산) */
  keyword: { id: string; keyword: string; metrics: ScoreKeywordMetrics | null } | null;
  competitors: ScoreCompetitor[];
  /** 같은 종류끼리만 비교한다 (월 환산 판매량) */
  salesHistory: { actual: HistoryPoint[]; estimated: HistoryPoint[] };
  priceHistory: HistoryPoint[];
  /** 대표 시나리오의 현재 수익성 결과 (PHASE 6) */
  margin: {
    scenarioId: string;
    scenarioName: string;
    calculationId: string;
    formulaVersion: string;
    netMarginRate: number | null;
    salePrice: number | null;
    calculatedAt: string;
  } | null;
}

export interface ScoringConfig {
  version: string;
  weights: Record<ScoreFactor, number>;
  thresholds: { strongBuy: number; review: number };
  labels: Record<ScoreFactor, string>;
}

// 출력 --------------------------------------------------------------------------------

export interface FactorInputRef {
  name: string;
  value: number | string | null;
  source?: SourceType;
  confidence?: Confidence;
  capturedOn?: string;
  ref?: string | number;
}

export interface FactorResult {
  factor: ScoreFactor;
  label: string;
  weight: number;
  /** 0~100. null = 데이터 부족으로 미계산 */
  score: number | null;
  /** weight × score ÷ 100 */
  points: number | null;
  basis: string;
  inputs: FactorInputRef[];
  /** 미계산 이유 (필요한 데이터) */
  missing: string[];
}

export interface ScoreResult {
  engineVersion: typeof SCORE_ENGINE_VERSION;
  scoringVersion: string;
  factors: FactorResult[];
  /** 9개 요소가 모두 계산됐는가 */
  complete: boolean;
  total: number | null;
  verdict: Verdict | null;
  /** 계산된 요소의 점수 합 */
  knownPoints: number;
  /** 계산된 요소의 가중치 합 */
  knownWeight: number;
  /** 미계산 요소가 모두 0점 ~ 모두 만점일 때 총점 범위 */
  range: { min: number; max: number };
  /** 범위 전체가 같은 판정 구간이면 그 판정 (데이터가 부족해도 결론이 바뀌지 않는 경우) */
  verdictIfCertain: Verdict | null;
  missingFactors: ScoreFactor[];
  /** 사용한 입력 중 가장 낮은 신뢰도 */
  dataConfidence: Confidence | null;
  /** 사용한 현재 값 입력의 수집일 범위 (이력 비교 요소 제외) */
  dateRange: { from: string; to: string; days: number } | null;
  reasons: ScoreReason[];
}

// 정규화 구간 (score-engine-v1) ------------------------------------------------------------
// [x, y] 점을 잇는 구간 선형. 구간 밖은 끝 값으로 고정.

export const RULES = {
  /** 월 검색량 → 수요 */
  demandVolume: [[0, 0], [1_000, 20], [5_000, 50], [20_000, 80], [50_000, 100]],
  /** 검색량 증감률 → 수요 가감 (±10점) */
  demandTrendMax: 10,
  /** 월 환산 판매량(시장 중앙값) → 판매량 */
  salesMonthly: [[0, 0], [30, 20], [100, 50], [300, 80], [1_000, 100]],
  /** 판매량 증감률 → 성장 */
  growthRate: [[-0.5, 0], [0, 50], [0.5, 80], [1, 100]],
  /** 성장률 비교 최소 간격 · 최대 기간 (일) */
  growthMinGapDays: 7,
  growthMaxSpanDays: 90,
  /** 상품 수 ÷ 검색량 → 경쟁 (낮을수록 쉬움) */
  competitionIntensity: [[0.5, 100], [1, 80], [3, 50], [10, 20], [30, 0]],
  /** 최다 브랜드 점유율 → 경쟁 */
  brandConcentration: [[0.1, 100], [0.3, 60], [0.6, 0]],
  /** 내 판매가 ÷ 경쟁상품 가격 중앙값 → 경쟁 */
  priceRatio: [[0.9, 100], [1, 70], [1.2, 30], [1.5, 0]],
  /** 상위권 WING 판매자 비율 → WING 진입 */
  wingRatio: [[0, 0], [0.2, 40], [0.5, 80], [0.7, 100]],
  /** 경쟁상품 판매자 유형으로 WING 비율을 셀 때 최소 표본 */
  wingMinSample: 3,
  /** 리뷰 수 중앙값 → 리뷰 장벽 (적을수록 쉬움) */
  reviewCount: [[50, 100], [200, 80], [1_000, 50], [3_000, 20], [10_000, 0]],
  /** 전환율 → 전환 */
  conversionRate: [[0, 0], [0.02, 40], [0.05, 70], [0.1, 100]],
  /** 순이익률 → 마진 */
  marginRate: [[0, 0], [0.1, 30], [0.2, 60], [0.3, 85], [0.4, 100]],
  /** 가격 변동계수 → 시장 안정성 */
  priceCv: [[0.02, 100], [0.05, 80], [0.1, 50], [0.25, 0]],
  stabilityMinPoints: 3,
  stabilitySpanDays: 180,
} as const;

type Curve = readonly (readonly [number, number])[];

export function interpolate(x: number, curve: Curve): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i += 1) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp100 = (n: number) => Math.min(100, Math.max(0, n));

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function ref(name: string, p: DataPoint | DataPoint<string> | null | undefined, extra: Partial<FactorInputRef> = {}): FactorInputRef {
  return { name, value: p?.value ?? null, source: p?.source, confidence: p?.confidence, capturedOn: p?.collectedAt, ...extra };
}

/** 판매량을 30일 기준으로 환산. 집계 기간을 모르면 null */
export function monthlyUnits(p: PeriodPoint | null): number | null {
  if (!p || p.value == null || !p.periodDays) return null;
  return (p.value * 30) / p.periodDays;
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const n0 = (v: number) => Math.round(v).toLocaleString("ko-KR");

// 요소별 계산 ---------------------------------------------------------------------------

type Partial9 = Omit<FactorResult, "factor" | "label" | "weight" | "points">;
const missing = (basis: string, need: string[], inputs: FactorInputRef[] = []): Partial9 => ({ score: null, basis, inputs, missing: need });

function scoreDemand(i: ScoreInput): Partial9 {
  if (!i.keyword) return missing("점수 맥락 키워드가 없습니다", ["키워드 연결"]);
  const vol = i.keyword.metrics?.searchVolume ?? null;
  const growth = i.keyword.metrics?.searchGrowthRate ?? null;
  const inputs = [ref("월 검색량", vol), ref("검색량 증감률", growth)];
  if (vol?.value == null) return missing(`"${i.keyword.keyword}" 월 검색량 없음`, ["키워드 월 검색량"], inputs);
  let score = interpolate(vol.value, RULES.demandVolume);
  let basis = `"${i.keyword.keyword}" 월 검색량 ${n0(vol.value)}`;
  if (growth?.value != null) {
    const adj = Math.max(-RULES.demandTrendMax, Math.min(RULES.demandTrendMax, growth.value * 20));
    score += adj;
    basis += ` · 추세 ${growth.value >= 0 ? "+" : ""}${pct(growth.value)}`;
  } else {
    basis += " · 추세 데이터 없음 (가감 없음)";
  }
  return { score: clamp100(score), basis, inputs, missing: [] };
}

/** 상품 1개의 판매량: 실제 우선, 없으면 추정. 예측은 쓰지 않는다 */
function pickSales(m: ScoreProductMetrics | null): { monthly: number; kind: "실제" | "추정"; point: PeriodPoint } | null {
  const actual = monthlyUnits(m?.salesActual ?? null);
  if (actual != null) return { monthly: actual, kind: "실제", point: m!.salesActual! };
  const est = monthlyUnits(m?.salesEstimated ?? null);
  if (est != null) return { monthly: est, kind: "추정", point: m!.salesEstimated! };
  return null;
}

function activeCompetitors(i: ScoreInput) {
  return i.competitors.filter((c) => c.isActive);
}

function scoreSales(i: ScoreInput): Partial9 {
  const items = [
    { name: `대상: ${i.product.name}`, m: i.product.metrics },
    ...activeCompetitors(i).map((c) => ({ name: `경쟁(${c.relationType}): ${c.productName}`, m: c.metrics })),
  ];
  const inputs: FactorInputRef[] = [];
  const values: number[] = [];
  const kinds = new Set<string>();
  for (const it of items) {
    const s = pickSales(it.m);
    if (!s) continue;
    values.push(s.monthly);
    kinds.add(s.kind);
    inputs.push(ref(`${it.name} (${s.kind}, ${s.point.periodDays}일)`, s.point, { value: s.point.value }));
  }
  const med = median(values);
  if (med == null) return missing("대상·경쟁상품 모두 실제/추정 판매량(집계 기간 포함) 없음", ["실제 또는 추정 판매량"]);
  return {
    score: interpolate(med, RULES.salesMonthly),
    basis: `월 환산 판매량 중앙값 ${n0(med)}개 (${values.length}개 상품, ${[...kinds].join("·")})`,
    inputs,
    missing: [],
  };
}

function scoreGrowth(i: ScoreInput): Partial9 {
  for (const [kind, series] of [["실제", i.salesHistory.actual], ["추정", i.salesHistory.estimated]] as const) {
    const recent = series
      .filter((p) => daysBetween(p.capturedOn, i.asOf) <= RULES.growthMaxSpanDays)
      .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
    if (recent.length < 2) continue;
    const latest = recent[recent.length - 1];
    const base = recent[0];
    if (daysBetween(base.capturedOn, latest.capturedOn) < RULES.growthMinGapDays) continue;
    const inputs: FactorInputRef[] = [base, latest].map((p) => ({
      name: `${kind} 월 환산 판매량`,
      value: round2(p.value),
      source: p.source,
      confidence: p.confidence,
      capturedOn: p.capturedOn,
      ref: p.snapshotId,
    }));
    let score: number;
    let basis: string;
    if (base.value === 0) {
      score = latest.value > 0 ? 100 : 50;
      basis = `${kind} 판매량 ${base.capturedOn} 0개 → ${latest.capturedOn} ${n0(latest.value)}개`;
    } else {
      const rate = (latest.value - base.value) / base.value;
      score = interpolate(rate, RULES.growthRate);
      basis = `${kind} 판매량 ${base.capturedOn} → ${latest.capturedOn} ${rate >= 0 ? "+" : ""}${pct(rate)}`;
    }
    return { score, basis, inputs, missing: [] };
  }
  return missing(
    `같은 종류(실제 또는 추정) 판매량이 ${RULES.growthMinGapDays}일 이상 간격으로 2번 이상 필요 (최근 ${RULES.growthMaxSpanDays}일)`,
    ["판매량 이력 2회 이상"],
  );
}

/** 경쟁상품 가격 비교에 쓰는 내 판매가: 대표 시나리오 판매가 → 현재 판매가 */
function plannedPrice(i: ScoreInput): { value: number; label: string } | null {
  if (i.margin?.salePrice != null) return { value: i.margin.salePrice, label: `대표 시나리오 "${i.margin.scenarioName}" 판매가` };
  const p = i.product.metrics?.price?.value;
  return p != null ? { value: p, label: "현재 판매가" } : null;
}

function scoreCompetition(i: ScoreInput): Partial9 {
  const subs: { score: number; text: string }[] = [];
  const inputs: FactorInputRef[] = [];
  const km = i.keyword?.metrics;
  if (km?.competitionIntensity?.value != null) {
    subs.push({ score: interpolate(km.competitionIntensity.value, RULES.competitionIntensity), text: `상품수/검색량 ${km.competitionIntensity.value.toFixed(2)}` });
  }
  inputs.push(ref("상품수/검색량", km?.competitionIntensity));
  if (km?.brandConcentration?.value != null) {
    subs.push({ score: interpolate(km.brandConcentration.value, RULES.brandConcentration), text: `브랜드 집중도 ${pct(km.brandConcentration.value)}` });
  }
  inputs.push(ref("브랜드 집중도", km?.brandConcentration));

  const prices = activeCompetitors(i)
    .map((c) => c.metrics?.price)
    .filter((p): p is DataPoint => p?.value != null);
  const mine = plannedPrice(i);
  const medPrice = median(prices.map((p) => p.value!));
  if (mine && medPrice) {
    const ratio = mine.value / medPrice;
    subs.push({ score: interpolate(ratio, RULES.priceRatio), text: `가격 비율 ${ratio.toFixed(2)} (${mine.label} ÷ 경쟁 ${prices.length}개 중앙값)` });
    inputs.push({ name: mine.label, value: mine.value }, { name: "경쟁상품 가격 중앙값", value: medPrice });
  }
  if (subs.length === 0) {
    return missing("키워드 상품수/검색량 · 브랜드 집중도 · 경쟁상품 가격이 모두 없음", ["키워드 경쟁 지표 또는 경쟁상품 가격"], inputs);
  }
  return {
    score: subs.reduce((s, x) => s + x.score, 0) / subs.length,
    basis: `${subs.map((s) => s.text).join(" · ")} (높을수록 진입 쉬움, ${subs.length}개 지표 평균)`,
    inputs,
    missing: [],
  };
}

function scoreWing(i: ScoreInput): Partial9 {
  const w = i.keyword?.metrics?.wingRatio;
  if (w?.value != null) {
    return { score: interpolate(w.value, RULES.wingRatio), basis: `"${i.keyword!.keyword}" 상위권 WING 비율 ${pct(w.value)}`, inputs: [ref("WING 비율", w)], missing: [] };
  }
  const known = activeCompetitors(i)
    .map((c) => ({ c, t: c.metrics?.sellerTypeObserved }))
    .filter((x) => x.t?.value && x.t.value !== "UNKNOWN");
  if (known.length >= RULES.wingMinSample) {
    const ratio = known.filter((x) => x.t!.value === "WING_SELLER").length / known.length;
    return {
      score: interpolate(ratio, RULES.wingRatio),
      basis: `활성 경쟁상품 ${known.length}개 중 WING 판매자 ${pct(ratio)} (키워드 WING 비율 없음)`,
      inputs: known.map((x) => ref(`판매자 유형: ${x.c.productName}`, x.t)),
      missing: [],
    };
  }
  return missing(
    `키워드 WING 비율 없음, 판매자 유형을 아는 활성 경쟁상품 ${known.length}개 (최소 ${RULES.wingMinSample}개)`,
    ["키워드 WING 비율 또는 경쟁상품 판매자 유형"],
  );
}

function scoreReviewBarrier(i: ScoreInput): Partial9 {
  const reviews = activeCompetitors(i)
    .map((c) => ({ c, p: c.metrics?.reviewCount }))
    .filter((x) => x.p?.value != null);
  if (reviews.length > 0) {
    const med = median(reviews.map((x) => x.p!.value!))!;
    return {
      score: interpolate(med, RULES.reviewCount),
      basis: `활성 경쟁상품 ${reviews.length}개 리뷰 수 중앙값 ${n0(med)}개`,
      inputs: reviews.map((x) => ref(`리뷰: ${x.c.productName} (${x.c.relationType})`, x.p)),
      missing: [],
    };
  }
  const avg = i.keyword?.metrics?.averageReviews;
  if (avg?.value != null) {
    return { score: interpolate(avg.value, RULES.reviewCount), basis: `"${i.keyword!.keyword}" 상위 상품 평균 리뷰 ${n0(avg.value)}개 (경쟁상품 리뷰 없음)`, inputs: [ref("평균 리뷰", avg)], missing: [] };
  }
  return missing("활성 경쟁상품 리뷰 수 · 키워드 평균 리뷰가 모두 없음", ["경쟁상품 리뷰 수 또는 키워드 평균 리뷰"]);
}

function scoreConversion(i: ScoreInput): Partial9 {
  const items = [
    { name: `대상: ${i.product.name}`, p: i.product.metrics?.conversionRate },
    ...activeCompetitors(i).map((c) => ({ name: `경쟁: ${c.productName}`, p: c.metrics?.conversionRate })),
  ].filter((x) => x.p?.value != null);
  if (items.length === 0) return missing("대상·경쟁상품 전환율 데이터 없음 (임의 전환율을 만들지 않음)", ["전환율 (WING 등)"]);
  const med = median(items.map((x) => x.p!.value!))!;
  return {
    score: interpolate(med, RULES.conversionRate),
    basis: `전환율 중앙값 ${pct(med)} (${items.length}개 상품)`,
    inputs: items.map((x) => ref(x.name, x.p)),
    missing: [],
  };
}

function scoreMargin(i: ScoreInput): Partial9 {
  if (!i.margin) return missing("대표 수익성 시나리오의 현재 계산 결과 없음", ["수익성 계산 (대표 시나리오)"]);
  const inputs: FactorInputRef[] = [
    { name: `순이익률 ("${i.margin.scenarioName}", ${i.margin.formulaVersion})`, value: i.margin.netMarginRate, source: "CALCULATED", capturedOn: i.margin.calculatedAt.slice(0, 10), ref: i.margin.calculationId },
  ];
  if (i.margin.netMarginRate == null) return missing("대표 시나리오 순이익률 없음 (판매가 0 등)", ["순이익률"], inputs);
  return { score: interpolate(i.margin.netMarginRate, RULES.marginRate), basis: `대표 시나리오 "${i.margin.scenarioName}" 순이익률 ${pct(i.margin.netMarginRate)}`, inputs, missing: [] };
}

function scoreStability(i: ScoreInput): Partial9 {
  const pts = i.priceHistory.filter((p) => daysBetween(p.capturedOn, i.asOf) <= RULES.stabilitySpanDays);
  if (pts.length < RULES.stabilityMinPoints) {
    return missing(`최근 ${RULES.stabilitySpanDays}일 가격 기록 ${pts.length}회 (최소 ${RULES.stabilityMinPoints}회)`, ["가격 이력 3회 이상"]);
  }
  const vals = pts.map((p) => p.value);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  if (mean <= 0) return missing("평균 가격이 0", ["가격 이력"]);
  const cv = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) / mean;
  return {
    score: interpolate(cv, RULES.priceCv),
    basis: `가격 변동계수 ${pct(cv)} (${pts.length}회 기록, 평균 ${n0(mean)}원)`,
    inputs: pts.map((p) => ({ name: "가격", value: p.value, source: p.source, confidence: p.confidence, capturedOn: p.capturedOn, ref: p.snapshotId })),
    missing: [],
  };
}

const CALCULATORS: Record<ScoreFactor, (i: ScoreInput) => Partial9> = {
  demand: scoreDemand,
  salesVolume: scoreSales,
  salesGrowth: scoreGrowth,
  competition: scoreCompetition,
  wingEntry: scoreWing,
  reviewBarrier: scoreReviewBarrier,
  conversion: scoreConversion,
  margin: scoreMargin,
  marketStability: scoreStability,
};

const CONF_ORDER: Confidence[] = ["A", "B", "C"];
const HISTORY_FACTORS: ScoreFactor[] = ["salesGrowth", "marketStability"];

export function verdictFor(score: number, t: { strongBuy: number; review: number }): Verdict {
  if (score >= t.strongBuy) return "STRONG_BUY";
  if (score >= t.review) return "REVIEW";
  return "EXCLUDE";
}

export function calculateOpportunityScore(input: ScoreInput, config: ScoringConfig): ScoreResult {
  const factors: FactorResult[] = (Object.keys(CALCULATORS) as ScoreFactor[]).map((factor) => {
    const r = CALCULATORS[factor](input);
    const weight = config.weights[factor];
    const score = r.score == null ? null : round2(clamp100(r.score));
    return { factor, label: config.labels[factor], weight, ...r, score, points: score == null ? null : round2((weight * score) / 100) };
  });

  const known = factors.filter((f) => f.score != null);
  const knownPoints = round2(known.reduce((s, f) => s + f.points!, 0));
  const knownWeight = known.reduce((s, f) => s + f.weight, 0);
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const missingFactors = factors.filter((f) => f.score == null).map((f) => f.factor);
  const complete = missingFactors.length === 0;
  const range = { min: knownPoints, max: round2(Math.min(100, knownPoints + (totalWeight - knownWeight))) };
  const total = complete ? round2(clamp100(knownPoints)) : null;
  const verdict = total == null ? null : verdictFor(total, config.thresholds);
  const vMin = verdictFor(range.min, config.thresholds);
  const verdictIfCertain = vMin === verdictFor(range.max, config.thresholds) ? vMin : null;

  // 사용한 입력의 신뢰도·수집일
  const used = known.flatMap((f) => f.inputs).filter((x) => x.value != null);
  const confs = used.map((x) => x.confidence).filter((c): c is Confidence => !!c);
  const dataConfidence = confs.length ? CONF_ORDER[Math.max(...confs.map((c) => CONF_ORDER.indexOf(c)))] : null;
  // 수집일 범위는 "현재 값" 입력만 본다. 성장·안정성은 원래 여러 날짜의 이력을 비교하는 요소라 제외
  const dates = known
    .filter((f) => !HISTORY_FACTORS.includes(f.factor))
    .flatMap((f) => f.inputs)
    .filter((x) => x.value != null)
    .map((x) => x.capturedOn)
    .filter((d): d is string => !!d)
    .sort();
  const dateRange = dates.length ? { from: dates[0], to: dates[dates.length - 1], days: daysBetween(dates[0], dates[dates.length - 1]) } : null;

  const reasons: ScoreReason[] = [];
  for (const f of known) {
    if (f.score! >= 70) reasons.push({ kind: "POSITIVE", message: `${f.label}: ${f.basis}` });
    else if (f.score! <= 30) reasons.push({ kind: "CAUTION", message: `${f.label}: ${f.basis}` });
  }
  if (!complete) {
    reasons.push({ kind: "CAUTION", message: `분석 데이터 부족: ${factors.filter((f) => f.score == null).map((f) => f.label).join(", ")} 미계산` });
  }
  if (dateRange && dateRange.days > 30) {
    reasons.push({ kind: "CAUTION", message: `사용한 데이터의 수집일 차이가 ${dateRange.days}일입니다 (${dateRange.from} ~ ${dateRange.to})` });
  }
  if (dataConfidence === "C") reasons.push({ kind: "CAUTION", message: "참고용 추정(C) 데이터가 포함되어 있습니다" });

  return {
    engineVersion: SCORE_ENGINE_VERSION,
    scoringVersion: config.version,
    factors,
    complete,
    total,
    verdict,
    knownPoints,
    knownWeight,
    range,
    verdictIfCertain,
    missingFactors,
    dataConfidence,
    dateRange,
    reasons,
  };
}
