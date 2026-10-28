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

// PHASE 28 · judge-v2.1 ------------------------------------------------------------------
const { seasonOf, volumeSpike, seasonGroupOf } = await import("../../src/lib/judge/season.ts");

test("[PHASE 28] 검색량 급증: 방풍비닐 13,150(10-13) → 26,960(10-28) = +105% / 7일 안 기록만 있으면 판단 안 함", () => {
  const s = volumeSpike([{ on: "2026-10-13", value: 13150 }, { on: "2026-10-28", value: 26960 }]);
  assert.equal(s.base, 13150);
  assert.ok(Math.abs(s.ratio - 1.05) < 0.01);
  assert.equal(volumeSpike([{ on: "2026-10-13", value: 16980 }, { on: "2026-10-28", value: 22020 }]), null); // 케이크토퍼 +30%
  assert.equal(volumeSpike([{ on: "2026-10-25", value: 100 }, { on: "2026-10-28", value: 300 }]), null);
});

test("[PHASE 28] 시즌 사전 · 입고 뒤 남은 시즌: 방풍비닐 10-28 발주 → 12-09 입고, 1월 말까지 54일", () => {
  assert.equal(seasonGroupOf("방풍비닐 창문 외풍차단").group.id, "winter-draft");
  assert.equal(seasonGroupOf("나무도마"), null);
  const s = seasonOf({ asOf: "2026-10-28", keyword: "방풍비닐", productName: null, history: null });
  assert.equal(s.arrivalOn, "2026-12-09");
  assert.equal(s.sellDaysAfterArrival, 54);
  const off = seasonOf({ asOf: "2026-02-01", keyword: "선풍기", productName: null, history: null });
  assert.equal(off.sellDaysAfterArrival, 0);
  assert.equal(off.nextSeasonMonth, 5);
  // 3-25 발주 → 5-06 입고 (시즌 중) · 3-01 발주 → 4-12 입고, 시즌 시작(5-01) 30일 안이라 시즌 전체(5~8월 123일)
  assert.equal(seasonOf({ asOf: "2026-03-01", keyword: "선풍기", productName: null, history: null }).sellDaysAfterArrival, 123);
  assert.equal(seasonOf({ asOf: "2026-01-10", keyword: "선풍기", productName: null, history: null }).sellDaysAfterArrival, 0);
});

test("[PHASE 28] 시즌 상품: 급증 전 검색량으로 수요 계산 · 남은 시즌 60일 미만이면 검토까지", () => {
  const history = [{ on: "2026-10-13", value: 13150 }, { on: "2026-10-28", value: 26960 }];
  const plain = judge(base({ keyword: "방풍비닐", searchVolume: dp(26960), searchGrowthRate: null }));
  const r = judge(base({ keyword: "방풍비닐", searchVolume: dp(26960), searchGrowthRate: null, searchVolumeHistory: history, asOf: "2026-10-28" }));
  const demand = (x) => x.parts.find((p) => p.part === "demand");
  assert.ok(demand(r).score < demand(plain).score, `${demand(r).score} < ${demand(plain).score}`);
  assert.ok(demand(r).basis.includes("급증 전"));
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.gates.some((g) => g.includes("남은 시즌")));
  assert.ok(r.risks.some((x) => x.code === "SEASONAL"));
  assert.equal(r.season.group.id, "winter-draft");
});

test("[PHASE 28] 사전에 없는 급증 → 원인 미확인 검토까지 / 시즌 아닌 상품은 영향 없음", () => {
  const r = judge(base({ searchVolumeHistory: [{ on: "2026-10-10", value: 10000 }, { on: "2026-10-27", value: 30000 }] }));
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.gates.some((g) => g.includes("급증 원인")));
  const n = judge(base({ searchVolumeHistory: [{ on: "2026-10-10", value: 28000 }, { on: "2026-10-27", value: 30000 }] }));
  assert.equal(n.verdict, "STRONG_BUY");
  assert.equal(n.season, null);
});

test("[PHASE 28] 판매량 과대 추정: 같은 키워드 중앙값 × 3 으로 낮춤 · 위험 표시 / 동료 5개 미만이면 그대로", () => {
  const peers = [40, 60, 80, 100, 120, 2560];
  const r = judge(base({ sales: sales(2560, 12800), peerSalesMin: peers }));
  const ev = r.parts.find((p) => p.part === "salesEvidence");
  assert.ok(ev.basis.includes("낮춰"));
  assert.ok(r.risks.some((x) => x.code === "SALES_OUTLIER"));
  const ok = judge(base({ sales: sales(2560, 12800), peerSalesMin: [40, 60, 2560] }));
  assert.ok(!ok.risks.some((x) => x.code === "SALES_OUTLIER"));
  const normal = judge(base({ sales: sales(150, 700), peerSalesMin: peers }));
  assert.ok(!normal.risks.some((x) => x.code === "SALES_OUTLIER"));
});

test("[PHASE 28] 인증 필요(전기용품 KC) → 실제 원가가 좋아도 검토까지 · 위험에 규칙 이름", () => {
  const r = judge(base({ compliance: "REQUIRES_CERTIFICATION", certifications: ["전기용품 KC"] }));
  assert.equal(r.scoreVerdict, "STRONG_BUY");
  assert.equal(r.verdict, "REVIEW");
  assert.ok(r.gates.some((g) => g.includes("전기용품 KC")));
  assert.ok(r.risks.some((x) => x.code === "CERTIFICATION" && x.message.includes("전기용품 KC")));
});

// PHASE 29 · 키워드 기회 · 수집 대기열 -----------------------------------------------------
const { keywordOpportunity, sortOpportunities, queueCandidate } = await import("../../src/lib/discover/keyword-opportunity.ts");
const prod = (verdict, total, hasSales = true, certification = false) => ({ verdict, total, hasSales, certification });
const kwIn = (over = {}) => ({ keyword: "케이크토퍼", asOf: "2026-10-28", searchVolume: 22000, volumeHistory: [], market: marketStructure("2026-10-28", easyMarket().items ?? []), collectedDays: ["2026-10-13", "2026-10-28"], products: [prod("REVIEW", 80), prod("REVIEW", 75), prod("EXCLUDE", 50), prod("REVIEW", 70), prod(null, null, false), prod("REVIEW", 66)], ...over });

test("[PHASE 29] 키워드 기회: 판매 추정 5개 이상 → 판정 가능 · 최고 판정 / 시장 점수는 판정 V2 시장 부분과 같다", () => {
  const m = easyMarket();
  const o = keywordOpportunity(kwIn({ market: m }));
  assert.equal(o.stage, "JUDGEABLE");
  assert.deepEqual(o.best, { verdict: "REVIEW", total: 80 });
  assert.equal(o.salesCount, 5);
  assert.equal(o.verdicts.REVIEW, 4);
  const j = judge(base({ keyword: "케이크토퍼", searchVolume: dp(22000), searchGrowthRate: null, market: m, asOf: "2026-10-28" }));
  assert.equal(o.marketScore, j.marketScore);
});

test("[PHASE 29] 키워드 기회 단계: 수집 없음 · 1회 수집(7일 뒤 재수집일) · 시장 부적합 · 오래됨", () => {
  assert.equal(keywordOpportunity(kwIn({ market: null, collectedDays: [], products: [] })).stage, "NEED_SEARCH");
  const once = keywordOpportunity(kwIn({ market: easyMarket(), collectedDays: ["2026-10-28"], products: [prod(null, null, false)] }));
  assert.equal(once.stage, "WAIT_SALES");
  assert.equal(once.regatherOn, "2026-11-04");
  const poor = keywordOpportunity(kwIn({ market: hardMarket(), searchVolume: 800 }));
  assert.equal(poor.stage, "POOR_MARKET");
  const thin = keywordOpportunity(kwIn({ market: marketStructure("2026-10-28", [item(1, 30, null), item(2, 40, null)]) }));
  assert.equal(thin.stage, "NEED_SEARCH", "자연 순위 2칸 — 10-28 캠핑랜턴");
  const thinJ = judge(base({ market: marketStructure("2026-10-27", [item(1, 30, null), item(2, 40, null)]) }));
  assert.equal(thinJ.verdict, null, "칸이 적으면 시장 구조를 쓰지 않아 판정 보류");
  assert.ok(thinJ.missing.some((x) => x.includes("2칸뿐")));
  const stale = keywordOpportunity(kwIn({ market: easyMarket(), collectedDays: ["2026-10-01"] }));
  assert.equal(stale.stage, "STALE");
  const sorted = sortOpportunities([poor, once, keywordOpportunity(kwIn({ market: easyMarket() }))]).map((x) => x.stage);
  assert.deepEqual(sorted, ["JUDGEABLE", "WAIT_SALES", "POOR_MARKET"]);
});

test("[PHASE 29] 수집 대기열: 브랜드 · 서비스 · 의류 · 인증 부담 · 비시즌 · 검색량 부족은 건너뛰고 나머지는 점수", () => {
  const q = (keyword, searchVolume = 10000, compIdx = "중간") => queueCandidate({ keyword, searchVolume, compIdx }, "2026-10-28");
  assert.equal(q("오왈라텀블러").skip, "BRAND");
  assert.equal(q("캠핑카렌트").skip, "NOT_GOODS");
  assert.equal(q("여성가디건").skip, "FASHION");
  assert.equal(q("신발장").skip, null);
  assert.equal(q("무선키보드").skip, "HEAVY_CERT");
  assert.equal(q("전기난로").skip, "HEAVY_CERT");
  assert.equal(q("모기장").skip, "OFF_SEASON");
  assert.equal(q("규조토발매트", 2000).skip, "LOW_VOLUME");
  const a = q("규조토발매트", 15660, "중간");
  const b = q("캠핑테이블", 53100, "중간");
  const c = q("수저세트", 21160, "중간");
  assert.equal(a.skip, null);
  assert.ok(a.score > b.score, `${a.score} > ${b.score}`); // 너무 큰 시장은 뒤로
  assert.ok(c.notes.some((n) => n.includes("식품용 기구")));
  assert.ok(q("발매트", 20000, "낮음").score > q("발매트", 20000, "높음").score);
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
