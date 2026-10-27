// npm run test:estimate — PHASE 22 판매량 추정 · 추정 판매 기회 · 공급 후보 추천 순서 (순수 함수)
// [실측] 표시: 2026-10-13 쿠팡 상품 페이지(모나코올리브 모던 실리콘 트레이 대형)에서 [최신순]으로 읽은 실제 리뷰 날짜. 나머지는 모의 입력.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCards } from "../costs/cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { estimateSales, parseBuyers, isNewestFirst, rateFromRecent, rateFromGrowth, REVIEW_RATE } = await import("../../src/lib/estimate/sales.ts");
const { estimateOpportunity } = await import("../../src/lib/estimate/opportunity.ts");
const { rankSuppliers } = await import("../../src/lib/sourcing/recommend.ts");
const { unitEconomics, ECON_ASSUMPTIONS } = await import("../../src/lib/estimate/economics.ts");
const { keywordFilter } = await import("../../src/lib/automation/keyword-filter.ts");
const cards = buildCards(JSON.parse(readFileSync(join(here, "..", "costs", "fixtures", "coupang-rates-2026-10-13.json"), "utf8")));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const TRAY_RECENT = ["2026-10-08", "2026-10-08", "2026-10-07", "2026-10-02", "2026-09-24", "2026-09-24", "2026-09-23", "2026-09-23", "2026-09-22", "2026-09-16"];
const TRAY_BEST = ["2026-10-07", "2026-10-08", "2026-08-09", "2026-08-09", "2026-10-08", "2026-10-02", "2026-09-24", "2026-09-24", "2026-09-23", "2026-09-22"];
const none = { price: 6710, monthlyBuyersText: null, monthlyBuyersOn: null, reviewSample: null, reviewHistory: [] };

test("[실측] 최신순 리뷰 10개 (9/16~10/8, 10/13 수집) → 하루 0.37개 · 월 리뷰 11.1개 → 월 판매 222 ~ 1,111개 (가운데 3% 370개)", () => {
  assert.equal(isNewestFirst(TRAY_RECENT), true);
  const r = rateFromRecent({ dates: TRAY_RECENT, capturedOn: "2026-10-13" });
  assert.equal(r.days, 27);
  const e = estimateSales({ ...none, reviewSample: { dates: TRAY_RECENT, capturedOn: "2026-10-13" } });
  assert.equal(e.monthlyReviews, 11.1);
  assert.deepEqual(e.monthly, { min: 222, mid: 370, max: 1111 });
  assert.equal(e.revenue.mid, 370 * 6710);
  assert.equal(e.confidence, "C");
  assert.match(e.nextStep, /7일 이상/);
});

test("[실측] 베스트순 화면의 리뷰 날짜(순서 섞임)는 쓰지 않고 [최신순]을 안내", () => {
  assert.equal(isNewestFirst(TRAY_BEST), false);
  const e = estimateSales({ ...none, reviewSample: { dates: TRAY_BEST, capturedOn: "2026-10-13" } });
  assert.equal(e.monthly, null);
  assert.ok(e.missing.some((m) => /최신순/.test(m)));
});

test("쿠팡 표시 '한 달간 800명 이상 구매' → 판매량 하한 (리뷰 추정보다 작으면 하한으로 끌어올림)", () => {
  assert.equal(parseBuyers("800명 이상"), 800);
  assert.equal(parseBuyers("1,000명 이상"), 1000);
  assert.equal(parseBuyers("1만명 이상"), 10000);
  assert.equal(parseBuyers(null), null);
  const only = estimateSales({ ...none, monthlyBuyersText: "800명 이상", monthlyBuyersOn: "2026-10-12" });
  assert.deepEqual(only.monthly, { min: 800, mid: 800, max: 800 });
  assert.equal(only.buyersFloor, 800);
  const both = estimateSales({ ...none, monthlyBuyersText: "800명 이상", reviewSample: { dates: TRAY_RECENT, capturedOn: "2026-10-13" } });
  assert.deepEqual(both.monthly, { min: 800, mid: 800, max: 1111 });
  assert.equal(both.confidence, "B");
});

test("누적 리뷰 증가: 7일 이상 간격만 사용 (100 → 121개 / 14일 = 하루 1.5개 → 월 45개 → 900 ~ 4,500개)", () => {
  assert.equal(rateFromGrowth([{ on: "2026-10-01", count: 100 }, { on: "2026-10-05", count: 110 }]), null);
  const g = rateFromGrowth([{ on: "2026-10-01", count: 100 }, { on: "2026-10-15", count: 121 }]);
  assert.equal(g.perDay, 1.5);
  const e = estimateSales({ ...none, reviewHistory: [{ on: "2026-10-01", count: 100 }, { on: "2026-10-15", count: 121 }] });
  assert.deepEqual(e.monthly, { min: 900, mid: 1500, max: 4500 });
  assert.equal(e.confidence, "B"); // 14일 이상
});

test("근거가 하나도 없으면 판매량 · 매출을 만들지 않음 (0 이 아님) · 다음 할 일 안내", () => {
  const e = estimateSales({ ...none, reviewHistory: [{ on: "2026-10-12", count: 70 }] });
  assert.equal(e.monthly, null);
  assert.equal(e.revenue, null);
  assert.equal(e.confidence, null);
  assert.match(e.nextStep, /최신순/);
  assert.equal(REVIEW_RATE.mid, 0.03);
});

test("원가 상한: 6,710원 · 주방용품 10.8% · 분류 미확정(요율표 중 높은 극소형 2,500원) → 손익분기 2,875원 · 마진 30% 862원", () => {
  const sales = estimateSales({ ...none, reviewSample: { dates: TRAY_RECENT, capturedOn: "2026-10-13" } });
  const o = estimateOpportunity({ today: "2026-10-13", price: 6710, sales, cards, salesScope: "주방용품", feeGroup: null, detail: null });
  assert.equal(o.allowedCost.find((x) => x.margin === 0).cost, Math.round(6710 / 1.1 - 6710 * 0.108 - 2500));
  assert.equal(o.allowedCost.find((x) => x.margin === 0.3).cost, Math.round(6710 / 1.1 - 6710 * 0.108 - 2500 - 0.3 * 6710));
  assert.equal(o.monthlyProfit, null); // 공급 원가 없음
  assert.equal(o.rankKey, 370 * 6710);
  // 테이블웨어로 확정되면 800 + 1,350 = 2,150원
  const t = estimateOpportunity({ today: "2026-10-13", price: 6710, sales, cards, salesScope: "주방용품", feeGroup: "주방 > 테이블웨어", detail: null });
  assert.equal(t.allowedCost[0].cost, Math.round(6710 / 1.1 - 6710 * 0.108 - 2150));
});

test("추정 월 이익: 상세 원가 추정 시나리오 개당 이익 × 판매량 범위", () => {
  const sales = { ...estimateSales(none), monthly: { min: 100, mid: 300, max: 1000 }, revenue: null };
  const detail = { estimated: { computable: true, worst: { profit: -500 }, best: { profit: 200 }, omitted: [] } };
  const o = estimateOpportunity({ today: "2026-10-13", price: 10000, sales, cards, salesScope: null, feeGroup: null, detail });
  assert.deepEqual(o.monthlyProfit, { min: -500000, max: 200000 });
});

test("공급 후보 추천 순서: 일치도 → 도착 원가 → MOQ → 연차, 불명확만 있으면 추천 없음, 제외는 빠짐", () => {
  const c = (id, matchLevel, landed, moq, years, userStatus = "CANDIDATE") => ({ linkId: id, title: id, matchLevel, userStatus, landed: landed && { min: landed, max: landed }, moq, supplierYears: years });
  const r1 = rankSuppliers([c("a", "SIMILAR", 3000, 10, 5), c("b", "HIGH", 5000, 100, 1), c("x", "HIGH", 1000, 1, 9, "REJECTED")], 4000);
  assert.deepEqual(r1.ranked.map((x) => x.linkId), ["b", "a"]);
  assert.equal(r1.recommended.linkId, "b");
  assert.equal(r1.ranked[0].withinTarget, false);
  assert.match(r1.note, /자동 선택하지 않음/);
  const r2 = rankSuppliers([c("a", "SIMILAR", 3000, 100, 1), c("b", "SIMILAR", 3000, 10, 1), c("c", "SIMILAR", null, 1, 20)], null);
  assert.deepEqual(r2.ranked.map((x) => x.linkId), ["b", "a", "c"]);
  const r3 = rankSuppliers([c("a", "UNCLEAR", 1000, 1, 1)], null);
  assert.equal(r3.recommended, null);
  assert.match(r3.note, /불명확/);
});

test("[PHASE 23 · unit-econ-v2] 단위 경제성 (실제 WING 요율 · 테이블웨어 · 극소형): 4,900원 단품 비추천 · 9,900원 주의 · 19,900원 적정", () => {
  const e = (price) => unitEconomics({ today: "2026-10-13", price, cards, salesScope: "주방용품", feeGroup: "주방 > 테이블웨어" });
  const a = e(4900);
  // v2: 4,900 ÷ 1.1 − 529 − (700 + 1,350) − 광고 15% 735 − 마진 25% 1,225 − 여유 3% 147 = −232 (v1 은 −85)
  assert.equal(a.single.allowedPerUnit, Math.round(4900 / 1.1 - 4900 * 0.108 - 2050 - 735 - 1225 - 147));
  assert.equal(a.grade, "AVOID");
  assert.equal(e(9900).grade, "CAUTION");
  assert.equal(e(9900).single.allowedPerUnit, 1524); // v1 1,821
  assert.equal(e(19900).grade, "OK");
  assert.equal(e(19900).single.allowedPerUnit, 4485); // v1 5,082
});

test("[PHASE 23] 묶음 시나리오: 4,900원 × 3개 × 0.9 = 13,200원 → 개당 쓸 수 있는 원가가 단품보다 큼 · 할인 종료 뒤(2027-02-01) 기본 비용이면 더 나빠짐", () => {
  const x = unitEconomics({ today: "2026-10-13", price: 4900, cards, salesScope: "주방용품", feeGroup: "주방 > 테이블웨어" });
  const b3 = x.bundles.find((b) => b.units === 3);
  assert.equal(b3.price, 13200);
  assert.ok(b3.allowedPerUnit > x.single.allowedPerUnit);
  assert.equal(x.bestBundle.units, 3);
  assert.equal(x.promoUntil, "2027-01-31");
  // 할인 종료 후: 입출고 1,650 + 배송 2,200
  assert.equal(x.afterPromo.allowedPerUnit, Math.round(4900 / 1.1 - 4900 * 0.108 - 3850 - 735 - 1225 - 147));
  assert.deepEqual([ECON_ASSUMPTIONS.targetMargin, ECON_ASSUMPTIONS.adRate, ECON_ASSUMPTIONS.buffer], [0.25, 0.15, 0.03]);
});

test("[PHASE 23] 키워드 거르기: 브랜드 · 월 10만 이상 한 단어는 일괄 등록에서 제외, 여러 단어 · 일반 키워드는 통과", () => {
  assert.equal(keywordFilter("쿠쿠", 167700), "BRAND");
  assert.equal(keywordFilter("다이슨 청소기", 50000), "BRAND");
  assert.equal(keywordFilter("계산기", 1083700), "TOO_BROAD");
  assert.equal(keywordFilter("가방", 96500), null); // 10만 미만
  assert.equal(keywordFilter("캠핑 의자", 120000), null); // 한 단어 아님
  assert.equal(keywordFilter("나무도마", 16750), null);
  assert.equal(keywordFilter("코일매트", null), null);
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
console.log(`\nEstimate ${passed}/${tests.length}`);
