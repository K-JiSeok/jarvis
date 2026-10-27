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
test("PHASE 13 T2 검색량 10,000 + 경쟁상품 A·B·C → 수요 60 · 경쟁 83.64 · WING 96.67 · 리뷰 장벽 42.5 (경쟁상품 우선)", () => {
  const s = scoresOf(calculateOpportunityScore(p13({ searchVolume: dp(10000) }, P13_COMPETITORS), config));
  assert.equal(s.demand, 60); // 5,000→50 · 20,000→80 구간
  assert.equal(s.competition, 83.64); // 판매가 10,500 ÷ 경쟁 중앙값 11,000 = 0.9545
  assert.equal(s.wingEntry, 96.67); // v1.1: 3개 중 제3자 판매자(WING 1 + 로켓그로스 1) = 66.7% (v1 은 WING 만 세서 57.78)
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

// PHASE 16: 데이터 준비 상태 (점수 · 판정을 바꾸지 않고 엔진 입력 · 결과만 읽는다)
const { productReadiness, keywordReadiness } = await import("../../src/lib/discover/readiness.ts");
const stateOf = (items) => Object.fromEntries(items.map((x) => [x.key, x.state]));

test("PHASE 16 준비 상태: 데이터 없음 → 전부 없음(MISSING), 0 으로 채우지 않고 다음 할 일 안내 · 점수 · 판정 그대로", () => {
  const input = emptyInput();
  const result = calculateOpportunityScore(input, config);
  const items = productReadiness({ input, result, reviewHistory: [], scenario: null });
  assert.deepEqual(stateOf(items), { price: "MISSING", review: "MISSING", sales: "MISSING", growth: "MISSING", conversion: "MISSING", profit: "MISSING", verdict: "MISSING" });
  assert.ok(items.every((x) => x.next));
  assert.match(items.find((x) => x.key === "conversion").status, /추정하지 않음/);
  assert.match(items.find((x) => x.key === "sales").next, /임의로 만들지 않음/);
  assert.equal(result.total, null);
  assert.equal(result.verdict, null);
});
test("PHASE 16 준비 상태: 모든 데이터 → 전부 준비됨, 최종 판정 가능 · V1 판정 그대로", () => {
  const input = best();
  const result = calculateOpportunityScore(input, config);
  const items = productReadiness({ input, result, reviewHistory: [{ capturedOn: "2026-09-01", value: 5 }, { capturedOn: "2026-10-01", value: 9 }], scenario: { hasCalculation: true, netProfitPerUnit: 4500, netMarginRate: 0.5 } });
  input.product.metrics.reviewCount = dp(9);
  const items2 = productReadiness({ input, result, reviewHistory: [{ capturedOn: "2026-09-01", value: 5 }, { capturedOn: "2026-10-01", value: 9 }], scenario: { hasCalculation: true, netProfitPerUnit: 4500, netMarginRate: 0.5 } });
  assert.equal(stateOf(items).review, "MISSING"); // 대상 상품 리뷰 수가 없으면 없음
  assert.ok(items2.every((x) => x.state === "READY"), JSON.stringify(stateOf(items2)));
  assert.match(items2.find((x) => x.key === "sales").status, /^실제값/);
  assert.match(items2.find((x) => x.key === "verdict").status, /9\/9/);
  assert.equal(result.verdict, "STRONG_BUY");
});
test("PHASE 16 준비 상태: 가격 1회 · 판매량 없음 · 시나리오 없음 → 가격 일부 · 판매량 없음 · 판정 일부(부족 요소 이름)", () => {
  const input = p13({ searchVolume: dp(560) }, []);
  input.priceHistory = [hist("2026-10-08", 9800, 1)];
  input.margin = null;
  const result = calculateOpportunityScore(input, config);
  const items = productReadiness({ input, result, reviewHistory: [{ capturedOn: "2026-10-08", value: 10 }], scenario: null });
  const s = stateOf(items);
  assert.equal(s.price, "PARTIAL");
  assert.match(items.find((x) => x.key === "price").status, /기록 1회 \(시장 안정성에 3회 필요\)/);
  assert.equal(s.sales, "MISSING");
  assert.equal(s.profit, "MISSING");
  assert.equal(s.verdict, "PARTIAL");
  assert.match(items.find((x) => x.key === "verdict").status, /판매량.*마진.*시장 안정성/);
  // 추정 판매량만 있으면 "추정값"으로 따로 표시 (실제와 합치지 않음)
  input.product.metrics.salesEstimated = period(300, 30, { source: "EXTERNAL_TOOL" });
  const r2 = calculateOpportunityScore(input, config);
  assert.match(productReadiness({ input, result: r2, reviewHistory: [], scenario: null }).find((x) => x.key === "sales").status, /^추정값 300개 \/ 30일/);
});
test("PHASE 16 키워드 준비 상태: 네이버 값 · 10 미만 · 수집 실패 · 미수집 · 키 없음 구분, 다른 출처 값은 따로 표시", () => {
  const base = { naverConfigured: true, naverLatest: null, naverLastAttempt: null, searchVolume: null, coupangSearch: null };
  const ok = keywordReadiness({ ...base, naverLatest: { total: 560, capturedOn: "2026-10-12" }, coupangSearch: { capturedAt: "2026-10-12T05:37:00Z", total: 60, registered: 0 } });
  assert.deepEqual(stateOf(ok), { naver: "READY", coupangSearch: "READY" });
  assert.match(ok[0].status, /쿠팡 검색량 아님/);
  const below = keywordReadiness({ ...base, naverLastAttempt: { ok: false, code: "NAVER_BELOW_10", label: "10 미만", at: "2026-10-12T05:00:00Z" } });
  assert.equal(below[0].state, "MISSING");
  assert.match(below[0].status, /10 미만/);
  assert.match(below[0].next, /다른 표현/);
  assert.equal(below[1].state, "MISSING");
  const belowManual = keywordReadiness({ ...base, naverLastAttempt: { ok: false, code: "NAVER_BELOW_10", label: "10 미만", at: "2026-10-12T05:00:00Z" }, searchVolume: dp(15) });
  assert.equal(belowManual[0].state, "PARTIAL");
  assert.match(belowManual[0].status, /직접 입력 값 15 사용 중/);
  const failed = keywordReadiness({ ...base, naverLastAttempt: { ok: false, code: "NAVER_AUTH", label: "인증 실패", at: "2026-10-12T05:00:00Z" } });
  assert.match(failed[0].status, /수집 실패 — 인증 실패/);
  assert.match(keywordReadiness(base)[0].status, /^미수집/);
  assert.match(keywordReadiness({ ...base, naverConfigured: false })[0].status, /API 키 없음/);
});

// PHASE 19: V1 항목별 결측 집계 (점수 · 판정을 바꾸지 않고 결과만 센다)
const { v1Coverage, FILL_PATH } = await import("../../src/lib/discover/coverage.ts");
test("PHASE 19 V1 결측 집계: 요소별 계산 · NULL · 출처 · 추정값 사용 · 최신일, 엔진 결과 그대로", () => {
  const full = calculateOpportunityScore(best(), config);
  const empty = calculateOpportunityScore(emptyInput(), config);
  const est = best();
  est.product.metrics.salesActual = null;
  est.product.metrics.salesEstimated = period(1500, 30, { source: "ESTIMATED", confidence: "C" });
  est.competitors = [];
  const withEst = calculateOpportunityScore(est, config);
  const cov = v1Coverage([full, empty, withEst]);
  assert.equal(cov.length, 9);
  const by = Object.fromEntries(cov.map((c) => [c.factor, c]));
  assert.deepEqual([by.demand.computed, by.demand.missing], [2, 1]);
  assert.equal(by.salesVolume.estimatedUsed, 1);
  assert.ok(by.demand.sources.MANUAL >= 2);
  assert.equal(by.conversion.missing, 1);
  assert.match(by.conversion.topReason, /전환율/);
  assert.match(FILL_PATH.salesVolume, /출처 없음/);
  // 집계는 결과를 바꾸지 않는다
  assert.equal(full.verdict, "STRONG_BUY");
  assert.equal(empty.total, null);
});

// PHASE 25 시장 구조 (market-structure-v1) · 엔진 v1.1
{
  const { marketStructure, sellerKindOf, describeMarket, MARKET_RULES } = await import("../../src/lib/market/structure.ts");
  const item = (rankPosition, reviewCount, seller, extra = {}) => ({ rankPosition, isAd: false, price: 10000 + rankPosition * 100, reviewCount, sellerType: null, deliveryType: seller, observed: true, ...extra });

  test("[시장] 판매자 구분: 확인한 판매자 유형 → 배송 배지 → 배지 없음은 판매자배송(추정) · 미수집은 모름", () => {
    assert.equal(sellerKindOf({ sellerType: "COUPANG_RETAIL", deliveryType: "ROCKET_GROWTH", observed: true }), "RETAIL");
    assert.equal(sellerKindOf({ sellerType: null, deliveryType: "ROCKET", observed: true }), "RETAIL");
    assert.equal(sellerKindOf({ sellerType: null, deliveryType: "ROCKET_GROWTH", observed: true }), "GROWTH");
    assert.equal(sellerKindOf({ sellerType: "WING_SELLER", deliveryType: null, observed: true }), "SELLER");
    assert.equal(sellerKindOf({ sellerType: null, deliveryType: null, observed: true }), "SELLER");
    assert.equal(sellerKindOf({ sellerType: null, deliveryType: null, observed: false }), "UNKNOWN");
  });

  test("[시장] 자연 상위 10개만 · 중앙값 · 광고 비율 · 직매입/제3자 분리", () => {
    const items = [
      item(1, 12000, "ROCKET"), item(2, 50, "ROCKET_GROWTH"), item(3, 80, null), item(4, 300, "ROCKET_GROWTH"), item(5, 20, null),
      item(6, 900, "ROCKET"), item(7, 40, "ROCKET_GROWTH"), item(8, 150, null), item(9, 60, "ROCKET_GROWTH"), item(10, 10, null),
      item(11, 99999, "ROCKET"), // 상위 10 밖 — 제외
      { ...item(1, 5, "ROCKET"), isAd: true }, { ...item(2, 5, "ROCKET"), isAd: true }, { ...item(3, 5, "ROCKET"), isAd: true },
    ];
    const m = marketStructure("2026-10-27", items);
    assert.equal(m.organic, 11);
    assert.equal(m.ads, 3);
    assert.equal(m.adRatio, 0.2143);
    assert.equal(m.topN, 10);
    assert.equal(m.medianReviews, 70); // 10 20 40 50 60 80 150 300 900 12000 → (60+80)/2
    assert.equal(m.lowReviewCount, 6);
    assert.deepEqual(m.sellers, { RETAIL: 2, GROWTH: 4, SELLER: 4, UNKNOWN: 0 });
    assert.equal(m.retailRatio, 0.2);
    assert.equal(m.thirdPartyRatio, 0.8);
    assert.deepEqual(m.risks, []);
    assert.match(describeMarket(m), /직매입 20% · 제3자 판매자 80%/);
  });

  test("[시장] 판매자 유형을 아는 상품이 5개 미만이면 비율을 내지 않는다 · 위험 표시", () => {
    const few = marketStructure("2026-10-27", [1, 2, 3, 4, 5, 6].map((r) => item(r, 5000, r <= 2 ? "ROCKET" : null, r <= 2 ? {} : { observed: false })));
    assert.equal(few.sellerKnown, 2);
    assert.equal(few.retailRatio, null);
    assert.equal(few.thirdPartyRatio, null);
    assert.deepEqual(few.risks.map((r) => r.type), ["REVIEW_WALL"]);
    const retail = marketStructure("2026-10-27", [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((r) => item(r, 10, "ROCKET")), item(9, 10, null), item(10, 10, null),
      ...[1, 2, 3, 4, 5].map((r) => ({ ...item(r, 1, "ROCKET"), isAd: true })),
    ]);
    assert.deepEqual(retail.risks.map((r) => r.type), ["RETAIL_DOMINANT", "AD_HEAVY"]);
    assert.equal(marketStructure("2026-10-27", [{ ...item(1, 1, null), isAd: true }]), null);
    assert.equal(MARKET_RULES.top, 10);
  });

  test("[엔진 v1.1] 시장 구조가 있으면 WING · 리뷰 장벽은 시장 구조 우선, 경쟁 난이도에 직매입 비율 추가 · 위험은 주의 사유로", () => {
    const market = marketStructure("2026-10-27", [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((r) => item(r, 10, "ROCKET")), item(9, 10, null), item(10, 10, null),
      ...[1, 2, 3, 4, 5].map((r) => ({ ...item(r, 1, "ROCKET"), isAd: true })),
    ]);
    const base = p13({ searchVolume: dp(10000) }, P13_COMPETITORS);
    const r = calculateOpportunityScore({ ...base, market }, config);
    const s = scoresOf(r);
    assert.equal(s.wingEntry, 40); // 제3자 2/10 = 20% → 40
    assert.equal(s.reviewBarrier, 100); // 상위 10 리뷰 중앙값 10 (경쟁상품 1,500 보다 우선)
    assert.equal(s.competition, 46.82); // (판매가 비율 83.64 + 직매입 80% → 10) ÷ 2
    const comp = r.factors.find((f) => f.factor === "competition");
    assert.match(comp.basis, /직매입 비율 80\.0%/);
    assert.ok(r.reasons.some((x) => x.kind === "CAUTION" && x.message.includes("쿠팡과 직접 경쟁")));
    assert.equal(r.engineVersion, "score-engine-v1.1");
    // 시장 구조가 없으면 기존(v1.1 경쟁상품) 방식 그대로
    assert.deepEqual(scoresOf(calculateOpportunityScore({ ...base, market: null }, config)), scoresOf(calculateOpportunityScore(base, config)));
  });
}

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

