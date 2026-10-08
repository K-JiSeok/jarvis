// npm run test:ingest — 수집기 어댑터 · 정규화 · 배치 행 변환 (순수 함수, DB 없음)
import assert from "node:assert/strict";

import { adaptProductPage, deliveryFromBadges, firstNumber, percentFromText, productIdFromUrl } from "../../src/lib/collectors/coupang/product.ts";
import { adaptSearchPage, searchParamsOf } from "../../src/lib/collectors/coupang/search.ts";
import { kstDate, normalizeKeyword, normalizeProduct, normalizeSearch } from "../../src/lib/collectors/normalize.ts";
import { prepareRows, toTable, parseCsv, autoMatch } from "../../src/lib/import/core.ts";
import { normalizedToBatchRows, preparedToBatchRows, recordData, recordKey } from "../../src/lib/ingest/batch-rows.ts";

import { MOCK_KEYWORD, MOCK_META, MOCK_PRODUCT_PAGE, MOCK_SEARCH_PAGE, mockProductSeries } from "./mock.mjs";

const groups = { Adapter: [], Normalize: [], Batch: [] };
const test = (g, name, fn) => groups[g].push([name, fn]);

// Adapter ----------------------------------------------------------------------------------
test("Adapter", "화면 문자열 → 숫자: 29,900원 · (1,234) · 4.5 · 없음", () => {
  assert.equal(firstNumber("29,900원"), 29900);
  assert.equal(firstNumber("(1,234)"), 1234);
  assert.equal(firstNumber("4.5점"), 4.5);
  assert.equal(firstNumber("품절"), null);
  assert.equal(firstNumber(null), null);
});
test("Adapter", "할인율은 % 가 있을 때만 · 상품 ID 는 /products/{id}", () => {
  assert.equal(percentFromText("15%"), 0.15);
  assert.equal(percentFromText("15"), null);
  assert.equal(productIdFromUrl("https://www.coupang.com/vp/products/8123456789?itemId=1"), "8123456789");
  assert.equal(productIdFromUrl("https://www.coupang.com/np/campaigns/1"), null);
});
test("Adapter", "배송 배지: 로켓그로스 · 로켓배송 · 로켓직구 · 모르는 배지 무시", () => {
  assert.equal(deliveryFromBadges(["로켓그로스", "내일 도착"]), "ROCKET_GROWTH");
  assert.equal(deliveryFromBadges(["로켓 배송"]), "ROCKET");
  assert.equal(deliveryFromBadges(["로켓직구"]), "OVERSEAS");
  assert.equal(deliveryFromBadges(["무료배송"]), null);
});
test("Adapter", "상품 페이지 → CollectedProduct (판매량·전환율 필드 없음)", () => {
  const c = adaptProductPage(MOCK_PRODUCT_PAGE, MOCK_META);
  assert.equal(c.coupangProductId, "9900000701");
  assert.equal(c.productName, "[TEST] 실리콘 주방 트레이 3종 세트");
  assert.deepEqual([c.price, c.originalPrice, c.rating, c.reviewCount, c.deliveryType], [29900, 35000, 4.5, 1234, "ROCKET_GROWTH"]);
  assert.equal(c.discountRate, null);
  for (const k of ["salesActual", "salesEstimated", "conversionRate", "views28d", "adBid"]) assert.ok(!(k in c), k);
});
test("Adapter", "검색 페이지 → 키워드·페이지는 URL 에서, 순위는 자연·광고 따로 센 순서 (PHASE 11 실제 화면 기준)", () => {
  assert.deepEqual(searchParamsOf(MOCK_SEARCH_PAGE.url), { keyword: "[TEST] 실리콘 트레이", page: 1 });
  const s = adaptSearchPage(MOCK_SEARCH_PAGE, MOCK_META);
  assert.equal(s.keyword, "[TEST] 실리콘 트레이");
  assert.deepEqual(s.items.map((x) => [x.coupangProductId, x.rank, x.isAd, x.displayPosition]), [
    ["9900000702", 1, true, 1],
    ["9900000701", 1, false, 2],
    ["9900000703", 2, false, 3],
    [null, 3, false, 4],
  ]);
});

// Normalize --------------------------------------------------------------------------------
test("Normalize", "상품: 출처·신뢰도·KST 수집일 · 파생 할인율(CALCULATED) · 배송·판매자 코드", () => {
  const { record, issues } = normalizeProduct(adaptProductPage(MOCK_PRODUCT_PAGE, MOCK_META));
  assert.deepEqual(issues, []);
  assert.equal(record.kind, "PRODUCT_SNAPSHOT");
  assert.equal(record.source, "EXTENSION");
  assert.equal(record.confidence, "B");
  assert.equal(record.capturedOn, "2026-10-07");
  assert.equal(record.capturedAt, "2026-10-07T05:30:00.000Z");
  assert.deepEqual(record.metrics, {
    product_name_observed: "[TEST] 실리콘 주방 트레이 3종 세트",
    price: 29900,
    original_price: 35000,
    review_count: 1234,
    rating: 4.5,
    delivery_type: "ROCKET_GROWTH",
    seller_type_observed: "ROCKET_GROWTH_SELLER",
    discount_rate: 0.1457,
  });
  assert.deepEqual(record.calculated, ["discount_rate"]);
});
test("Normalize", "KST 날짜 경계: 2026-10-07T15:00Z = 10-08 (KST 00:00)", () => {
  assert.equal(kstDate("2026-10-07T14:59:59Z"), "2026-10-07");
  assert.equal(kstDate("2026-10-07T15:00:00Z"), "2026-10-08");
  assert.equal(kstDate("어제"), null);
});
test("Normalize", "NULL 은 넣지 않음 · 0 은 실제 0", () => {
  const { record } = normalizeProduct({ ...MOCK_META, coupangProductId: "9900000701", price: null, reviewCount: 0, rating: undefined });
  assert.deepEqual(record.metrics, { review_count: 0 });
});
test("Normalize", "WING 지표는 WING_SESSION 일 때만 (아니면 버리고 issue)", () => {
  const wing = { views28d: "1,200", conversionRate: "4.1%" };
  const a = normalizeProduct({ ...MOCK_META, coupangProductId: "9900000701", price: 1000, wing });
  assert.ok(!("views_28d" in a.record.metrics));
  assert.equal(a.issues[0].field, "wing");
  const b = normalizeProduct({ ...MOCK_META, source: "WING_SESSION", coupangProductId: "9900000701", wing });
  assert.deepEqual(b.record.metrics, { views_28d: 1200, conversion_rate: 0.041 });
});
test("Normalize", "신뢰도 미지정 · 허용 안 된 출처 · 잘못된 시각 · 미래 시각 · 상품 ID 없음 → 레코드 없음", () => {
  assert.equal(normalizeProduct({ ...MOCK_META, confidence: undefined, coupangProductId: "1", price: 1 }).record, null);
  assert.equal(normalizeProduct({ ...MOCK_META, source: "CALCULATED", coupangProductId: "1", price: 1 }).record, null);
  assert.equal(normalizeProduct({ ...MOCK_META, capturedAt: "?", coupangProductId: "1", price: 1 }).record, null);
  assert.equal(normalizeProduct({ ...MOCK_META, capturedAt: "2999-01-01T00:00:00Z", coupangProductId: "1", price: 1 }).record, null);
  const noId = normalizeProduct({ ...MOCK_META, productUrl: "https://www.coupang.com/np/search?q=a", price: 1 });
  assert.equal(noId.record, null);
  assert.ok(noId.issues.some((i) => i.field === "coupangProductId"));
});
test("Normalize", "잘못된 값은 그 필드만 버리고 issue (평점 7 · 리뷰 '많음')", () => {
  const { record, issues } = normalizeProduct({ ...MOCK_META, coupangProductId: "9900000701", price: 1000, rating: 7, reviewCount: "많음" });
  assert.deepEqual(record.metrics, { price: 1000 });
  assert.deepEqual(issues.map((i) => i.field), ["review_count", "rating"]);
});
test("Normalize", "검색 결과 → 순위 레코드 (상품 ID 없는 항목은 issue · 광고 1위 / 자연 1·2위)", () => {
  const { records, issues } = normalizeSearch(adaptSearchPage(MOCK_SEARCH_PAGE, MOCK_META));
  assert.deepEqual(records.map((r) => [r.coupangProductId, r.rankPosition, r.isAd, r.page]), [
    ["9900000702", 1, true, 1],
    ["9900000701", 1, false, 1],
    ["9900000703", 2, false, 1],
  ]);
  assert.equal(issues.length, 1);
  assert.equal(records[0].keyword, "[TEST] 실리콘 트레이");
});
test("Normalize", "키워드: 문자열 숫자 · % 비율 · 소수 비율 · 파생 경쟁강도·증감률", () => {
  const { record, issues } = normalizeKeyword(MOCK_KEYWORD);
  assert.deepEqual(issues, []);
  assert.equal(record.keyword, "[TEST] 실리콘 트레이");
  assert.deepEqual(record.metrics, {
    search_volume: 12000,
    search_volume_previous: 10000,
    coupang_product_count: 30000,
    wing_ratio: 0.45,
    rocket_ratio: 0.5,
    average_reviews: 800,
    competition_intensity: 2.5,
    search_growth_rate: 0.2,
  });
});
test("Normalize", "키워드 비율 숫자 45 (소수 아님) → 범위 밖 issue", () => {
  const { record, issues } = normalizeKeyword({ ...MOCK_KEYWORD, wingRatio: 45 });
  assert.ok(!("wing_ratio" in record.metrics));
  assert.equal(issues[0].field, "wing_ratio");
});

// Batch ------------------------------------------------------------------------------------
test("Batch", "레코드 → DB 컬럼 (id 모르면 쿠팡 상품 ID · 키워드 텍스트)", () => {
  const { record } = normalizeProduct(adaptProductPage(MOCK_PRODUCT_PAGE, MOCK_META));
  const d = recordData(record);
  assert.equal(d.coupang_product_id, "9900000701");
  assert.ok(!("product_id" in d));
  assert.equal(d.source_type, "EXTENSION");
  assert.deepEqual(d.metric_meta, { discount_rate: { source: "CALCULATED", confidence: "B" } });
  assert.equal(recordData(record, { productId: "uuid-1" }).product_id, "uuid-1");
  const rank = normalizeSearch(adaptSearchPage(MOCK_SEARCH_PAGE, MOCK_META)).records[0];
  assert.deepEqual(recordData(rank), {
    keyword: "[TEST] 실리콘 트레이",
    coupang_product_id: "9900000702",
    captured_on: "2026-10-07",
    captured_at: "2026-10-07T05:30:00.000Z",
    source_type: "EXTENSION",
    confidence: "B",
    rank_position: 1,
    is_ad: true,
    page: 1,
  });
});
test("Batch", "배치 안 같은 자연키 → 뒤의 것 SKIPPED (DUPLICATE_IN_BATCH)", () => {
  const { record } = normalizeProduct(adaptProductPage(MOCK_PRODUCT_PAGE, MOCK_META));
  const rows = normalizedToBatchRows([record, record, { ...record, capturedOn: "2026-10-06" }]);
  assert.deepEqual(rows.map((r) => [r.row_number, r.status, r.error_code ?? null]), [[1, "VALID", null], [2, "SKIPPED", "DUPLICATE_IN_BATCH"], [3, "VALID", null]]);
  assert.equal(rows[0].record_key, "product_snapshot:9900000701:2026-10-07:EXTENSION");
});
test("Batch", "파일 검증 결과 → 배치 행 (정상 VALID · 주의 VALID+사유 · 오류 FAILED · 중복 SKIPPED)", () => {
  const t = toTable(parseCsv("상품ID,날짜,가격,배송유형\n9900000701,2026-10-07,100,\n9900000999,2026-10-07,1,\n9900000701,2026-10-07,2,\n9900000701,2026-10-06,3,퀵"));
  const lookups = { products: new Map([["9900000701", "p-1"]]), keywords: new Map() };
  const mapping = Object.fromEntries(autoMatch("PRODUCT_SNAPSHOTS", t.headers).map((m) => [m.index, m.field ?? ""]));
  const p = prepareRows("PRODUCT_SNAPSHOTS", t, mapping, { source: "MANUAL", confidence: "B", salesPeriodDays: null, ratioUnits: {}, today: "2026-10-08" }, lookups);
  const rows = preparedToBatchRows("PRODUCT_SNAPSHOTS", p.rows);
  assert.deepEqual(rows.map((r) => [r.row_number, r.status, r.error_code ?? null]), [
    [2, "VALID", null],
    [3, "FAILED", "PRODUCT_NOT_FOUND"],
    [4, "SKIPPED", "DUPLICATE_IN_FILE"],
    [5, "VALID", null],
  ]);
  assert.equal(rows[0].data.product_id, "p-1");
  assert.ok(rows[3].error_message.includes("배송 유형"));
  assert.deepEqual(rows[1].data, {});
  assert.equal(rows[0].payload.raw["상품ID"], "9900000701");
});
test("Batch", "recordKey 는 PHASE 9 파일 가져오기와 같은 형식", () => {
  const { record } = normalizeKeyword(MOCK_KEYWORD);
  assert.equal(recordKey(record), "keyword_snapshot:[test] 실리콘 트레이:2026-10-07:EXTENSION");
});
test("Batch", "대량: 상품 20개 × 100일 = 2,000 레코드 → 배치 행 변환 (중복 없음)", () => {
  const ids = Array.from({ length: 20 }, (_, i) => String(9900000700 + i));
  const records = mockProductSeries(ids, 100).map((c) => normalizeProduct(c).record);
  const t0 = performance.now();
  const rows = normalizedToBatchRows(records);
  const ms = performance.now() - t0;
  assert.equal(rows.length, 2000);
  assert.ok(rows.every((r) => r.status === "VALID"));
  assert.ok(ms < 500, `${ms}ms`);
});

let total = 0;
let passed = 0;
for (const [group, tests] of Object.entries(groups)) {
  let p = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      p += 1;
      console.log(`  ✓ [${group}] ${name}`);
    } catch (error) {
      console.error(`  ✗ [${group}] ${name}\n    ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`  ${group}: ${p}/${tests.length}`);
  total += tests.length;
  passed += p;
}
console.log(`\nIngest ${passed}/${total}`);
