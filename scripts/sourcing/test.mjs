// npm run test:sourcing — PHASE 18 중국 도매 소싱 순수 함수 (공급 페이지 해석 · 검색어 · 링크 · 매칭 · 도착 원가)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { adaptSupplierPage, parseMoney, parseQtyRange, parseWeightKg, siteOf, currencyOf } = await import("../../src/lib/collectors/supplier/page.ts");
const { toSourcingQuery, packQtyOf } = await import("../../src/lib/sourcing/translate.ts");
const { searchLinks, imageSearchLink, jarvisPidOf } = await import("../../src/lib/sourcing/links.ts");
const { matchSupply } = await import("../../src/lib/sourcing/matching.ts");
const { calculateLandedCost, pickUnitPrice, TARIFF_RANGE } = await import("../../src/lib/sourcing/landed-cost.ts");
const { calculateProfit } = await import("../../src/lib/profit/calculate.ts");

const fixture = JSON.parse(readFileSync(join(here, "fixtures", "alibaba-ice-cube-tray.json"), "utf8"));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// 공급 페이지 해석 ------------------------------------------------------------------------
test("Alibaba 실제 페이지: 상품 ID · 이름 · 이미지 · 원래 통화 가격(USD 0.99) · 구간 가격(원화 표시) · MOQ · 공급업체 · 속성", () => {
  const { offer, issues } = adaptSupplierPage(fixture);
  assert.equal(offer.site, "ALIBABA");
  assert.equal(offer.siteProductId, "1600527072719");
  assert.equal(offer.url, "https://www.alibaba.com/product-detail/Food-Grade-Silicone-Rectangle-Ice-Cube_1600527072719.html");
  assert.match(offer.title, /^새로운 디자인 실리콘 아이스 큐브 트레이/);
  assert.ok(!/Buy/.test(offer.title));
  assert.equal(offer.imageUrls.length, 3);
  assert.deepEqual(offer.basePrice, { amount: 0.99, currency: "USD" });
  assert.deepEqual(offer.tiers.map((t) => [t.minQty, t.maxQty, t.amount, t.currency]), [[20, 99, 1772, "KRW"], [100, 999, 1704, "KRW"], [1000, 9999, 1636, "KRW"], [10000, null, 1350, "KRW"]]);
  assert.equal(offer.tiersConverted, true); // 표시는 원화, 사이트 기준은 USD
  assert.equal(offer.moq, 20);
  assert.equal(offer.supplierName, "Shenzhen Armada Technology Co., Ltd.");
  assert.equal(offer.supplierMeta.years, 15);
  assert.equal(offer.material, "실리콘");
  assert.equal(offer.sizeText, "17.5cm * 14.5cm * 4cm");
  assert.equal(offer.weightKg, 0.152); // 총중량 우선
  assert.equal(offer.categoryPath, "가정 및 정원 > 주방용품 > 주방 도구 & 소형용품 > 아이스크림 도구");
  assert.deepEqual(offer.shipping && [offer.shipping.perQty, offer.shipping.amount, offer.shipping.currency], [20, 14215, "KRW"]);
  assert.deepEqual(offer.colors, ["옐로우", "블랙"]);
  assert.equal(issues.length, 0, issues.join(" / "));
});
test("공급 페이지: 지원하지 않는 주소 · 가격 없음 → 값을 만들지 않음 (null · 문제 기록)", () => {
  assert.equal(adaptSupplierPage({ ...fixture, url: "https://www.coupang.com/vp/products/1" }).offer, null);
  const bare = adaptSupplierPage({ ...fixture, url: "https://detail.1688.com/offer/712345678901.html", jsonLd: [], priceTiers: [], attributes: [], shippingText: null, h1: "硅胶冰格 食品级", supplierCardText: null });
  assert.equal(bare.offer.site, "1688");
  assert.equal(bare.offer.basePrice, null);
  assert.equal(bare.offer.moq, null);
  assert.equal(bare.offer.weightKg, null);
  assert.ok(bare.issues.some((x) => /가격을 읽지 못했습니다/.test(x)));
});
test("공급 페이지: 금액 · 수량 · 무게 · 통화 · 사이트 판별", () => {
  assert.deepEqual(parseMoney("US$0.99-1.20"), { amount: 0.99, currency: "USD" });
  assert.deepEqual(parseMoney("¥3.50"), { amount: 3.5, currency: "CNY" });
  assert.equal(parseMoney("가격 문의"), null);
  assert.deepEqual(parseQtyRange("1,000-9,999 개"), { min: 1000, max: 9999 });
  assert.deepEqual(parseQtyRange("≥10,000 개"), { min: 10000, max: null });
  assert.deepEqual(parseQtyRange("2件起批"), null);
  assert.equal(parseWeightKg("126g"), 0.126);
  assert.equal(parseWeightKg("모름"), null);
  assert.equal(currencyOf("₩1,772"), "KRW");
  assert.deepEqual(siteOf("https://item.taobao.com/item.htm?spm=a&id=6789012345"), { site: "TAOBAO", id: "6789012345" });
  assert.deepEqual(siteOf("https://detail.1688.com/offer/712345678901.html?spm=x"), { site: "1688", id: "712345678901" });
});

// 검색어 · 링크 -----------------------------------------------------------------------------
test("검색어: 실제 쿠팡 상품명 → 중국어 · 영어 (브랜드 · 색상 · 판매 문구 제외, 사전에 없는 말은 unmapped 로 남김)", () => {
  const a = toSourcingQuery("모나코올리브 모던 실리콘 트레이 대형, 화이트, 1개");
  assert.equal(a.zh, "硅胶托盘大号");
  assert.equal(a.en, "silicone tray large");
  assert.deepEqual(a.unmapped, ["모나코올리브"]);
  assert.equal(a.packQty, 1);
  const b = toSourcingQuery("국산 프리미엄 실리콘 얼음트레이 15구, 핑크 뚜껑포함, 2개");
  assert.equal(b.zh, "硅胶冰格");
  assert.equal(b.cavities, 15);
  assert.equal(b.packQty, 2);
  const c = toSourcingQuery("밀폐 실리콘큐브 2개세트 냉동 보관 얼음틀");
  assert.ok(c.zh.includes("冰格") && c.zh.includes("硅胶"));
  assert.ok(c.unmapped.includes("밀폐") || c.unmapped.includes("보관"));
  assert.equal(packQtyOf("로빈홈즈 1+1 실리콘 사각 얼음트레이"), 2);
});
test("링크: 1688 · 타오바오(중국어) · Alibaba(영어 · 원문) + jarvis_pid, 확인 여부 표시 · 이미지 검색은 이미지 주소 있을 때만", () => {
  const pid = "af9c4092-98c6-43ca-9f8e-73caf6ccd289";
  const links = searchLinks(toSourcingQuery("모나코올리브 모던 실리콘 트레이 대형"), pid);
  assert.deepEqual(links.map((l) => [l.site, l.lang, l.verified]), [["1688", "zh", false], ["TAOBAO", "zh", false], ["ALIBABA", "en", true], ["ALIBABA", "ko", true]]);
  assert.ok(links[0].url.includes(encodeURIComponent("硅胶托盘大号")) && links[0].url.includes("charset=utf8"));
  assert.equal(jarvisPidOf(links[2].url), pid);
  assert.equal(jarvisPidOf("https://www.alibaba.com/trade/search?SearchText=x&jarvis_pid=../../etc"), null);
  assert.equal(imageSearchLink(null), null);
  assert.match(imageSearchLink("https://sc04.alicdn.com/kf/a.jpg").url, /^https:\/\/lens\.google\.com\/uploadbyurl\?url=/);
});

// 매칭 ----------------------------------------------------------------------------------------
const { offer } = adaptSupplierPage(fixture);
test("매칭: 얼음 트레이 ↔ 실제 Alibaba 얼음 트레이 → 유사(추가 확인) — 이미지 미측정이라 높은 일치 아님", () => {
  const m = matchSupply({ product: { name: "실리콘 대형 얼음트레이 하이볼 얼음틀 8구, 1개, 블랙", categoryPath: "주방용품 > 밀폐저장/도시락 > 특수저장용기 > 얼음틀/마늘용기 > 얼음틀" }, offer });
  assert.equal(m.level, "SIMILAR");
  assert.ok(m.reasons.some((r) => r.startsWith("종류 일치: ice_tray")));
  assert.ok(m.reasons.some((r) => r.startsWith("재질 일치: silicone")));
  assert.ok(m.unknown.some((u) => /이미지 유사도 미측정/.test(u)));
  assert.equal(m.unitsPerListing, 1);
});
test("매칭: 서빙 트레이 ↔ 얼음 트레이 → 종류 다름 · 불명확 (같은 '트레이' 단어로 묶지 않음)", () => {
  const m = matchSupply({ product: { name: "모나코올리브 모던 실리콘 트레이 대형, 화이트, 1개", categoryPath: null }, offer });
  assert.equal(m.level, "UNCLEAR");
  assert.ok(m.conflicts.some((c) => /종류 다름/.test(c)));
});
test("매칭: 구성 수량 다름(쿠팡 2개 묶음 · 공급 1개) → 별도 상품 · 원가 ×2 환산 · 이미지 유사 높아도 높은 일치 불가", () => {
  const m = matchSupply({ product: { name: "로빈홈즈 1+1 실리콘 사각 얼음트레이, 2개", categoryPath: null }, offer, imageSimilarity: 0.95 });
  assert.equal(m.unitsPerListing, 2);
  assert.ok(m.conflicts.some((c) => /구성 수량 다름/.test(c)));
  assert.notEqual(m.level, "HIGH");
  const same = matchSupply({ product: { name: "실리콘 얼음트레이 1개", categoryPath: "주방용품" }, offer, imageSimilarity: 0.95 });
  assert.equal(same.level, "HIGH");
});

test("매칭 (실제 저장 후보에서 발견): 서빙 트레이 ↔ '레진 트레이 몰드' · '냉동 트레이 큐브 몰드' → 종류 다름 · 불명확", () => {
  const p = { name: "모나코올리브 모던 실리콘 트레이 대형, 화이트, 1개", categoryPath: null };
  for (const title of ["다용도 실리콘 레진 트레이 몰드, 불규칙 모양 보석 및 에폭시 주조 몰드", "실리콘 냉동 트레이(뚜껑 포함) 대용량 음식 큐브 몰드 (수프, 육수, 식사 준비용)"]) {
    const m = matchSupply({ product: p, offer: { ...offer, title, attributes: {}, categoryPath: null } });
    assert.equal(m.level, "UNCLEAR", title);
    assert.ok(m.conflicts.some((c) => /공급 상품에 mold 포함/.test(c)), m.conflicts.join(" / "));
  }
});
test("배송비 문구를 숫자로 못 읽으면 원문은 보관하고 원가 계산에는 쓰지 않음", () => {
  const { offer: o, issues } = adaptSupplierPage({ ...fixture, shippingText: "Shipping 배송비: 공급업체에 문의 운송 시간: Est. 8-10 일" });
  assert.deepEqual([o.shipping.perQty, o.shipping.amount, o.shipping.currency], [null, null, null]);
  assert.match(o.shipping.text, /공급업체에 문의/);
  assert.ok(issues.some((x) => /원문만 보관/.test(x)));
});

// 도착 원가 · 수익성 -------------------------------------------------------------------------
const FX = { currency: "USD", krw: 1341.49, source: "ECB 기준환율 (frankfurter.app)", rateDate: "2026-10-09" };
test("도착 원가: 실제 Alibaba 값 (20개 구간 ₩1,772 · 표시 배송비 20개당 ₩14,215) → 확인 · 추정 · 미확인 구분, 미확인을 0 으로 넣지 않음", () => {
  const unit = pickUnitPrice(offer, 20);
  assert.deepEqual([unit.amount, unit.currency, unit.displayConverted], [1772, "KRW", true]);
  const r = calculateLandedCost({ unitPrice: unit, unitsPerListing: 1, fx: FX, shipping: { perQty: 20, amountKrw: 14215, text: offer.shipping.text }, orderQty: 20, salePrice: 9900, feeRate: null });
  const line = (k) => r.lines.find((l) => l.key === k);
  assert.deepEqual([line("goods").min, line("goods").status], [1772, "CONFIRMED"]);
  assert.deepEqual([line("shipping").min, line("shipping").status], [711, "CONFIRMED"]); // 14,215 ÷ 20 = 710.75
  // 과세가격 = 1,772 + 710.75 = 2,482.75 → 관세 0~8% = 0~199 · 부가세 = 248~268
  assert.deepEqual([line("duty").min, line("duty").max, line("duty").status], [0, 199, "ESTIMATED"]);
  assert.deepEqual([line("vat").min, line("vat").max], [248, 268]);
  assert.deepEqual(r.landed, { min: 2731, max: 2950 }); // 2,482.75 + 248.275 / 2,482.75 + 198.62 + 268.137
  assert.ok(r.unknownItems.length >= 4 && r.unknownItems.every((u) => r.lines.find((l) => l.label === u).min === null));
  assert.equal(r.confidence, "C");
  assert.equal(r.confirmedProfitability, false);
  // 이익은 Profit Engine 그대로: 판매가 9,900 · 수수료 10.8% · 원가 1,772 · 운송 711 · 관부가세(나쁜 경우) 467
  const direct = calculateProfit({ salePrice: 9900, unitCostAmount: 1772, exchangeRate: 1, intlShippingPerUnit: 711, domesticShippingPerUnit: null, feeRate: 0.108, logisticsFeePerUnit: null, adCostRate: null, adCostPerUnit: null, otherCostPerUnit: 467, fixedCostTotal: null, expectedMonthlyUnits: null });
  assert.equal(r.profit.low.netProfitPerUnit, direct.netProfitPerUnit);
  assert.equal(r.profit.low.netProfitPerUnit, 9900 - (1772 + 711 + 467 + 1069));
  assert.ok(r.profit.high.netProfitPerUnit > r.profit.low.netProfitPerUnit);
  // 목표 마진 30% 판매가 (나쁜 경우) = 2,950 ÷ (1 − 0.108 − 0.3)
  assert.equal(r.targetPrices.find((t) => t.margin === 0.3).max, Math.round(2950 / (1 - 0.108 - 0.3)));
});
test("도착 원가: 원래 통화(USD) + 환율 · 환율 없으면 계산 안 함 · 운송비 없으면 미확인 + 세액 과소 경고 · 묶음 ×2", () => {
  const r = calculateLandedCost({ unitPrice: { amount: 0.99, currency: "USD", basis: "구조화 데이터 가격", displayConverted: false }, unitsPerListing: 2, fx: FX, shipping: null, orderQty: 10000, salePrice: null, feeRate: 0.108 });
  assert.equal(r.lines.find((l) => l.key === "goods").min, Math.round(0.99 * 1341.49 * 2));
  assert.equal(r.lines.find((l) => l.key === "shipping").status, "UNKNOWN");
  assert.ok(r.warnings.some((w) => /과세가격 · 세액이 낮게/.test(w)));
  assert.equal(r.profit, null);
  const noFx = calculateLandedCost({ unitPrice: { amount: 3.5, currency: "CNY", basis: "x", displayConverted: false }, unitsPerListing: 1, fx: FX, shipping: null, orderQty: 1, salePrice: 9900, feeRate: null });
  assert.equal(noFx.landed, null);
  assert.deepEqual(noFx.unknownItems, ["환율"]);
  assert.equal(TARIFF_RANGE.max, 0.08);
});

// PHASE 19: 확인 비용만 · 산출 불가 · 계산 이력 지문 · 공급 상태 ------------------------------------
const { costRecord, fingerprint, supplyState } = await import("../../src/lib/sourcing/cost-record.ts");
const base19 = { unitPrice: { amount: 3271, currency: "KRW", basis: "200~1999개 구간 가격", displayConverted: true }, unitsPerListing: 1, fx: null, shipping: { perQty: 200, amountKrw: 725060, text: "해상 + 특송 200개당 ₩725,060" }, orderQty: 200, salePrice: 6710 };

test("확인 비용만: 수수료율 미설정이면 산출 불가 (추정 수수료를 넣지 않음) · 설정되면 Profit Engine 으로 계산 · 제외 항목 표시", () => {
  const none = calculateLandedCost({ ...base19, feeRate: null });
  assert.equal(none.confirmedOnly.cost, 3271 + 3625); // 매입가 + 표시 운송비 (725,060 ÷ 200 = 3,625.3)
  assert.equal(none.confirmedOnly.profit, null);
  assert.ok(none.insufficient.some((x) => /수수료율 미설정/.test(x)));
  assert.ok(none.confirmedOnly.excluded.some((x) => /관세/.test(x)) && none.confirmedOnly.excluded.some((x) => /부가세/.test(x)));
  const set = calculateLandedCost({ ...base19, feeRate: 0.108 });
  const direct = calculateProfit({ salePrice: 6710, unitCostAmount: 3271, exchangeRate: 1, intlShippingPerUnit: 3625, domesticShippingPerUnit: null, feeRate: 0.108, logisticsFeePerUnit: null, adCostRate: null, adCostPerUnit: null, otherCostPerUnit: 0, fixedCostTotal: null, expectedMonthlyUnits: null });
  assert.equal(set.confirmedOnly.profit.netProfitPerUnit, direct.netProfitPerUnit);
  // 확인 비용만 계산은 추정 포함(나쁜 경우)보다 항상 이익이 크다 = 확정 수익으로 쓰면 안 되는 이유
  assert.ok(set.confirmedOnly.profit.netProfitPerUnit > set.profit.low.netProfitPerUnit);
  const noPrice = calculateLandedCost({ ...base19, salePrice: null, feeRate: 0.108 });
  assert.ok(noPrice.insufficient.some((x) => /판매가 없음/.test(x)));
});
test("계산 이력: 같은 입력 = 같은 지문 (다시 쌓지 않음) · 환율 · 공급가 · 판매가가 바뀌면 새 지문 · 계산 시각은 지문에 없음", () => {
  const FX2 = { currency: "USD", krw: 1341.49, source: "ECB", rateDate: "2026-10-09" };
  const mk = (over = {}) => {
    const unit = { amount: 0.99, currency: "USD", basis: "x", displayConverted: false, tierMinQty: 20, ...(over.unit ?? {}) };
    const fx = over.fx ?? FX2;
    const landed = calculateLandedCost({ unitPrice: unit, unitsPerListing: 1, fx, shipping: null, orderQty: 20, salePrice: over.salePrice ?? 6710, feeRate: null });
    return costRecord({ productId: "p", offerId: "o", linkId: "l", matchLevel: "UNCLEAR", salePrice: over.salePrice ?? 6710, feeRate: null, orderQty: 20, unitsPerListing: 1, unitPrice: unit, landed, profitFormulaVersion: "profit-v1" });
  };
  const a = mk();
  assert.equal(a.input_hash, mk().input_hash);
  assert.notEqual(a.input_hash, mk({ fx: { ...FX2, krw: 1333.09, rateDate: "2026-10-12" } }).input_hash);
  assert.notEqual(a.input_hash, mk({ unit: { amount: 1.05 } }).input_hash);
  assert.notEqual(a.input_hash, mk({ salePrice: 7900 }).input_hash);
  assert.equal(a.fee_source, "ESTIMATED_RANGE");
  assert.equal(a.match_level, "UNCLEAR");
  assert.deepEqual(a.engine, { landed: "landed-cost-v1", match: "supply-match-v1", profit: "profit-v1" });
  assert.equal(fingerprint({ x: 1 }), fingerprint({ x: 1 }));
  assert.equal(a.input_hash.length, 16);
});
test("공급 상태: 제외 후보는 빼고 · 선택 전에는 원가 상태 없음 · 선택 후보만 원가 · 손실 / 불명확 표시 (이익이어도 추천 아님)", () => {
  const loss = { landed: { min: 7586, max: 8193 }, unknownItems: ["a"], confidence: "C", profit: { low: { netProfitPerUnit: -2208 }, high: { netProfitPerUnit: -1144 } } };
  assert.deepEqual(supplyState([]), ["NO_CANDIDATE"]);
  assert.deepEqual(supplyState([{ userStatus: "REJECTED", matchLevel: "SIMILAR", landed: loss }]), ["NO_CANDIDATE"]);
  assert.deepEqual(supplyState([{ userStatus: "CANDIDATE", matchLevel: "UNCLEAR", landed: loss }]), ["COLLECTED", "MATCH_UNCLEAR"]);
  assert.deepEqual(supplyState([{ userStatus: "REJECTED", matchLevel: "UNCLEAR", landed: loss }, { userStatus: "SELECTED", matchLevel: "UNCLEAR", landed: loss }]), ["SELECTED", "MATCH_UNCLEAR", "ESTIMATE_ONLY", "UNKNOWN_COSTS", "EXPECTED_LOSS"]);
  const gain = { ...loss, profit: { low: { netProfitPerUnit: 300 }, high: { netProfitPerUnit: 900 } } };
  assert.ok(supplyState([{ userStatus: "SELECTED", matchLevel: "SIMILAR", landed: gain }]).includes("EXPECTED_PROFIT"));
  assert.deepEqual(supplyState([{ userStatus: "SELECTED", matchLevel: "SIMILAR", landed: null }]), ["SELECTED", "NOT_COMPUTABLE"]);
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
console.log(`\nSourcing ${passed}/${tests.length}`);
