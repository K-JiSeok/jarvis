// npm run test:costs — PHASE 20 로켓그로스 비용 · 수입 원가 상세 계산 (순수 함수)
// [실측 대조] 표시 테스트는 2026-10-13 WING 화면에서 옮긴 실제 요율 · 화면 합계와 비교한다. 나머지는 모의 입력.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCards } from "./cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rc = await import("../../src/lib/costs/rate-cards.ts");
const { calculateCostDetail, solvePrice, costStates, COST_DETAIL_VERSION } = await import("../../src/lib/costs/detail.ts");
const { guessCategory } = await import("../../src/lib/costs/category.ts");
const { sanitizeItems, resolveSetting } = await import("../../src/lib/costs/settings.ts");
const { calculateProfit } = await import("../../src/lib/profit/calculate.ts");

const data = JSON.parse(readFileSync(join(here, "fixtures", "coupang-rates-2026-10-13.json"), "utf8"));
const cards = buildCards(data);
const TODAY = "2026-10-13";
const card = (kind, scope) => rc.pickCard(cards, kind, scope, TODAY);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// 요율표 ---------------------------------------------------------------------------------
test("[실측 대조] 입출고비 + 배송비 = WING '전체 보기' 합계 (2개 분류 × 11구간 × 6유형 = 132칸)", () => {
  let n = 0;
  for (const group of Object.keys(data.wingTotals).filter((k) => !k.startsWith("_"))) {
    const tot = data.wingTotals[group];
    const inout = card("RG_INOUT", group);
    const del = card("RG_DELIVERY", group);
    data.bands.forEach(([lo], i) => {
      data.sizes.forEach((sz, j) => {
        const want = tot.promo[i][j] ?? tot.base[j];
        const got = rc.bandCell(inout, lo, sz, TODAY).amount + rc.bandCell(del, lo, sz, TODAY).amount;
        assert.equal(got, want, `${group} ${rc.bandLabel(data.bands[i])} ${sz}`);
        n += 1;
      });
    });
  }
  assert.equal(n, 132);
});

test("[실측 대조] WING 표 붙여 넣기 해석: 11구간 · 기본 비용 · 할인가 (화면 복사 글 그대로)", () => {
  const t = rc.parseWingTable(readFileSync(join(here, "fixtures", "wing-total-ice-tray.txt"), "utf8"));
  assert.deepEqual(t.problems, []);
  assert.deepEqual(t.bands, data.bands);
  assert.deepEqual(t.base, data.wingTotals["주방 > 밀폐저장용기"].base);
  assert.deepEqual(t.promo, data.wingTotals["주방 > 밀폐저장용기"].promo);
});

test("WING 반품 회수비 표 (라벨 없는 '기본 · 적용가' 두 금액) 해석 + 구간이 끊긴 표는 문제로 남김", () => {
  const t = rc.parseWingTable(readFileSync(join(here, "fixtures", "wing-return-pickup-partial.txt"), "utf8"));
  assert.deepEqual(t.base, [2200, 2400, 3000, 4000, 5500, 9500]);
  assert.deepEqual(t.promo[0], [1150, 1575, 1850, 2300, 3500, 4625]);
  assert.deepEqual(t.promo[2], [1650, 1800, 2150, 3000, 4050, 4875]);
  assert.ok(t.problems.some((p) => /이어지지 않음/.test(p)));
  assert.ok(rc.parseWingTable("아무 표 아님").problems.length > 0);
});

test("크기 유형: 세 변의 합 · 무게 중 큰 유형 (경계값 포함) · 특대형 초과는 판정 안 함", () => {
  const rule = card("SIZE_RULE", "*").rates;
  assert.equal(rc.sizeType(rule, { l: 30, w: 30, h: 20, kg: 2 }).type, "XS"); // 80cm · 2kg 경계
  assert.equal(rc.sizeType(rule, { l: 30, w: 30, h: 20.1, kg: 1 }).type, "S"); // 80.1cm
  assert.equal(rc.sizeType(rule, { l: 20, w: 20, h: 20, kg: 3 }).type, "S"); // 60cm 이지만 3kg
  assert.equal(rc.sizeType(rule, { l: 50, w: 40, h: 30, kg: 1 }).type, "M"); // 120cm
  assert.equal(rc.sizeType(rule, { l: 100, w: 100, h: 51, kg: 1 }), null); // 251cm
  assert.match(rc.sizeType(rule, { l: 20, w: 20, h: 20, kg: 3 }).basis, /무게 3kg → 소형/);
});

test("[실측 대조] 보관비: WING 예시 0.004CBM → 46~60일 8원 · 61~120일 10원 · 121~180일 14원 · 181일~ 20원 / 일, 30일 무료", () => {
  const st = card("RG_STORAGE", "*");
  // WING 예시는 0.26 × 0.32 × 0.05 = 0.004CBM 으로 표기 (소수 셋째 자리) — 실제 CBM 반올림 규칙은 미확인이라 엔진은 정확한 부피를 쓴다
  const cbm = 0.004;
  assert.equal(rc.storageCost(st, cbm, 30, TODAY), 0); // 프로모션 30일 무료
  assert.equal(rc.storageCost(st, cbm, 60, TODAY), 30 * 8);
  assert.equal(rc.storageCost(st, cbm, 61, TODAY) - rc.storageCost(st, cbm, 60, TODAY), 10);
  assert.equal(rc.storageCost(st, cbm, 121, TODAY) - rc.storageCost(st, cbm, 120, TODAY), 14);
  assert.equal(rc.storageCost(st, cbm, 181, TODAY) - rc.storageCost(st, cbm, 180, TODAY), 20);
  // 도움말 예시: 0.001 CBM × 46~60일 요율 2,000원 = 2원/일
  assert.equal(rc.storageCost(st, 0.001, 46, TODAY) - rc.storageCost(st, 0.001, 45, TODAY), 2);
  // 프로모션 종료 후에는 1~30일도 1,000원/CBM/일
  assert.equal(rc.storageCost(st, cbm, 30, "2027-02-01"), 30 * 4);
});

test("판매 수수료: 주방용품 10.8% · 생활용품 기본 7.8% · 생활용품 > 수납/정리잡화 10.8% · 주방 제면기 7.8%", () => {
  assert.equal(rc.salesFeeRate(card("SALES_FEE", "주방용품"), "보관/밀폐용기 > 아이스트레이/얼음틀").rate, 0.108);
  assert.equal(rc.salesFeeRate(card("SALES_FEE", "주방용품"), "조리보조도구 > 제면기").rate, 0.078);
  assert.equal(rc.salesFeeRate(card("SALES_FEE", "생활용품"), "세탁용품").rate, 0.078);
  assert.equal(rc.salesFeeRate(card("SALES_FEE", "생활용품"), "수납/정리잡화 > 수납함").rate, 0.108);
});

test("요율 선택: 사용자 행 우선 · 적용 시작일 전 행 제외 · 프로모션 종료 후 기본 비용 · 최신 여부 경고", () => {
  const sys = card("SALES_FEE", "주방용품");
  const mine = { ...sys, id: "u1", ownerId: "me", verification: "USER_ENTERED", rates: { rate: 0.1, exceptions: [] }, validFrom: "2026-10-01" };
  const future = { ...mine, id: "u2", rates: { rate: 0.2, exceptions: [] }, validFrom: "2026-12-01" };
  assert.equal(rc.pickCard([sys, mine, future], "SALES_FEE", "주방용품", TODAY).id, "u1");
  assert.equal(rc.pickCard([sys, mine, future], "SALES_FEE", "주방용품", "2026-12-02").id, "u2");
  assert.equal(rc.pickCard([sys], "SALES_FEE", "주방용품", "2019-01-01"), null);
  const inout = card("RG_INOUT", "주방 > 밀폐저장용기");
  assert.equal(rc.bandCell(inout, 6710, "XS", TODAY).amount, 975);
  assert.equal(rc.bandCell(inout, 6710, "XS", "2027-02-01").amount, 1650);
  assert.ok(rc.cardFreshness(inout, "2027-01-15").some((w) => /프로모션 종료 \d+일 전/.test(w)));
  assert.ok(rc.cardFreshness(inout, "2026-12-01").some((w) => /확인한 지 \d+일/.test(w)));
  assert.ok(rc.cardFreshness(inout, TODAY).some((w) => /API 자동 갱신 아님/.test(w)));
});

// 상세 계산 ------------------------------------------------------------------------------
const FULL = {
  forwarderPerKg: { value: 5000, basis: "QUOTE" },
  volumetricDivisor: { value: 6000, basis: "QUOTE" },
  chinaDomesticPerShipment: { value: 10000, basis: "QUOTE" },
  agentFeeRate: { value: 0.05, basis: "QUOTE" },
  paymentFeeRate: { value: 0.01, basis: "USER" },
  customsBrokerPerShipment: { value: 33000, basis: "QUOTE", vatIncluded: true },
  domesticFreightPerShipment: { value: 22000, basis: "QUOTE", vatIncluded: true },
  inboundPrepPerShipment: { value: 0, basis: "USER" },
  inspectionPerUnit: { value: 100, basis: "QUOTE", vatIncluded: true },
  packagingPerUnit: { value: 150, basis: "QUOTE", vatIncluded: true },
  labelingPerUnit: { value: 0, basis: "USER" },
  adRate: { value: 0, basis: "USER" },
};
const base = (over = {}) => ({
  today: TODAY,
  cards,
  sale: { price: 9900, discount: null, source: "USER" },
  category: { salesScope: "주방용품", salesPath: "보관/밀폐용기 > 아이스트레이/얼음틀", feeGroup: "주방 > 밀폐저장용기", confirmed: true, basis: "사용자 확인" },
  pack: { l: 20, w: 15, h: 5, kg: 0.2, status: "MEASURED", basis: "실측" },
  supply: { kind: "OFFER", title: "[TEST] 실리콘 아이스 트레이", tiers: [{ minQty: 20, maxQty: 99, amount: 1.2, currency: "USD" }, { minQty: 100, maxQty: null, amount: 0.99, currency: "USD" }], tiersConverted: false, basePrice: { amount: 0.99, currency: "USD" }, moq: 20, fx: { currency: "USD", krw: 1400, source: "ECB", rateDate: "2026-10-10" }, unitsPerListing: 1, matchLevel: "HIGH", siteShipping: null },
  orderQty: 100,
  settings: sanitizeItems(FULL),
  overrides: {},
  taxType: "GENERAL",
  tariff: { rate: 0.08, hsCode: "3924100000", basis: "관세사 확인", confirmed: true },
  storageDays: null,
  returnRate: null,
  ...over,
});

test("모든 필수 비용 확인 → A 확인 비용 기준 이익 (일반과세자: 공급가액 기준, 매입 부가세 공제) · 손으로 계산한 값과 일치", () => {
  const d = calculateCostDetail(base());
  assert.equal(d.version, COST_DETAIL_VERSION);
  assert.equal(d.status, "CONFIRMED");
  assert.deepEqual(d.confirmed.blocking, []);
  const L = Object.fromEntries(d.lines.map((l) => [l.key, l]));
  assert.equal(L.goods.min, 1386); // 0.99 USD × 1400 (100개 구간)
  assert.equal(L.chinaDomesticPerShipment.min, 100); // 10,000 ÷ 100개
  assert.equal(L.agentFeeRate.min, 69); // 1386 × 5%
  assert.equal(L.intlFreight.min, 1250); // max(0.2kg, 1500/6000=0.25kg) = 0.25kg × 5,000
  assert.equal(L.duty.min, r((1386 + 100 + 1250) * 0.08)); // 과세가격 × 8%
  assert.equal(L.salesFee.min, r(9900 * 0.108 * 1.1));
  assert.equal(L.rgInout.min, r(975 * 1.1)); // 9,900원 = 5,000~10,000 구간 · 극소형 할인가 975
  assert.equal(L.rgDelivery.min, r(1525 * 1.1));
  // 이익 = 9900/1.1 − Σ(비용 − 공제 부가세) (보관 · 반품 제외)
  const aLines = d.lines.filter((l) => l.group !== "SCENARIO");
  const net = aLines.reduce((s, l) => s + (l.min - l.vatMin), 0);
  assert.equal(d.confirmed.outcome.profit, r(9900 / 1.1 - net));
  assert.ok(d.confirmed.excluded.some((x) => /보관비/.test(x)) && d.confirmed.excluded.some((x) => /반품/.test(x)));
});
const r = (n) => Math.round(n);

test("손익분기 판매가 · 목표 마진 판매가: 그 가격에서 처음으로 이익 ≥ 0 (구간 경계 포함)", () => {
  const d = calculateCostDetail(base());
  const be = d.confirmed.breakEven;
  assert.ok(be > 0);
  const at = (p) => calculateCostDetail(base({ sale: { price: p, discount: null, source: "USER" } })).confirmed.outcome;
  assert.ok(at(be).profit >= 0, `손익분기 ${be} 이익 ${at(be).profit}`);
  assert.ok(at(be - 1).profit < 0);
  const t20 = d.confirmed.targets.find((t) => t.margin === 0.2).price;
  assert.ok(at(t20).margin >= 0.2 && at(t20 - 1).margin < 0.2, `${t20}`);
  // 범용 풀이: 구간마다 1차인 함수
  assert.equal(solvePrice((p) => (p < 5000 ? p - 6000 : p - 5200), [5000]), 5200);
  assert.equal(solvePrice(() => -1, [5000]), null);
});

test("할인 적용: 판매가 10,500 − 판매자 할인 1,000 = 9,500원 기준으로 수수료 · 비용 구간 (10,000원 이상 구간이 아님)", () => {
  const d = calculateCostDetail(base({ sale: { price: 10500, discount: 1000, source: "USER" } }));
  assert.equal(d.salePrice, 9500);
  const L = Object.fromEntries(d.lines.map((l) => [l.key, l]));
  assert.equal(L.salesFee.min, r(9500 * 0.108 * 1.1));
  assert.equal(L.rgInout.min, r(975 * 1.1)); // 10,000~15,000 구간이면 1,000
});

test("부가세: 쿠팡 비용은 VAT 별도 (+10%) · 일반과세자 공제 / 간이과세자는 납부세액 추정(ESTIMATED) / 미확인이면 A 차단 · B 는 두 방식 범위", () => {
  const g = calculateCostDetail(base());
  const fee = g.lines.find((l) => l.key === "salesFee");
  assert.equal(fee.vatMin, r(9900 * 0.108 * 0.1));
  const s = calculateCostDetail(base({ taxType: "SIMPLIFIED" }));
  assert.equal(s.status, "ESTIMATE_ONLY");
  assert.ok(s.confirmed.blocking.some((b) => /간이과세자/.test(b)));
  const u = calculateCostDetail(base({ taxType: "UNKNOWN" }));
  assert.equal(u.confirmed.outcome, null);
  assert.ok(u.confirmed.blocking.some((b) => /부가세 처리/.test(b)));
  const gp = calculateCostDetail(base()).estimated.best.profit;
  const sp = calculateCostDetail(base({ taxType: "SIMPLIFIED" })).estimated.best.profit;
  assert.equal(u.estimated.best.profit, Math.max(gp, sp));
  assert.ok(u.estimated.worst.profit <= Math.min(gp, sp));
});

test("미확인 비용은 0 이 아님: 설정이 없으면 A 차단 · B 는 '미포함' 목록 · C 에 입력 방법", () => {
  const d = calculateCostDetail(base({ settings: {} }));
  assert.equal(d.status, "ESTIMATE_ONLY");
  assert.equal(d.confirmed.outcome, null);
  assert.ok(d.confirmed.blocking.some((b) => /구매대행/.test(b)));
  assert.ok(d.estimated.omitted.includes("구매대행 수수료율 (상품 매입가 대비)"));
  assert.ok(d.warnings.some((w) => /넣지 못한 비용 \d+개/.test(w)));
  const c = d.insufficient.find((x) => x.key === "agentFeeRate");
  assert.match(c.howTo, /profit\/rates/);
  assert.ok(costStates(d).includes("REQUIRED_UNKNOWN"));
  // 0 을 입력하면 0 으로 계산 (모름과 다름)
  const z = calculateCostDetail(base({ settings: sanitizeItems({ ...FULL, agentFeeRate: { value: 0, basis: "USER" } }) }));
  assert.equal(z.lines.find((l) => l.key === "agentFeeRate").min, 0);
  assert.equal(z.status, "CONFIRMED");
});

test("카테고리 추정 · 포장 추정 · 관세 미확정 → 확정 이익 차단 (추정 시나리오만)", () => {
  const cat = calculateCostDetail(base({ category: { salesScope: "주방용품", salesPath: null, feeGroup: "주방 > 밀폐저장용기", confirmed: false, basis: "추정" } }));
  assert.equal(cat.status, "ESTIMATE_ONLY");
  assert.ok(cat.confirmed.blocking.some((b) => /판매 수수료/.test(b)));
  const pk = calculateCostDetail(base({ pack: { l: 20, w: 15, h: 5, kg: 0.2, status: "SUPPLIER", basis: "공급 페이지" } }));
  assert.equal(pk.size.status, "ESTIMATED");
  assert.equal(pk.status, "ESTIMATE_ONLY");
  const tf = calculateCostDetail(base({ tariff: { rate: null, hsCode: null, basis: null, confirmed: false } }));
  const duty = tf.lines.find((l) => l.key === "duty");
  assert.equal(duty.status, "ESTIMATED");
  assert.ok(duty.max > duty.min); // 0~8% 범위
  assert.equal(tf.status, "ESTIMATE_ONLY");
});

test("크기 · 카테고리를 모르면 크기 유형을 정하지 않음 (입출고 · 배송 미확인), 분류만 모르면 요율표 범위 추정", () => {
  const d = calculateCostDetail(base({ pack: null }));
  assert.equal(d.size, null);
  assert.equal(d.lines.find((l) => l.key === "rgInout").status, "UNKNOWN");
  assert.equal(d.lines.find((l) => l.key === "storage").status, "UNKNOWN");
  const g = calculateCostDetail(base({ category: { salesScope: null, salesPath: null, feeGroup: null, confirmed: false, basis: "-" } }));
  const fee = g.lines.find((l) => l.key === "salesFee");
  assert.equal(fee.status, "ESTIMATED");
  assert.equal(fee.min, r(9900 * 0.04 * 1.1));
  assert.equal(fee.max, r(9900 * 0.109 * 1.1));
  const io = g.lines.find((l) => l.key === "rgInout");
  assert.equal(io.status, "ESTIMATED");
  assert.equal(io.min, r(Math.min(975, 800) * 1.1)); // 밀폐저장용기 975 · 테이블웨어 800
  assert.equal(io.max, r(975 * 1.1));
});

test("보관 기간 시나리오 (30 · 60 · 90 · 180일) · 예상 보관일 입력 시 그 값, 반품률 입력 시 회수 + 재입고", () => {
  const d = calculateCostDetail(base({ pack: { l: 30, w: 20, h: 10, kg: 0.5, status: "MEASURED", basis: "실측" } }));
  assert.deepEqual(d.storageTable.map((x) => x.days), [30, 60, 90, 180]);
  assert.equal(d.storageTable[0].cost, 0);
  const st = d.lines.find((l) => l.key === "storage");
  assert.equal(st.min, 0);
  assert.equal(st.max, d.storageTable[3].cost);
  const s90 = calculateCostDetail(base({ pack: { l: 30, w: 20, h: 10, kg: 0.5, status: "MEASURED", basis: "실측" }, storageDays: 90 })).lines.find((l) => l.key === "storage");
  assert.equal(s90.min, d.storageTable[2].cost);
  const ret = calculateCostDetail(base({ returnRate: 0.05 })).lines.find((l) => l.key === "returns");
  // 9,900원 · 극소형 · 밀폐저장용기 회수 1,150 + 재입고 400(할인) ~ 800(기본)
  assert.equal(ret.min, r(0.05 * (1150 + 400) * 1.1));
  assert.equal(ret.max, r(0.05 * (1150 + 800) * 1.1));
  assert.equal(ret.status, "ESTIMATED");
  assert.equal(calculateCostDetail(base()).lines.find((l) => l.key === "returns").status, "UNKNOWN");
});

test("주문 수량별 원가: MOQ 20개(1.2 USD) vs 100개(0.99 USD) · 건당 비용 배분 차이", () => {
  const d = calculateCostDetail(base());
  const q20 = d.qtyTable.find((x) => x.qty === 20);
  const q100 = d.qtyTable.find((x) => x.qty === 100);
  assert.match(q20.unitPrice, /1\.2 USD/);
  assert.ok(q20.landedMin > q100.landedMin);
  const lo = calculateCostDetail(base({ orderQty: 10 }));
  assert.ok(lo.warnings.some((w) => /최소 주문 수량 20개보다 적습니다/.test(w)));
});

test("공급 원가 없음 · 판매가 없음 → 수익성 분석 불가 (이익을 만들지 않음)", () => {
  const n = calculateCostDetail(base({ supply: null }));
  assert.equal(n.status, "NOT_ANALYZABLE");
  assert.equal(n.estimated.best, null);
  assert.deepEqual(costStates(n), ["NOT_ANALYZABLE"]);
  const p = calculateCostDetail(base({ sale: { price: null, discount: null, source: null } }));
  assert.equal(p.status, "NOT_ANALYZABLE");
  assert.ok(p.insufficient.some((x) => x.key === "salePrice"));
});

test("상태: 확인 이익 음수 → 원가 계산 가능 + 예상 손실 / 양수 → 예상 이익 (추천 아님)", () => {
  const loss = calculateCostDetail(base({ sale: { price: 4000, discount: null, source: "USER" } }));
  assert.deepEqual(costStates(loss), ["COST_COMPUTABLE", "EXPECTED_LOSS"]);
  const win = calculateCostDetail(base({ sale: { price: 30000, discount: null, source: "USER" } }));
  assert.deepEqual(costStates(win), ["COST_COMPUTABLE", "EXPECTED_PROFIT"]);
});

test("상품별 덮어쓰기는 기본 설정보다 우선 · 기본 설정 자체는 그대로", () => {
  const settings = sanitizeItems(FULL);
  const overrides = sanitizeItems({ forwarderPerKg: { value: 8000, basis: "QUOTE" } });
  assert.equal(resolveSetting("forwarderPerKg", settings, overrides).item.value, 8000);
  assert.equal(resolveSetting("forwarderPerKg", settings, overrides).from, "PRODUCT");
  assert.equal(settings.forwarderPerKg.value, 5000);
  const d = calculateCostDetail(base({ overrides }));
  assert.equal(d.lines.find((l) => l.key === "intlFreight").min, 2000); // 0.25kg × 8,000
  assert.deepEqual(sanitizeItems({ agentFeeRate: { value: -1 } }), {});
});

test("카테고리 추정: 실제 상품 노출 경로 → 대분류 · 비용 분류 (추정 표시)", () => {
  const ice = guessCategory("실리콘 얼음틀", "주방용품 > 밀폐저장/도시락 > 특수저장용기 > 얼음틀/마늘용기 > 얼음틀");
  assert.equal(ice.salesScope, "주방용품");
  assert.equal(ice.feeGroup, "주방 > 밀폐저장용기");
  const tray = guessCategory("모나코올리브 모던 실리콘 트레이 대형, 화이트, 1개", "결혼준비 > 주방용품 > 테이블웨어 > 쟁반/베드트레이 > 쟁반");
  assert.equal(tray.salesScope, "주방용품");
  assert.equal(tray.feeGroup, "주방 > 테이블웨어");
  assert.match(tray.basis, /추정/);
  const none = guessCategory("무언가", null);
  assert.equal(none.salesScope, null);
  assert.equal(none.feeGroup, null);
});

test("기존 Profit Engine (profit-v1) 결과 불변: 같은 입력 · 같은 출력", () => {
  const p = calculateProfit({ salePrice: 10000, unitCostAmount: 3000, exchangeRate: 1, intlShippingPerUnit: 500, domesticShippingPerUnit: null, feeRate: 0.108, logisticsFeePerUnit: 2500, adCostRate: null, adCostPerUnit: null, otherCostPerUnit: null, fixedCostTotal: null, expectedMonthlyUnits: null });
  assert.equal(p.formulaVersion, "profit-v1");
  assert.equal(p.netProfitPerUnit, 10000 - (3000 + 500 + 2500 + 1080));
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
console.log(`\nCosts ${passed}/${tests.length}`);
