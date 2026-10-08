// npm run test:score — src/lib/scoring/engine.ts 순수 함수 검증 (Node 내장 assert)
import assert from "node:assert/strict";

import { DEFAULT_SCORE_WEIGHTS, SCORE_FACTORS, VERDICT_THRESHOLDS, totalWeight } from "../../src/config/scoring-weights.ts";
import { calculateOpportunityScore, interpolate, median, monthlyUnits, RULES } from "../../src/lib/scoring/engine.ts";

const config = {
  version: "v1",
  weights: Object.fromEntries(SCORE_FACTORS.map((k) => [k, DEFAULT_SCORE_WEIGHTS[k].weight])),
  thresholds: { ...VERDICT_THRESHOLDS },
  labels: Object.fromEntries(SCORE_FACTORS.map((k) => [k, DEFAULT_SCORE_WEIGHTS[k].label])),
};

const dp = (value, extra = {}) => ({ value, source: "MANUAL", confidence: "B", collectedAt: "2026-10-01", ...extra });
const period = (value, periodDays = 30, extra = {}) => ({ ...dp(value, extra), periodDays });
const hist = (capturedOn, value, id = 1) => ({ snapshotId: id, capturedOn, value, source: "MANUAL", confidence: "B" });

const emptyMetrics = { price: null, reviewCount: null, salesActual: null, salesEstimated: null, conversionRate: null, sellerTypeObserved: null };

/** 모든 요소가 최고점이 나오는 입력 */
function best() {
  return {
    asOf: "2026-10-07",
    product: { id: "p", name: "대상", metrics: { ...emptyMetrics, price: dp(9000), salesActual: period(2000), conversionRate: dp(0.2) } },
    keyword: {
      id: "k",
      keyword: "실리콘 트레이",
      metrics: {
        searchVolume: dp(80000),
        searchGrowthRate: dp(0.5),
        competitionIntensity: dp(0.2),
        brandConcentration: dp(0.05),
        wingRatio: dp(0.9),
        averageReviews: dp(10),
      },
    },
    competitors: [
      { productId: "c1", productName: "경쟁1", relationType: "SIMILAR", isActive: true, metrics: { ...emptyMetrics, price: dp(12000), reviewCount: dp(10), salesActual: period(2000) } },
    ],
    salesHistory: { actual: [hist("2026-08-01", 100, 1), hist("2026-10-01", 300, 2)], estimated: [] },
    priceHistory: [hist("2026-09-01", 9000, 1), hist("2026-09-15", 9000, 2), hist("2026-10-01", 9000, 3)],
    margin: { scenarioId: "s", scenarioName: "기본", calculationId: "c", formulaVersion: "profit-v1", netMarginRate: 0.5, salePrice: 9000, calculatedAt: "2026-10-05T00:00:00Z" },
  };
}

/** 모든 요소가 최저점이 나오는 입력 */
function worst() {
  const i = best();
  i.keyword.metrics = {
    searchVolume: dp(0),
    searchGrowthRate: dp(-1),
    competitionIntensity: dp(100),
    brandConcentration: dp(0.9),
    wingRatio: dp(0),
    averageReviews: dp(50000),
  };
  i.product.metrics = { ...emptyMetrics, price: dp(30000), salesActual: period(0), conversionRate: dp(0) };
  i.competitors = [{ ...i.competitors[0], metrics: { ...emptyMetrics, price: dp(10000), reviewCount: dp(50000), salesActual: period(0) } }];
  i.salesHistory = { actual: [hist("2026-08-01", 100), hist("2026-10-01", 0)], estimated: [] };
  i.priceHistory = [hist("2026-09-01", 1000), hist("2026-09-15", 10000), hist("2026-10-01", 1000)];
  i.margin = { ...i.margin, netMarginRate: -0.2, salePrice: 30000 };
  return i;
}

const f = (r, key) => r.factors.find((x) => x.factor === key);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("가중치 합 100 · V1 값 그대로 (15/15/10/15/10/10/5/15/5)", () => {
  assert.equal(totalWeight(), 100);
  assert.deepEqual(SCORE_FACTORS.map((k) => DEFAULT_SCORE_WEIGHTS[k].weight), [15, 15, 10, 15, 10, 10, 5, 15, 5]);
  assert.deepEqual(VERDICT_THRESHOLDS, { strongBuy: 80, review: 60 });
});

test("최대점수: 9개 모두 100 → 총점 100, STRONG_BUY", () => {
  const r = calculateOpportunityScore(best(), config);
  assert.equal(r.complete, true);
  for (const x of r.factors) assert.equal(x.score, 100, `${x.factor} ${x.score} ${x.basis}`);
  assert.equal(r.total, 100);
  assert.equal(r.verdict, "STRONG_BUY");
  assert.deepEqual(r.missingFactors, []);
});

test("최소점수: 9개 모두 0 → 총점 0, EXCLUDE (데이터가 있는 실제 0)", () => {
  const r = calculateOpportunityScore(worst(), config);
  assert.equal(r.complete, true);
  for (const x of r.factors) assert.equal(x.score, 0, `${x.factor} ${x.score} ${x.basis}`);
  assert.equal(r.total, 0);
  assert.equal(r.verdict, "EXCLUDE");
});

test("총점 = Σ 가중치 × 요소점수 ÷ 100, 100 초과 없음", () => {
  const i = best();
  i.keyword.metrics.searchVolume = dp(5000); // 50 + 추세 10 = 60
  const r = calculateOpportunityScore(i, config);
  assert.equal(f(r, "demand").score, 60);
  assert.equal(f(r, "demand").points, 9);
  assert.equal(r.total, 100 - 15 + 9);
  assert.ok(r.total <= 100);
});

test("판정: 총점 85 → STRONG_BUY, 총점 10 → EXCLUDE", () => {
  // 마진(15) 하나로 총점을 조절: 다른 요소 100 → 85 + 15 × m/100
  const at = (marginRate) => {
    const i = best();
    i.margin.netMarginRate = marginRate;
    return calculateOpportunityScore(i, config);
  };
  // 마진 점수 0 → 총점 85 → STRONG_BUY
  assert.equal(at(0).total, 85);
  assert.equal(at(0).verdict, "STRONG_BUY");
  // 수요·판매량·경쟁·마진을 0 으로: 100 − 60 = 40 → EXCLUDE
  const i = worst();
  const b = best();
  i.keyword.metrics.wingRatio = b.keyword.metrics.wingRatio;
  const r = calculateOpportunityScore(i, config);
  assert.equal(r.total, 10);
  assert.equal(r.verdict, "EXCLUDE");
});

test("판정 함수 경계값", async () => {
  const { verdictFor } = await import("../../src/lib/scoring/engine.ts");
  const t = config.thresholds;
  assert.equal(verdictFor(80, t), "STRONG_BUY");
  assert.equal(verdictFor(79.99, t), "REVIEW");
  assert.equal(verdictFor(60, t), "REVIEW");
  assert.equal(verdictFor(59.99, t), "EXCLUDE");
});

test("REVIEW 사례: 총점 60~79", () => {
  const i = best();
  i.margin.netMarginRate = 0; // -15
  i.keyword.metrics.searchVolume = dp(0); // demand 0 + 10 = 10 → -13.5
  const r = calculateOpportunityScore(i, config);
  assert.equal(r.total, 71.5);
  assert.equal(r.verdict, "REVIEW");
});

test("데이터 부족: 키워드 없음 → 수요·WING 등 미계산, 총점·판정 null", () => {
  const i = best();
  i.keyword = null;
  i.competitors = [];
  const r = calculateOpportunityScore(i, config);
  assert.equal(r.complete, false);
  assert.equal(r.total, null);
  assert.equal(r.verdict, null);
  assert.ok(r.missingFactors.includes("demand"));
  assert.ok(r.missingFactors.includes("wingEntry"));
  assert.ok(r.missingFactors.includes("reviewBarrier"));
  assert.equal(f(r, "demand").points, null);
  assert.ok(r.reasons.some((x) => x.message.startsWith("분석 데이터 부족")));
});

test("NULL ≠ 0: 판매량 NULL 은 미계산, 실제 0 은 0점", () => {
  const i = best();
  i.product.metrics.salesActual = null;
  i.competitors[0].metrics.salesActual = null;
  assert.equal(f(calculateOpportunityScore(i, config), "salesVolume").score, null);
  i.product.metrics.salesActual = period(0);
  i.competitors[0].metrics.salesActual = period(0);
  assert.equal(f(calculateOpportunityScore(i, config), "salesVolume").score, 0);
});

test("판매량: 실제 우선, 없으면 추정 · 예측은 입력에 없음 · 기간 환산", () => {
  const i = best();
  i.competitors = [];
  i.product.metrics.salesActual = null;
  i.product.metrics.salesEstimated = period(50, 15); // 월 100
  const r = f(calculateOpportunityScore(i, config), "salesVolume");
  assert.equal(r.score, 50);
  assert.ok(r.basis.includes("추정"));
  assert.equal(monthlyUnits(period(50, 15)), 100);
  assert.equal(monthlyUnits({ ...dp(50), periodDays: null }), null);
});

test("데이터 부족이어도 판정이 확정되는 경우 (범위 전체가 같은 구간)", () => {
  const i = best();
  i.product.metrics.conversionRate = null; // 전환(5) 미계산
  i.competitors[0].metrics.conversionRate = null;
  const r = calculateOpportunityScore(i, config);
  assert.equal(r.total, null);
  assert.deepEqual(r.range, { min: 95, max: 100 });
  assert.equal(r.verdictIfCertain, "STRONG_BUY");
  const w = worst();
  w.product.metrics.conversionRate = null;
  w.competitors[0].metrics.conversionRate = null;
  assert.equal(calculateOpportunityScore(w, config).verdictIfCertain, "EXCLUDE");
});

test("범위가 판정 경계를 넘으면 확정 판정 없음", () => {
  const i = best();
  i.keyword = null; // 수요 15 + 경쟁(키워드 지표) 일부 + WING 10 …
  i.competitors = [];
  const r = calculateOpportunityScore(i, config);
  assert.ok(r.range.min < 80 && r.range.max >= 80);
  assert.equal(r.verdictIfCertain, null);
});

test("해제된 경쟁관계는 제외", () => {
  const i = best();
  i.competitors[0].isActive = false;
  i.keyword.metrics.averageReviews = null;
  const r = calculateOpportunityScore(i, config);
  assert.equal(f(r, "reviewBarrier").score, null);
});

test("관계 유형은 입력 근거에 남고 가중치는 없음", () => {
  const i = best();
  i.keyword.metrics.averageReviews = null;
  i.competitors.push({ productId: "c2", productName: "경쟁2", relationType: "SAME_PRODUCT", isActive: true, metrics: { ...emptyMetrics, reviewCount: dp(1000) } });
  const r = f(calculateOpportunityScore(i, config), "reviewBarrier");
  assert.equal(r.score, Math.round(interpolate(median([10, 1000]), RULES.reviewCount) * 100) / 100);
  assert.ok(r.inputs.some((x) => x.name.includes("SAME_PRODUCT")));
});

test("성장: 7일 미만 간격 · 종류 혼합은 비교하지 않음", () => {
  const i = best();
  i.salesHistory = { actual: [hist("2026-10-01", 100)], estimated: [hist("2026-10-03", 300)] };
  assert.equal(f(calculateOpportunityScore(i, config), "salesGrowth").score, null);
  i.salesHistory = { actual: [hist("2026-09-28", 100), hist("2026-10-01", 300)], estimated: [] };
  assert.equal(f(calculateOpportunityScore(i, config), "salesGrowth").score, null);
  i.salesHistory = { actual: [hist("2026-09-01", 100), hist("2026-10-01", 100)], estimated: [] };
  assert.equal(f(calculateOpportunityScore(i, config), "salesGrowth").score, 50);
});

test("WING: 키워드 비율 없으면 경쟁상품 판매자 유형 (3개 이상)", () => {
  const i = best();
  i.keyword.metrics.wingRatio = null;
  const c = (id, t) => ({ productId: id, productName: id, relationType: "SIMILAR", isActive: true, metrics: { ...emptyMetrics, sellerTypeObserved: dp(t) } });
  i.competitors = [c("a", "WING_SELLER"), c("b", "COUPANG_RETAIL")];
  assert.equal(f(calculateOpportunityScore(i, config), "wingEntry").score, null);
  i.competitors.push(c("d", "WING_SELLER"), c("e", "UNKNOWN"));
  const r = f(calculateOpportunityScore(i, config), "wingEntry");
  assert.equal(r.score, Math.round(interpolate(2 / 3, RULES.wingRatio) * 100) / 100);
});

test("전환율 데이터 없으면 미계산 (임의 값 없음)", () => {
  const i = best();
  i.product.metrics.conversionRate = null;
  const r = f(calculateOpportunityScore(i, config), "conversion");
  assert.equal(r.score, null);
  assert.deepEqual(r.inputs, []);
});

test("마진: 대표 시나리오 결과 없으면 미계산, 있으면 PHASE 6 순이익률 그대로", () => {
  const i = best();
  i.margin = null;
  assert.equal(f(calculateOpportunityScore(i, config), "margin").score, null);
  const j = best();
  j.margin.netMarginRate = 0.2736;
  const r = f(calculateOpportunityScore(j, config), "margin");
  assert.equal(r.score, Math.round(interpolate(0.2736, RULES.marginRate) * 100) / 100);
  assert.equal(r.inputs[0].ref, "c");
});

test("시장 안정성: 가격 기록 3회 미만이면 미계산", () => {
  const i = best();
  i.priceHistory = i.priceHistory.slice(0, 2);
  assert.equal(f(calculateOpportunityScore(i, config), "marketStability").score, null);
});

test("데이터 신뢰도 = 사용한 입력 중 최저, 수집일 범위 기록", () => {
  const i = best();
  i.keyword.metrics.searchVolume = dp(80000, { confidence: "C", collectedAt: "2026-07-01" });
  const r = calculateOpportunityScore(i, config);
  assert.equal(r.dataConfidence, "C");
  assert.equal(r.dateRange.from, "2026-07-01");
  assert.ok(r.reasons.some((x) => x.message.includes("수집일 차이")));
});

test("수집일 범위: 성장·안정성 이력은 제외 (이력 비교는 원래 날짜가 다름)", () => {
  const r = calculateOpportunityScore(best(), config);
  // best() 의 현재 값은 2026-10-01, 마진 계산일 2026-10-05 · 이력은 08-01 부터
  assert.equal(r.dateRange.from, "2026-10-01");
  assert.ok(!r.reasons.some((x) => x.message.includes("수집일 차이")));
});

test("구간 선형 보간 · 중앙값", () => {
  assert.equal(interpolate(3000, RULES.demandVolume), 35);
  assert.equal(interpolate(-5, RULES.demandVolume), 0);
  assert.equal(interpolate(1e9, RULES.demandVolume), 100);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\nOpportunity Score ${passed}/${tests.length}`);
