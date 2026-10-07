// npm run test:profit — src/lib/profit/calculate.ts 순수 함수 검증 (Node 내장 assert, 추가 프레임워크 없음)
import assert from "node:assert/strict";

import {
  calculateBreakEvenPrice,
  calculateBreakEvenUnits,
  calculateMargin,
  calculateProfit,
  calculateROI,
} from "../../src/lib/profit/calculate.ts";

const base = {
  salePrice: 29900,
  unitCostAmount: 8000,
  exchangeRate: 1,
  intlShippingPerUnit: 1500,
  domesticShippingPerUnit: 3000,
  feeRate: 0.108,
  logisticsFeePerUnit: 2500,
  adCostRate: 0.1,
  adCostPerUnit: null,
  otherCostPerUnit: 500,
  fixedCostTotal: 500000,
  expectedMonthlyUnits: 100,
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("정상 수익: 총비용·순이익·순이익률·ROI", () => {
  const r = calculateProfit(base);
  assert.equal(r.complete, true);
  assert.equal(r.feeAmount, 3229); // 29900 × 10.8% = 3229.2
  assert.equal(r.adCostAmount, 2990);
  assert.equal(r.fixedCostPerUnit, 8000 + 1500 + 3000 + 2500 + 500);
  assert.equal(r.totalCostPerUnit, 15500 + 3229 + 2990);
  assert.equal(r.netProfitPerUnit, 29900 - 21719);
  assert.equal(r.netMarginRate, Math.round((8181 / 29900) * 10000) / 10000);
  assert.equal(r.investmentPerUnit, 12500);
  assert.equal(r.roi, Math.round((8181 / 12500) * 10000) / 10000);
  assert.equal(r.monthlyNetProfit, 818100);
  assert.deepEqual(r.omitted, []);
});

test("손실: 순이익·순이익률 음수, 손익분기 판매량 없음", () => {
  const r = calculateProfit({ ...base, salePrice: 15000 });
  assert.ok(r.netProfitPerUnit < 0);
  assert.ok(r.netMarginRate < 0);
  assert.ok(r.roi < 0);
  assert.equal(r.breakEvenUnits, null);
});

test("0원 판매가: 계산은 하되 순이익률 null", () => {
  const r = calculateProfit({ ...base, salePrice: 0 });
  assert.equal(r.complete, true);
  assert.equal(r.netProfitPerUnit, -15500);
  assert.equal(r.netMarginRate, null);
});

test("0원 원가는 실제 0 (null 과 다름)", () => {
  const r = calculateProfit({ ...base, unitCostAmount: 0 });
  assert.equal(r.complete, true);
  assert.equal(r.unitCostKrw, 0);
});

test("필수값 미입력(판매가/원가/수수료율) → 결과 전부 null", () => {
  for (const field of ["salePrice", "unitCostAmount", "feeRate"]) {
    const r = calculateProfit({ ...base, [field]: null });
    assert.equal(r.complete, false);
    assert.deepEqual(r.missingRequired, [field]);
    assert.equal(r.netProfitPerUnit, null);
    assert.equal(r.breakEvenPrice, null);
    assert.equal(r.roi, null);
  }
});

test("선택 비용 미입력 → 계산에서 제외하고 omitted 에 기록", () => {
  const r = calculateProfit({ ...base, intlShippingPerUnit: null, logisticsFeePerUnit: null, adCostRate: null, otherCostPerUnit: null });
  assert.deepEqual(r.omitted, ["intlShippingPerUnit", "logisticsFeePerUnit", "otherCostPerUnit", "adCost"]);
  assert.equal(r.fixedCostPerUnit, 8000 + 3000);
  assert.equal(r.adCostAmount, 0);
});

test("판매가 변경: 비례 비용도 같이 변함", () => {
  const a = calculateProfit(base);
  const b = calculateProfit({ ...base, salePrice: 34900 });
  assert.equal(b.feeAmount, Math.round(34900 * 0.108));
  assert.equal(b.adCostAmount, 3490);
  assert.ok(b.netProfitPerUnit > a.netProfitPerUnit);
});

test("원가 변경: 순이익이 원가 차이만큼 줄고 투자원가 증가", () => {
  const a = calculateProfit(base);
  const b = calculateProfit({ ...base, unitCostAmount: 9000 });
  assert.equal(a.netProfitPerUnit - b.netProfitPerUnit, 1000);
  assert.equal(b.investmentPerUnit - a.investmentPerUnit, 1000);
});

test("수수료 변경: 10.8% → 6%", () => {
  const b = calculateProfit({ ...base, feeRate: 0.06 });
  assert.equal(b.feeAmount, Math.round(29900 * 0.06));
});

test("광고비 비율 ↔ 개당 금액", () => {
  const rate = calculateProfit(base);
  const amount = calculateProfit({ ...base, adCostRate: null, adCostPerUnit: 2990 });
  assert.equal(amount.adCostAmount, 2990);
  assert.equal(amount.totalCostPerUnit, rate.totalCostPerUnit);
  assert.equal(amount.variableRate, 0.108);
  assert.equal(rate.variableRate, 0.208);
});

test("광고비 비율과 금액을 둘 다 넣으면 오류", () => {
  const r = calculateProfit({ ...base, adCostPerUnit: 1000 });
  assert.equal(r.complete, false);
  assert.equal(r.errors.length, 1);
});

test("배송비 변경: 해외·국내 배송비가 비용과 투자원가에 반영", () => {
  const b = calculateProfit({ ...base, intlShippingPerUnit: 2500, domesticShippingPerUnit: 0 });
  assert.equal(b.fixedCostPerUnit, 8000 + 2500 + 0 + 2500 + 500);
  assert.equal(b.investmentPerUnit, 10500);
});

test("환율: 원가 32.5 CNY × 190 = 6175원", () => {
  const r = calculateProfit({ ...base, unitCostAmount: 32.5, exchangeRate: 190 });
  assert.equal(r.unitCostKrw, 6175);
});

test("손익분기 판매가: 그 가격에서 순이익 ≥ 0, 1원 낮으면 < 0", () => {
  const r = calculateProfit(base);
  const at = calculateProfit({ ...base, salePrice: r.breakEvenPrice });
  const below = calculateProfit({ ...base, salePrice: r.breakEvenPrice - 1 });
  assert.equal(r.breakEvenPrice, Math.ceil(15500 / (1 - 0.208)));
  assert.ok(at.netProfitPerUnit >= 0, `at ${at.netProfitPerUnit}`);
  assert.ok(below.netProfitPerUnit < 0, `below ${below.netProfitPerUnit}`);
});

test("손익분기 판매량: 고정비 ÷ 개당 순이익 (올림)", () => {
  const r = calculateProfit(base);
  assert.equal(r.breakEvenUnits, Math.ceil(500000 / 8181));
  assert.equal(calculateProfit({ ...base, fixedCostTotal: null }).breakEvenUnits, null);
});

test("ROI: 투자원가 0 이면 null + 경고", () => {
  const r = calculateProfit({ ...base, unitCostAmount: 0, intlShippingPerUnit: 0, domesticShippingPerUnit: 0 });
  assert.equal(r.roi, null);
  assert.ok(r.warnings.some((w) => w.includes("ROI")));
});

test("ROI: 저장 범위 초과면 null + 경고", () => {
  const r = calculateProfit({ ...base, salePrice: 1000000000, unitCostAmount: 1, intlShippingPerUnit: 0, domesticShippingPerUnit: 0 });
  assert.equal(r.roi, null);
  assert.ok(r.warnings.some((w) => w.includes("범위")));
});

test("비례 비율 100% 이상이면 손익분기 판매가 없음", () => {
  const r = calculateProfit({ ...base, feeRate: 0.9, adCostRate: 0.1 });
  assert.equal(r.breakEvenPrice, null);
  assert.ok(r.warnings.length > 0);
});

test("보조 함수 단독", () => {
  assert.equal(calculateMargin(1000, 10000), 0.1);
  assert.equal(calculateMargin(1000, 0), null);
  assert.equal(calculateMargin(null, 1000), null);
  assert.equal(calculateROI(500, 1000), 0.5);
  assert.equal(calculateROI(500, 0), null);
  assert.equal(calculateBreakEvenPrice(10000, 0.2), 12500);
  assert.equal(calculateBreakEvenPrice(10000, 1), null);
  assert.equal(calculateBreakEvenUnits(10000, 3000), 4);
  assert.equal(calculateBreakEvenUnits(10000, 0), null);
});

test("환율 0 은 오류", () => {
  const r = calculateProfit({ ...base, exchangeRate: 0 });
  assert.equal(r.complete, false);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n수익성 계산 ${passed}/${tests.length}`);
