// npm run test:judge — src/lib/judge/engine.ts (judge-v2) 순수 함수 검증
import assert from "node:assert/strict";

const { judge, supplyMarginOf, verdictOf, JUDGE_VERSION } = await import("../../src/lib/judge/engine.ts");
const { marketStructure } = await import("../../src/lib/market/structure.ts");
const { JUDGE_ASSUMPTIONS } = await import("../../src/config/judge-assumptions.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const dp = (value) => ({ value, source: "OFFICIAL_API", confidence: "A", collectedAt: "2026-10-25" });
const item = (rankPosition, reviewCount, delivery, extra = {}) => ({ rankPosition, isAd: false, price: 20000, reviewCount, sellerType: null, deliveryType: delivery, observed: true, ...extra });

/** 진입 쉬운 시장: 리뷰 적음 · 제3자 판매자 90% · 광고 칸 1개 */
const easyMarket = () => marketStructure("2026-10-25", [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => item(r, 30 + r * 10, r % 2 ? "ROCKET_GROWTH" : null)),
  item(10, 80, "ROCKET"),
  { ...item(1, 5, "ROCKET"), isAd: true },
]);
/** 어려운 시장: 직매입 80% · 리뷰 3천 · 광고 칸 많음 */
const hardMarket = () => marketStructure("2026-10-25", [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((r) => item(r, 3000, "ROCKET")), item(9, 3000, null), item(10, 3000, null),
  ...[1, 2, 3, 4, 5].map((r) => ({ ...item(r, 1, "ROCKET"), isAd: true })),
]);
const econ = (allowed, grade, bundles = []) => ({ version: "unit-econ-v2", grade, single: { units: 1, price: 20000, left: 0, allowedPerUnit: allowed, grade }, bundles, afterPromo: null, promoUntil: null, bestBundle: bundles.find((b) => b.allowedPerUnit > allowed) ?? null, basis: "" });
const sales = (min, max, confidence = "B", buyersFloor = null) => ({ version: "est-sales-v1", monthly: { min, mid: Math.round((min + max) / 2), max }, revenue: null, buyersFloor, monthlyReviews: 1, methods: [], confidence, missing: [], nextStep: null });

const base = (over = {}) => ({
  asOf: "2026-10-27",
  keyword: "케이크토퍼",
  searchVolume: dp(30000),
  searchGrowthRate: dp(0.2),
  market: easyMarket(),
  price: 19900,
  sales: sales(300, 1500),
  economics: econ(9000, "OK"),
  supplyMargin: { value: 0.35, status: "CONFIRMED" },
  conversionRate: null,
  compliance: "CLEARED",
  ...over,
});

test("수요 · 진입 · 원가 모두 좋고 실제 원가 확정 → 강력추천 · 신뢰도 A (전환율 없어도 판정)", () => {
  const r = judge(base());
  assert.equal(r.version, JUDGE_VERSION);
  assert.equal(r.verdict, "STRONG_BUY");
  assert.equal(r.confidence, "A");
  assert.ok(r.total >= 80, `total ${r.total}`);
  assert.deepEqual(r.gates, []);
  assert.deepEqual(r.missing, []);
});

test("공급 원가 미확인이면 점수가 높아도 강력추천 대신 검토 (확실한 수익 관문)", () => {
  const r = judge(base({ supplyMargin: null }));
  assert.equal(r.scoreVerdict, "STRONG_BUY");
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.gates.some((g) => g.includes("공급 원가 미확인")));
  assert.equal(r.confidence, "B");
});

test("실제 원가 순이익률 8% → 제외, 20% → 검토까지", () => {
  assert.equal(judge(base({ supplyMargin: { value: 0.08, status: "CONFIRMED" } })).verdict, "EXCLUDE");
  const r = judge(base({ supplyMargin: { value: 0.2, status: "ESTIMATED" } }));
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.gates.some((g) => g.includes("목표 25%")));
});

test("단품 · 묶음 모두 AVOID → 제외 / 묶음이 되면 관문 통과", () => {
  const avoid = judge(base({ supplyMargin: null, economics: econ(-200, "AVOID", [{ units: 2, price: 30000, left: 0, allowedPerUnit: 900, grade: "AVOID" }]) }));
  assert.equal(avoid.verdict, "EXCLUDE");
  assert.ok(avoid.risks.some((x) => x.code === "LOW_MARGIN"));
  const bundle = judge(base({ supplyMargin: null, economics: econ(-200, "AVOID", [{ units: 3, price: 40000, left: 0, allowedPerUnit: 5000, grade: "OK" }]) }));
  assert.ok(!bundle.gates.some((g) => g.includes("원가 여유 없음")));
  assert.match(bundle.parts.find((p) => p.part === "economics").basis, /3개 묶음 기준/);
});

test("보수적 판매 추정 월 30개 미만 → 검토까지 + 수요 부족 위험", () => {
  const r = judge(base({ sales: sales(20, 400) }));
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.risks.some((x) => x.code === "LOW_DEMAND"));
});

test("어려운 시장(직매입 지배 · 광고 과다 · 리뷰 장벽) → 시장 점수 낮음 · 위험 3개 · 검토 이하", () => {
  const r = judge(base({ market: hardMarket() }));
  assert.ok(r.marketScore < 50, `market ${r.marketScore}`);
  assert.deepEqual(r.risks.filter((x) => ["RETAIL_DOMINANT", "AD_HEAVY", "REVIEW_WALL"].includes(x.code)).length, 3);
  assert.notEqual(r.verdict, "STRONG_BUY");
});

test("검색 결과가 없으면 판정 보류 · 빠진 핵심 요소 안내 · 가능 범위", () => {
  const r = judge(base({ market: null }));
  assert.equal(r.verdict, null);
  assert.equal(r.total, null);
  assert.ok(r.missing.some((x) => x.startsWith("리뷰 장벽")));
  assert.ok(r.missing.some((x) => x.startsWith("판매자 구성")));
  assert.ok(r.range.min < r.range.max);
});

test("판매량 추정이 없으면 판정 보류, 단 판매 불가 확인 상품은 확실히 제외", () => {
  assert.equal(judge(base({ sales: null })).verdict, null);
  const blocked = judge(base({ sales: null, compliance: "BLOCKED" }));
  assert.equal(blocked.verdictIfCertain, "EXCLUDE");
});

test("전환율은 있으면 가산 (최대 +5), 없어도 판정에 영향 없음", () => {
  const a = judge(base({ supplyMargin: null }));
  const b = judge(base({ supplyMargin: null, conversionRate: 0.1 }));
  assert.ok(b.productScore > a.productScore);
  assert.ok(b.productScore - a.productScore <= 5);
  assert.ok(b.positives.some((x) => x.includes("전환율")));
});

test("14일 넘은 검색 결과 → 신뢰도 C · 재수집 위험", () => {
  const r = judge(base({ asOf: "2026-11-20" }));
  assert.equal(r.confidence, "C");
  assert.ok(r.risks.some((x) => x.code === "STALE_DATA"));
});

test("가정값: 광고 15% · 목표 순이익 25% · 여유 3% · 최소 월 30개 · 가격대 15,000~40,000 / 판정 80 · 60", () => {
  assert.equal(JUDGE_ASSUMPTIONS.adRate.value, 0.15);
  assert.equal(JUDGE_ASSUMPTIONS.targetNetMargin.value, 0.25);
  assert.equal(JUDGE_ASSUMPTIONS.otherCostBuffer.value, 0.03);
  assert.equal(JUDGE_ASSUMPTIONS.minMonthlySales.value, 30);
  assert.deepEqual([...JUDGE_ASSUMPTIONS.priceBand.value], [15000, 40000]);
  assert.deepEqual([verdictOf(80), verdictOf(79.9), verdictOf(60), verdictOf(59.9)], ["STRONG_BUY", "REVIEW", "REVIEW", "EXCLUDE"]);
});

test("상세 원가 → 순이익률: 확정 우선, 없으면 추정 최악값", () => {
  assert.deepEqual(supplyMarginOf({ confirmed: { outcome: { margin: 0.31 } }, estimated: { worst: { margin: 0.2 } } }), { value: 0.31, status: "CONFIRMED" });
  assert.deepEqual(supplyMarginOf({ confirmed: { outcome: null }, estimated: { worst: { margin: 0.2 } } }), { value: 0.2, status: "ESTIMATED" });
  assert.equal(supplyMarginOf(null), null);
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
console.log(`\nJudge V2 ${passed}/${tests.length}`);
