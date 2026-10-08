// npm run test:import — src/lib/import/core.ts (CSV · 매핑 · 값 변환 · 검증 · 정규화) + read-excel-file(XLSX) 검증
import assert from "node:assert/strict";

import { readSheet } from "read-excel-file/node";

import {
  autoMatch,
  convertCell,
  decodeText,
  detectFormat,
  displayCell,
  excelCellToString,
  fieldDef,
  parseCsv,
  parseDateCell,
  parseNumberCell,
  prepareRows,
  suggestRatioUnit,
  toTable,
  validateMapping,
} from "../../src/lib/import/core.ts";

import { buildXlsx } from "./xlsx-fixture.mjs";

const groups = { CSV: [], XLSX: [], Mapping: [], Value: [], Validation: [], Snapshot: [] };
const test = (group, name, fn) => groups[group].push([name, fn]);

const opts = (extra = {}) => ({ source: "MANUAL", confidence: "B", salesPeriodDays: null, ratioUnits: {}, today: "2026-10-08", ...extra });
const lookups = {
  products: new Map([["9900000101", "p-uuid-1"], ["9900000102", "p-uuid-2"]]),
  keywords: new Map([["실리콘 트레이", "k-uuid-1"]]),
};
const mappingFrom = (type, headers) => Object.fromEntries(autoMatch(type, headers).map((m) => [m.index, m.field ?? ""]));
const tableOf = (csv) => toTable(parseCsv(csv));

// CSV ---------------------------------------------------------------------------------------
test("CSV", "따옴표 안의 쉼표·줄바꿈·\"\" 처리, CRLF", () => {
  const rows = parseCsv('a,b,c\r\n"1,000","줄\n바꿈","그는 ""네"" 했다"\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1,000", "줄\n바꿈", '그는 "네" 했다']]);
});
test("CSV", "구분자 자동: 탭 · 세미콜론", () => {
  assert.deepEqual(parseCsv("a\tb\n1\t2")[1], ["1", "2"]);
  assert.deepEqual(parseCsv("a;b\n1;2")[1], ["1", "2"]);
});
test("CSV", "UTF-8 BOM 제거 · EUC-KR(엑셀 한글 CSV) 디코딩", () => {
  const utf8 = new TextEncoder().encode("﻿상품ID,가격\n1,2");
  assert.equal(decodeText(utf8).text.startsWith("상품ID"), true);
  // "상품" EUC-KR = BB F3 C7 B0
  const euc = new Uint8Array([0xbb, 0xf3, 0xc7, 0xb0, 0x2c, 0x31]);
  const d = decodeText(euc);
  assert.equal(d.encoding, "euc-kr");
  assert.equal(d.text, "상품,1");
});
test("CSV", "빈 행 · 위쪽 빈 줄 · 오른쪽 빈 열 · 행 번호", () => {
  const t = tableOf("\n\n상품ID,가격,\n1,100,\n,,\n2,200,\n");
  assert.deepEqual(t.headers, ["상품ID", "가격"]);
  assert.deepEqual(t.rows.map((r) => [r.rowNumber, r.cells]), [[4, ["1", "100"]], [6, ["2", "200"]]]);
});
test("CSV", "빈 파일 → 헤더 없음", () => {
  assert.deepEqual(toTable(parseCsv("")), { headers: [], rows: [] });
  assert.deepEqual(toTable(parseCsv("\n , \n")), { headers: [], rows: [] });
});
test("CSV", "형식 판별: csv · xlsx · xls 거부 · 이진 파일 거부 · 다른 확장자 거부", () => {
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
  assert.equal(detectFormat("a.csv", new TextEncoder().encode("a,b")), "csv");
  assert.equal(detectFormat("a.xlsx", zipBytes), "xlsx");
  assert.ok(detectFormat("a.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])).error.includes(".xls"));
  assert.ok(detectFormat("a.xlsx", new TextEncoder().encode("a,b")).error);
  assert.ok(detectFormat("a.csv", zipBytes).error);
  assert.ok(detectFormat("a.csv", new Uint8Array([0x61, 0x00, 0x62])).error);
  assert.ok(detectFormat("a.pdf", new Uint8Array([0x25])).error);
});

// XLSX --------------------------------------------------------------------------------------
test("XLSX", "read-excel-file 로 읽기: 문자열 · 정수 · 소수 · 날짜 서식 셀 · 빈 셀", async () => {
  const buf = buildXlsx([
    ["쿠팡상품ID", "수집일", "판매가", "평점", "비고"],
    [9900000101, { date: 46302 }, 29900, 4.5, null],
    ["9900000102", "2026/10/07", "12,500원", null, "=SUM(A1)"],
  ]);
  const grid = (await readSheet(buf)).map((r) => r.map(excelCellToString));
  const t = toTable(grid);
  assert.deepEqual(t.headers, ["쿠팡상품ID", "수집일", "판매가", "평점", "비고"]);
  assert.deepEqual(t.rows[0].cells, ["9900000101", "2026-10-07", "29900", "4.5", ""]);
  assert.deepEqual(t.rows[1].cells, ["9900000102", "2026/10/07", "12,500원", "", "=SUM(A1)"]);
});
test("XLSX", "엑셀 값 → 상품 스냅샷 정규화까지", async () => {
  const buf = buildXlsx([
    ["상품ID", "날짜", "가격", "리뷰수"],
    [9900000101, { date: 46302 }, 29900, 0],
  ]);
  const t = toTable((await readSheet(buf)).map((r) => r.map(excelCellToString)));
  const p = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts(), lookups);
  assert.equal(p.counts.ok, 1);
  assert.deepEqual(p.rows[0].record.metrics, { price: 29900, review_count: 0 });
  assert.equal(p.rows[0].record.capturedOn, "2026-10-07");
});
test("XLSX", "손상된 xlsx 는 읽기 오류", async () => {
  await assert.rejects(readSheet(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])));
});

// Mapping -----------------------------------------------------------------------------------
test("Mapping", "한글·영문 별칭 자동 매칭", () => {
  const m = autoMatch("PRODUCT_SNAPSHOTS", ["쿠팡 상품ID", "수집일", "판매가격", "리뷰 수", "전환율", "28일 조회수", "배송 유형"]);
  assert.deepEqual(m.map((x) => x.field), ["coupang_product_id", "captured_on", "price", "review_count", "conversion_rate", "views_28d", "delivery_type"]);
  assert.ok(m.every((x) => x.status === "AUTO"));
  assert.deepEqual(autoMatch("KEYWORD_METRICS", ["keyword", "date", "search_volume", "product_count"]).map((x) => x.field), [
    "keyword",
    "captured_on",
    "search_volume",
    "coupang_product_count",
  ]);
});
test("Mapping", "뜻이 둘 이상인 '판매량' · '조회수' · '매출' 은 자동 지정 안 함 (후보만)", () => {
  const m = autoMatch("PRODUCT_SNAPSHOTS", ["판매량", "조회수", "매출"]);
  assert.deepEqual(m.map((x) => [x.field, x.status]), [[null, "AMBIGUOUS"], [null, "AMBIGUOUS"], [null, "AMBIGUOUS"]]);
  assert.deepEqual(m[0].candidates, ["sales_actual", "sales_estimated"]);
  assert.ok(!m[0].candidates.some((c) => c.includes("predict")));
});
test("Mapping", "명시적 '추정판매량' 은 자동 · 예측 판매량 필드는 없음", () => {
  assert.equal(autoMatch("PRODUCT_SNAPSHOTS", ["추정 판매량"])[0].field, "sales_estimated");
  assert.equal(fieldDef("PRODUCT_SNAPSHOTS", "sales_predicted"), undefined);
});
test("Mapping", "매칭 실패 열은 사용 안 함 · 같은 필드 두 열이면 앞 열만", () => {
  const m = autoMatch("PRODUCT_SNAPSHOTS", ["메모", "가격", "판매가"]);
  assert.deepEqual(m.map((x) => x.field), [null, "price", null]);
  assert.equal(m[0].status, "NONE");
});
test("Mapping", "필수 컬럼 누락 · 중복 연결 · 판매량 기간 누락은 전체 차단", () => {
  assert.ok(validateMapping("PRODUCT_SNAPSHOTS", { 0: "price" }, opts()).some((p) => p.includes("쿠팡 상품 ID")));
  assert.ok(validateMapping("SEARCH_RANKS", { 0: "keyword", 1: "coupang_product_id", 2: "captured_on" }, opts()).some((p) => p.includes("순위")));
  assert.ok(validateMapping("PRODUCT_SNAPSHOTS", { 0: "coupang_product_id", 1: "captured_on", 2: "price", 3: "price" }, opts()).some((p) => p.includes("두 개")));
  const sales = { 0: "coupang_product_id", 1: "captured_on", 2: "sales_estimated" };
  assert.ok(validateMapping("PRODUCT_SNAPSHOTS", sales, opts()).some((p) => p.includes("집계 기간")));
  assert.deepEqual(validateMapping("PRODUCT_SNAPSHOTS", sales, opts({ salesPeriodDays: 28 })), []);
});
test("Mapping", "수동 매핑: 자동 결과와 다르게 지정해도 그대로 사용", () => {
  const t = tableOf("상품ID,날짜,판매량\n9900000101,2026-10-07,120");
  const p = prepareRows("PRODUCT_SNAPSHOTS", t, { 0: "coupang_product_id", 1: "captured_on", 2: "sales_actual" }, opts({ salesPeriodDays: 30 }), lookups);
  assert.deepEqual(p.rows[0].record.metrics, { sales_actual: 120, sales_period_days: 30 });
});

// Value -------------------------------------------------------------------------------------
test("Value", "숫자: 12,500 · 12500원 · 12,500원 · 15.5% · +3 · 1e3", () => {
  assert.deepEqual(["12,500", "12500원", "12,500원", " 12 500 "].map((s) => parseNumberCell(s).value), [12500, 12500, 12500, 12500]);
  assert.deepEqual(parseNumberCell("15.5%"), { value: 15.5, percent: true });
  assert.equal(parseNumberCell("+3").value, 3);
  assert.equal(parseNumberCell("1e3").value, 1000);
  assert.ok(Number.isNaN(parseNumberCell("약 300").value));
});
test("Value", "날짜: - / . · 시각 · 8자리 · 잘못된 날짜", () => {
  assert.equal(parseDateCell("2026-10-08").date, "2026-10-08");
  assert.equal(parseDateCell("2026/10/08").date, "2026-10-08");
  assert.equal(parseDateCell("2026.10.08").date, "2026-10-08");
  assert.equal(parseDateCell("2026.10.8.").date, "2026-10-08");
  assert.equal(parseDateCell("20261008").date, "2026-10-08");
  assert.equal(parseDateCell("2026-10-08 14:30").capturedAt, "2026-10-08T14:30:00+09:00");
  assert.equal(parseDateCell("2026/10/08 14:30").capturedAt, "2026-10-08T14:30:00+09:00");
  assert.equal(parseDateCell("2026-02-30"), null);
  assert.equal(parseDateCell("2026-10-08 25:00"), null);
  assert.equal(parseDateCell("10/08/2026"), null);
});
test("Value", "비율: % 기호는 항상 퍼센트, 숫자는 단위 선택대로, 0~1 범위 검사", () => {
  const f = fieldDef("PRODUCT_SNAPSHOTS", "conversion_rate");
  assert.equal(convertCell(f, "15.5%", "DECIMAL").value, 0.155);
  assert.equal(convertCell(f, "15.5", "PERCENT").value, 0.155);
  assert.equal(convertCell(f, "0.155", "DECIMAL").value, 0.155);
  assert.ok(convertCell(f, "15.5", "DECIMAL").issue);
  const g = fieldDef("KEYWORD_METRICS", "search_growth_rate");
  assert.equal(convertCell(g, "-25%", "DECIMAL").value, -0.25);
  assert.equal(convertCell(g, "150", "PERCENT").value, 1.5);
});
test("Value", "비율 단위 기본값: 1 넘는 숫자가 있으면 퍼센트", () => {
  assert.equal(suggestRatioUnit(["0.12", "0.3"]), "DECIMAL");
  assert.equal(suggestRatioUnit(["3.2", "0.5"]), "PERCENT");
  assert.equal(suggestRatioUnit(["30%", "0.5"]), "DECIMAL");
});
test("Value", "NULL ≠ 0: 빈 칸 · '-' · N/A 는 NULL, '0' 은 0", () => {
  const f = fieldDef("PRODUCT_SNAPSHOTS", "review_count");
  for (const s of ["", "-", "N/A", "없음"]) assert.equal(convertCell(f, s, "DECIMAL").value, null);
  assert.equal(convertCell(f, "0", "DECIMAL").value, 0);
  assert.equal(convertCell(fieldDef("PRODUCT_SNAPSHOTS", "conversion_rate"), "0%", "DECIMAL").value, 0);
});
test("Value", "정수 칸에 소수 · 음수 · 문자는 문제로 표시 (값은 NULL)", () => {
  const f = fieldDef("PRODUCT_SNAPSHOTS", "review_count");
  assert.ok(convertCell(f, "12.5", "DECIMAL").issue);
  assert.ok(convertCell(f, "-3", "DECIMAL").issue);
  assert.ok(convertCell(f, "많음", "DECIMAL").issue);
  assert.ok(convertCell(fieldDef("SEARCH_RANKS", "rank_position"), "0", "DECIMAL").issue);
  assert.ok(convertCell(fieldDef("PRODUCT_SNAPSHOTS", "rating"), "5.5", "DECIMAL").issue);
});
test("Value", "상품 ID: 숫자 · URL · 엑셀 .0 · 문자 거부", () => {
  const f = fieldDef("PRODUCT_SNAPSHOTS", "coupang_product_id");
  assert.equal(convertCell(f, "9900000101", "DECIMAL").value, "9900000101");
  assert.equal(convertCell(f, "https://www.coupang.com/vp/products/8123456789?itemId=1", "DECIMAL").value, "8123456789");
  assert.equal(convertCell(f, "9900000101.0", "DECIMAL").value, "9900000101");
  assert.ok(convertCell(f, "ABC123", "DECIMAL").issue);
});
test("Value", "배송·판매자 유형 한글/코드 · 알 수 없는 값은 비우고 주의", () => {
  const d = fieldDef("PRODUCT_SNAPSHOTS", "delivery_type");
  assert.equal(convertCell(d, "로켓배송", "DECIMAL").value, "ROCKET");
  assert.equal(convertCell(d, "로켓 그로스", "DECIMAL").value, "ROCKET_GROWTH");
  assert.equal(convertCell(d, "SELLER_DELIVERY", "DECIMAL").value, "SELLER_DELIVERY");
  assert.ok(convertCell(d, "퀵배송", "DECIMAL").issue);
  assert.equal(convertCell(fieldDef("PRODUCT_SNAPSHOTS", "seller_type_observed"), "WING", "DECIMAL").value, "WING_SELLER");
});
test("Value", "광고 여부: 광고/AD/Y/1 · 자연/N/0 · 빈 칸 = 자연", () => {
  const f = fieldDef("SEARCH_RANKS", "is_ad");
  assert.deepEqual(["광고", "AD", "Y", "1", "자연", "N", "0", ""].map((s) => convertCell(f, s, "DECIMAL").value), [true, true, true, true, false, false, false, false]);
  assert.ok(convertCell(f, "가끔", "DECIMAL").issue);
});
test("Value", "수식처럼 보이는 셀은 화면에 ' 를 붙여 데이터로 표시", () => {
  assert.equal(displayCell("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(displayCell("@SUM(1)"), "'@SUM(1)");
  assert.equal(displayCell("+cmd"), "'+cmd");
  assert.equal(displayCell("-25%"), "-25%");
  assert.equal(displayCell("상품"), "상품");
});

// Validation --------------------------------------------------------------------------------
const PRODUCT_CSV = [
  "쿠팡상품ID,수집일,판매가,정가,리뷰수,전환율,배송유형",
  "9900000101,2026-10-07,29900,35000,120,4.2%,로켓그로스",
  "9900000999,2026-10-07,10000,,,,", // 미등록 상품
  ",2026-10-07,1000,,,,", // 상품 ID 없음
  "9900000102,2026-13-01,1000,,,,", // 잘못된 날짜
  "9900000102,2026-10-09,1000,,,,", // 미래 날짜
  "9900000102,2026-10-06,abc,,0,,퀵배송", // 숫자 아님 · 실제 0 · 알 수 없는 배송
  "9900000101,2026-10-07,29900,,,,", // 2행과 같은 키
  "9900000102,2026-10-05,,,,,", // 지표 없음
].join("\n");

test("Validation", "행별 상태: 정상 · 주의 · 오류 · 중복 집계", () => {
  const t = tableOf(PRODUCT_CSV);
  const p = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts(), lookups);
  assert.deepEqual(p.counts, { total: 8, ok: 1, warning: 1, error: 5, duplicate: 1 });
  assert.deepEqual(p.rows.map((r) => r.status), ["OK", "ERROR", "ERROR", "ERROR", "ERROR", "WARNING", "DUPLICATE", "ERROR"]);
  assert.deepEqual(p.rows.map((r) => r.errorCode ?? null), [null, "PRODUCT_NOT_FOUND", "REQUIRED", "INVALID", "FUTURE_DATE", null, "DUPLICATE_IN_FILE", "NO_VALUES"]);
  assert.deepEqual(p.unknownProducts, ["9900000999"]);
});
test("Validation", "주의 행: 잘못된 선택 값만 비우고 나머지 저장 (실제 0 유지)", () => {
  const t = tableOf(PRODUCT_CSV);
  const row = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts(), lookups).rows[5];
  assert.deepEqual(row.record.metrics, { review_count: 0 });
  assert.equal(row.messages.length, 2);
});
test("Validation", "등록되지 않은 키워드 · 순위의 키워드/상품 둘 다 필요", () => {
  const kt = tableOf("키워드,날짜,검색량\n실리콘 트레이,2026-10-07,12000\n없는 키워드,2026-10-07,10");
  const kp = prepareRows("KEYWORD_METRICS", kt, mappingFrom("KEYWORD_METRICS", kt.headers), opts(), lookups);
  assert.deepEqual(kp.rows.map((r) => r.status), ["OK", "ERROR"]);
  assert.deepEqual(kp.unknownKeywords, ["없는 키워드"]);
  const rt = tableOf("키워드,상품ID,날짜,순위\n실리콘  트레이,9900000101,2026-10-07,3\n실리콘 트레이,9900000999,2026-10-07,4\n없는 키워드,9900000101,2026-10-07,5");
  const rp = prepareRows("SEARCH_RANKS", rt, mappingFrom("SEARCH_RANKS", rt.headers), opts(), lookups);
  assert.deepEqual(rp.rows.map((r) => r.status), ["OK", "ERROR", "ERROR"]);
  assert.equal(rp.rows[0].target.keywordId, "k-uuid-1");
});
test("Validation", "순위 중복 판정에 광고 여부 포함 (같은 날 자연·광고는 별개)", () => {
  const t = tableOf("키워드,상품ID,날짜,순위,광고\n실리콘 트레이,9900000101,2026-10-07,3,\n실리콘 트레이,9900000101,2026-10-07,1,광고\n실리콘 트레이,9900000101,2026-10-07,4,자연");
  const p = prepareRows("SEARCH_RANKS", t, mappingFrom("SEARCH_RANKS", t.headers), opts(), lookups);
  assert.deepEqual(p.rows.map((r) => r.status), ["OK", "OK", "DUPLICATE"]);
  assert.equal(p.rows[1].record.isAd, true);
});

// Snapshot (정규화 레코드) ---------------------------------------------------------------------
test("Snapshot", "상품 스냅샷 레코드: 출처·신뢰도·수집일·captured_at · 파생 할인율(CALCULATED)", () => {
  const t = tableOf(PRODUCT_CSV);
  const r = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts({ source: "WING_SESSION", confidence: "A" }), lookups).rows[0];
  assert.equal(r.record.kind, "PRODUCT_SNAPSHOT");
  assert.equal(r.record.source, "WING_SESSION");
  assert.equal(r.record.confidence, "A");
  assert.equal(r.record.capturedOn, "2026-10-07");
  assert.equal(r.record.capturedAt, "2026-10-07T00:00:00+09:00");
  assert.deepEqual(r.record.metrics, { price: 29900, original_price: 35000, review_count: 120, conversion_rate: 0.042, delivery_type: "ROCKET_GROWTH", discount_rate: 0.1457 });
  assert.deepEqual(r.record.calculated, ["discount_rate"]);
  assert.equal(r.recordKey, "product_snapshot:9900000101:2026-10-07:WING_SESSION");
  assert.equal(r.target.productId, "p-uuid-1");
});
test("Snapshot", "파일에 없는 값은 레코드에 넣지 않음 (UPSERT 가 기존 값을 보존)", () => {
  const t = tableOf("상품ID,날짜,가격,리뷰수\n9900000101,2026-10-07,,55");
  const r = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts(), lookups).rows[0];
  assert.deepEqual(r.record.metrics, { review_count: 55 });
  assert.ok(!("price" in r.record.metrics));
});
test("Snapshot", "시각이 있는 날짜 → captured_at 에 반영", () => {
  const t = tableOf("상품ID,날짜,가격\n9900000101,2026/10/07 14:30,100");
  const r = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts(), lookups).rows[0];
  assert.equal(r.record.capturedAt, "2026-10-07T14:30:00+09:00");
});
test("Snapshot", "판매량: 기간 열 없으면 입력한 기간 · 기간 열 있으면 그 값", () => {
  const t = tableOf("상품ID,날짜,추정판매량\n9900000101,2026-10-07,90");
  const r = prepareRows("PRODUCT_SNAPSHOTS", t, mappingFrom("PRODUCT_SNAPSHOTS", t.headers), opts({ salesPeriodDays: 28 }), lookups).rows[0];
  assert.deepEqual(r.record.metrics, { sales_estimated: 90, sales_period_days: 28 });
  const t2 = tableOf("상품ID,날짜,추정판매량,집계기간\n9900000101,2026-10-07,90,7");
  const r2 = prepareRows("PRODUCT_SNAPSHOTS", t2, mappingFrom("PRODUCT_SNAPSHOTS", t2.headers), opts({ salesPeriodDays: 28 }), lookups).rows[0];
  assert.equal(r2.record.metrics.sales_period_days, 7);
});
test("Snapshot", "키워드 스냅샷: 비율 변환 · 파생 경쟁강도·증감률 (CALCULATED)", () => {
  const t = tableOf("키워드,날짜,검색량,이전검색량,상품수,WING비율\n실리콘 트레이,2026-10-07,12000,10000,30000,45");
  const r = prepareRows("KEYWORD_METRICS", t, mappingFrom("KEYWORD_METRICS", t.headers), opts({ ratioUnits: { wing_ratio: "PERCENT" } }), lookups).rows[0];
  assert.deepEqual(r.record.metrics, {
    search_volume: 12000,
    search_volume_previous: 10000,
    coupang_product_count: 30000,
    wing_ratio: 0.45,
    competition_intensity: 2.5,
    search_growth_rate: 0.2,
  });
  assert.deepEqual(r.record.calculated, ["competition_intensity", "search_growth_rate"]);
  assert.equal(r.target.keywordId, "k-uuid-1");
});
test("Snapshot", "파일에 경쟁강도가 있으면 계산하지 않음", () => {
  const t = tableOf("키워드,날짜,검색량,상품수,경쟁강도\n실리콘 트레이,2026-10-07,12000,30000,3.1");
  const r = prepareRows("KEYWORD_METRICS", t, mappingFrom("KEYWORD_METRICS", t.headers), opts(), lookups).rows[0];
  assert.equal(r.record.metrics.competition_intensity, 3.1);
  assert.deepEqual(r.record.calculated, []);
});
test("Snapshot", "순위 레코드", () => {
  const t = tableOf("키워드,상품ID,날짜,순위,페이지\n실리콘 트레이,9900000101,2026-10-07,12위,1");
  const r = prepareRows("SEARCH_RANKS", t, mappingFrom("SEARCH_RANKS", t.headers), opts({ source: "COUPANG_PAGE" }), lookups).rows[0];
  assert.deepEqual(
    { kind: r.record.kind, rank: r.record.rankPosition, isAd: r.record.isAd, page: r.record.page, source: r.record.source },
    { kind: "KEYWORD_PRODUCT_RANK", rank: 12, isAd: false, page: 1, source: "COUPANG_PAGE" },
  );
  assert.equal(r.recordKey, "keyword_product_rank:실리콘 트레이:9900000101:2026-10-07:COUPANG_PAGE:organic");
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
console.log(`\nImport ${passed}/${total}`);
