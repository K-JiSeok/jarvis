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

// PHASE 13: 실제 수집 데이터 형태로 3개 상품 비교 (엔진 · 정규화 그대로, 기대값은 RULES 구간을 손으로 계산한 값)
// 공통: 키워드 1페이지 집계(평균 리뷰 1,113.3) · 가격 이력 10,000 / 10,200 / 9,800 · 대표 시나리오 순이익률 25% · 판매가 10,500
// 경쟁상품 A(11,000원 · 리뷰 500 · WING) B(12,000 · 1,500 · 직매입) C(9,000 · 3,000 · 로켓그로스)
const P13_HISTORY = [hist("2026-09-10", 10000, 11), hist("2026-09-20", 10200, 12), hist("2026-10-01", 9800, 13)];
const P13_COMPETITORS = [
  ["A", 11000, 500, "WING_SELLER"],
  ["B", 12000, 1500, "COUPANG_RETAIL"],
  ["C", 9000, 3000, "ROCKET_GROWTH_SELLER"],
].map(([name, price, reviews, seller]) => ({
  productId: name,
  productName: name,
  relationType: "SIMILAR",
  isActive: true,
  metrics: { ...emptyMetrics, price: dp(price), reviewCount: dp(reviews), sellerTypeObserved: dp(seller) },
}));
function p13(keywordMetrics, competitors) {
  return {
    asOf: "2026-10-08",
    product: { id: "t", name: "대상", metrics: { ...emptyMetrics, price: dp(9800), reviewCount: dp(10) } },
    keyword: {
      id: "k",
      keyword: "[TEST] 캠핑의자",
      metrics: { searchVolume: null, searchGrowthRate: null, competitionIntensity: null, brandConcentration: null, wingRatio: null, averageReviews: dp(1113.3), ...keywordMetrics },
    },
    competitors,
    salesHistory: { actual: [], estimated: [] },
    priceHistory: P13_HISTORY,
    margin: { scenarioId: "s", scenarioName: "기본", calculationId: "c", formulaVersion: "profit-v1", netMarginRate: 0.25, salePrice: 10500, calculatedAt: "2026-10-08T00:00:00Z" },
  };
}
const scoresOf = (r) => Object.fromEntries(r.factors.map((f) => [f.factor, f.score]));

test("PHASE 13 T1 검색량 없음 · 경쟁상품 연결 없음 → 수요 · 경쟁 · WING 미계산, 리뷰 장벽은 키워드 평균 리뷰", () => {
  const r = calculateOpportunityScore(p13({}, []), config);
  const s = scoresOf(r);
  assert.equal(s.demand, null);
  assert.equal(s.competition, null);
  assert.equal(s.wingEntry, null);
  assert.equal(s.reviewBarrier, Math.round((50 - (113.3 / 2000) * 30) * 100) / 100); // 48.3
  assert.equal(s.margin, 72.5); // 0.25 → 60 + 0.5 × 25
  assert.equal(s.marketStability, 100); // 변동계수 1.6% ≤ 2%
  assert.deepEqual([s.salesVolume, s.salesGrowth, s.conversion], [null, null, null]);
  assert.equal(r.complete, false);
  assert.equal(r.total, null);
  assert.deepEqual(r.missingFactors, ["demand", "salesVolume", "salesGrowth", "competition", "wingEntry", "conversion"]);
});
test("PHASE 13 T2 검색량 10,000 + 경쟁상품 A·B·C → 수요 60 · 경쟁 83.64 · WING 57.78 · 리뷰 장벽 42.5 (경쟁상품 우선)", () => {
  const s = scoresOf(calculateOpportunityScore(p13({ searchVolume: dp(10000) }, P13_COMPETITORS), config));
  assert.equal(s.demand, 60); // 5,000→50 · 20,000→80 구간
  assert.equal(s.competition, 83.64); // 판매가 10,500 ÷ 경쟁 중앙값 11,000 = 0.9545
  assert.equal(s.wingEntry, 57.78); // 3개 중 WING 1 = 33.3%
  assert.equal(s.reviewBarrier, 42.5); // 경쟁 리뷰 중앙값 1,500 (키워드 평균 리뷰보다 우선)
  assert.equal(s.marketStability, 100);
  assert.equal(s.margin, 72.5);
});
test("PHASE 13 T3 검색량 10,000 + 증감률 +12% → 수요 62.4 (추세 ±10점 가감) · 나머지 T2 와 같음 · 판정은 여전히 계산 불가", () => {
  const r = calculateOpportunityScore(p13({ searchVolume: dp(10000), searchGrowthRate: dp(0.12) }, P13_COMPETITORS), config);
  const s = scoresOf(r);
  assert.equal(s.demand, 62.4);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missingFactors, ["salesVolume", "salesGrowth", "conversion"]);
  assert.equal(r.knownWeight, 70);
});
test("PHASE 13 키워드 평균가 · 로켓 비율은 V1 엔진 입력이 아니다 (값이 있어도 점수 변화 없음)", () => {
  const base = calculateOpportunityScore(p13({ searchVolume: dp(10000) }, P13_COMPETITORS), config);
  const withAgg = calculateOpportunityScore(p13({ searchVolume: dp(10000), averagePrice: dp(25227), rocketRatio: dp(0.865) }, P13_COMPETITORS), config);
  assert.deepEqual(scoresOf(withAgg), scoresOf(base));
});
test("PHASE 13 가격 기록 2회 · 경쟁상품 판매자 유형 2개면 안정성 · WING 미계산 (최소 3)", () => {
  const i = p13({ searchVolume: dp(10000) }, P13_COMPETITORS.slice(0, 2));
  i.priceHistory = P13_HISTORY.slice(0, 2);
  const s = scoresOf(calculateOpportunityScore(i, config));
  assert.equal(s.marketStability, null);
  assert.equal(s.wingEntry, null);
});

// PHASE 15 상품 발굴 정리 — V1 결과를 분류 · 정렬만 (점수 · 판정을 새로 만들지 않음)
const { discoverStatus, sortForDiscover, shortageReasons } = await import("../../src/lib/discover/summary.ts");
const emptyInput = () => ({
  asOf: "2026-10-12",
  product: { id: "e", name: "빈 상품", metrics: null },
  keyword: null,
  competitors: [],
  salesHistory: { actual: [], estimated: [] },
  priceHistory: [],
  margin: null,
});
test("PHASE 15 상품 발굴: 최종(9/9) · 잠정(일부) · 분석 불가(0) 구분, 최종만 V1 판정 · 기준 80/60 유지", () => {
  const final = calculateOpportunityScore(best(), config);
  const partial = calculateOpportunityScore(p13({ searchVolume: dp(10000) }, P13_COMPETITORS), config);
  const none = calculateOpportunityScore(emptyInput(), config);
  assert.equal(discoverStatus(final), "FINAL");
  assert.equal(final.verdict, final.total >= 80 ? "STRONG_BUY" : final.total >= 60 ? "REVIEW" : "EXCLUDE");
  assert.equal(discoverStatus(partial), "PROVISIONAL");
  assert.equal(partial.verdict, null);
  assert.equal(partial.total, null);
  assert.equal(discoverStatus(none), "INSUFFICIENT");
  assert.ok(none.factors.every((f) => f.score === null && f.points === null)); // 0점으로 채우지 않음
});
test("PHASE 15 상품 발굴 정렬: 최종(총점 순) → 잠정(계산 요소 수 · 확보 점수 순) → 분석 불가, 아무것도 빼지 않음", () => {
  const items = [
    { productName: "빈", preview: calculateOpportunityScore(emptyInput(), config) },
    { productName: "잠정-수요없음", preview: calculateOpportunityScore(p13({}, []), config) },
    { productName: "최종", preview: calculateOpportunityScore(best(), config) },
    { productName: "잠정-수요있음", preview: calculateOpportunityScore(p13({ searchVolume: dp(10000) }, P13_COMPETITORS), config) },
  ];
  assert.deepEqual(sortForDiscover(items).map((x) => x.productName), ["최종", "잠정-수요있음", "잠정-수요없음", "빈"]);
});
test("PHASE 15 데이터 부족 이유: 검색량(키 없음 · 수집 실패 · 미수집) · 판매량 · 성장 · 전환율 · 가격 · 리뷰", () => {
  const products = [{ preview: calculateOpportunityScore(p13({}, []), config) }, { preview: calculateOpportunityScore(emptyInput(), config) }];
  const noKey = shortageReasons({ hasSearchVolume: false, naverConfigured: false, naverLastAttempt: null, products });
  assert.match(noKey[0].reason, /API 키가 설정되지 않았/);
  assert.match(noKey[0].reason, /대리 지표/);
  assert.deepEqual(noKey.map((x) => x.area), ["검색량", "판매량", "판매 성장", "전환율", "가격", "리뷰"]);
  assert.match(noKey.find((x) => x.area === "판매량").reason, /^2\/2개/);
  assert.match(noKey.find((x) => x.area === "가격").reason, /^1\/2개/);
  const failed = shortageReasons({ hasSearchVolume: false, naverConfigured: true, naverLastAttempt: { ok: false, label: "인증 실패" }, products: [] });
  assert.match(failed[0].reason, /마지막 수집이 실패.*인증 실패/);
  assert.equal(shortageReasons({ hasSearchVolume: true, naverConfigured: true, naverLastAttempt: null, products: [] }).length, 0);
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
