// npm run test:extension — 확장 프로그램 화면 읽기 규칙 · /api/ingest 요청 검사 (순수 함수, DB · 브라우저 없음)
// 고정값은 2026-10-08 실제 쿠팡 화면에서 읽은 글자 조각을 그대로 옮긴 것이다 (상품 ID 는 실제, 저장하지 않음).
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  adaptProductPage,
  badgeFromImageName,
  deliveryAndSeller,
  pickPrice,
  ratingFromStarWidth,
  sellerNameFromInfo,
} from "../../src/lib/collectors/coupang/product.ts";
import {
  adaptSearchPage,
  aggregateSearch,
  correctedQueryOf,
  searchBadgeOf,
  searchItemToProduct,
  searchParamsOf,
  searchToKeywordRecord,
  uniqueSearchProducts,
} from "../../src/lib/collectors/coupang/search.ts";
import { normalizeKeyword, normalizeProduct, normalizeSearch } from "../../src/lib/collectors/normalize.ts";
import {
  allowedOrigins,
  bearerToken,
  isAllowedOrigin,
  JARVIS_EXTENSION_ID,
  MAX_RECORDS,
  parseIngestRequest,
  parseLookupRequest,
  parseRegisterRequest,
  RateLimiter,
} from "../../src/lib/ingest/api-request.ts";
import { jobOutcome, parseErrorSummary } from "../../src/lib/ingest/outcome.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const groups = { Extension: [], Collector: [], Normalize: [], API: [], Phase12: [] };
const test = (g, name, fn) => groups[g].push([name, fn]);
const META = { source: "COUPANG_PAGE", confidence: "A", capturedAt: new Date().toISOString() };
const L = (...parts) => parts.map((p) => (p.endsWith("~") ? { text: p.slice(0, -1), strike: true } : { text: p }));

// Extension ---------------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.base.json"), "utf8"));
test("Extension", "manifest key → 고정 확장 프로그램 ID (서버 CORS 허용 origin 과 같다)", () => {
  const der = createPublicKey({ key: Buffer.from(manifest.key, "base64"), format: "der", type: "spki" }).export({ format: "der", type: "spki" });
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  assert.equal(id, JARVIS_EXTENSION_ID);
});
test("Extension", "Manifest V3 · 최소 권한 (쿠키 · 네트워크 가로채기 · 모든 사이트 권한 없음)", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);
  const all = JSON.stringify(manifest);
  for (const bad of ["cookies", "webRequest", "declarativeNetRequest", "<all_urls>", "debugger", "scripting", "tabs\""]) assert.ok(!all.includes(bad), bad);
  assert.deepEqual(manifest.host_permissions, ["https://www.coupang.com/*", "https://wing.coupang.com/*"]);
  assert.deepEqual(
    manifest.content_scripts.map((c) => c.matches[0]),
    ["https://www.coupang.com/vp/products/*", "https://www.coupang.com/np/search*", "https://wing.coupang.com/*"],
  );
});
test("Extension", "빌드 결과물에 service role 키 없음 · 공개 키만", () => {
  const dist = join(root, "extension", "dist");
  if (!existsSync(dist)) throw new Error("extension/dist 없음 — npm run ext:build 먼저");
  const env = Object.fromEntries(
    readFileSync(join(root, ".env.local"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
  );
  const files = readdirSync(dist, { recursive: true }).filter((f) => /\.(js|json|html)$/.test(f));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const body = readFileSync(join(dist, f), "utf8");
    assert.ok(!env.SUPABASE_SERVICE_ROLE_KEY || !body.includes(env.SUPABASE_SERVICE_ROLE_KEY), `${f} 에 service role 키`);
    assert.ok(!/service_role|sb_secret_/.test(body), `${f} 에 비밀 키 흔적`);
  }
  const built = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  assert.equal(built.key, manifest.key);
});

// Collector (화면 글자 → 값) ---------------------------------------------------------------
test("Collector", "배송 배지 이미지 → 문구 (화면으로 대조한 2종만, 모르는 이미지 무시)", () => {
  assert.equal(badgeFromImageName("logo_rocket_merchant_medium_v3_r3.png"), "판매자로켓");
  assert.equal(badgeFromImageName("https://image.coupangcdn.com/image/badges/falcon/v1/web/rocket-fulfillment/logo/xhdpi/logo_rocket_merchant_medium_v3_r3.png?x=1"), "판매자로켓");
  assert.equal(badgeFromImageName("logo_rocket_filter_medium.png"), "로켓배송");
  assert.equal(badgeFromImageName("badge_199cd481e67.png"), null);
  assert.equal(badgeFromImageName("logo_rocketwow.png"), null);
});
test("Collector", "가격 영역: 일반 1가격 · 쿠폰할인 · 할인액 · 와우+일반 2가격 2종 (실제 화면 5종)", () => {
  // 판매자로켓 상품 (9531588589): 쿠폰할인 금액은 판매가가 아니다
  assert.deepEqual(pickPrice(L("78%", "14,800원", "(1개당 14,800원)", "69,000원~", "54,200원", "쿠폰할인", "·", "2일 남음")), {
    priceText: "14,800원",
    originalPriceText: "69,000원",
    discountText: "78%",
    wowPriceText: null,
  });
  // 로켓배송 와우할인가 + 일반판매가 (4760383959) → 일반판매가
  assert.deepEqual(
    pickPrice(L("와우할인가", "69%", "84,000원~", "25,990", "(1개당 25,990원)", "27%", "판매됨", "할인받기", "일반판매가", "66%", "84,000원~", "27,990", "(1개당 27,990원)")),
    { priceText: "27,990", originalPriceText: "84,000원", discountText: "66%", wowPriceText: "25,990" },
  );
  // 와우 가입 쿠폰할인가 + 일반할인가 (8508805387 — PHASE 11 실사용에서 발견한 두 번째 형태) → 일반할인가
  assert.deepEqual(
    pickPrice(L("와우 가입 쿠폰할인가", "57%", "39,900원~", "16,910원", "(1개당 8,455원)", "할인받기", "일반할인가", "52%", "39,900원~", "19,100원", "(1개당 9,550원)")),
    { priceText: "19,100원", originalPriceText: "39,900원", discountText: "52%", wowPriceText: "16,910원" },
  );
  // 판매자배송 (8665291752)
  assert.equal(pickPrice(L("11%", "8,900원", "(1개당 4,450원)", "10,000원~")).priceText, "8,900원");
  // 할인액 + 할인 전 가격 (9746232312)
  const p = pickPrice(L("37%", "24,990원", "(1개당 24,990원)", "39,990원~", "2,780원", "할인", "27,770원~"));
  assert.deepEqual([p.priceText, p.originalPriceText, p.discountText], ["24,990원", "39,990원", "37%"]);
  assert.deepEqual(pickPrice([]), { priceText: null, originalPriceText: null, discountText: null, wowPriceText: null });
});
test("Collector", "배송 · 판매자 유형: 판매자로켓 · 로켓배송(직매입) · 판매자배송 · 근거 없음", () => {
  assert.deepEqual(deliveryAndSeller(["판매자로켓"], "판매자: 제이에스인터 판매자 상품 보러가기"), { delivery: "ROCKET_GROWTH", seller: "ROCKET_GROWTH_SELLER" });
  assert.deepEqual(deliveryAndSeller(["로켓배송"], null), { delivery: "ROCKET", seller: "COUPANG_RETAIL" });
  assert.deepEqual(deliveryAndSeller([], "판매자: (주)케이씨제이무역 판매자 상품 보러가기 판매자 평가 92% (2,832) 배송사: 우체국"), { delivery: "SELLER_DELIVERY", seller: "WING_SELLER" });
  assert.deepEqual(deliveryAndSeller(["로켓배송"], "판매자: 어떤판매자"), { delivery: "ROCKET", seller: null });
  assert.deepEqual(deliveryAndSeller([], null), { delivery: null, seller: null });
});
test("Collector", "판매자명 · 별 너비 평점", () => {
  assert.equal(sellerNameFromInfo("판매자:하오스글로벌 유한회사（HAOS GLOBAL Co.,Ltd.） 다른 판매자 보기(3) 판매자 평가 89% (168) 배송사: CJ 대한통운"), "하오스글로벌 유한회사（HAOS GLOBAL Co.,Ltd.）");
  assert.equal(sellerNameFromInfo("판매자: 제이에스인터판매자 상품 보러가기"), "제이에스인터");
  assert.equal(sellerNameFromInfo(null), null);
  assert.equal(ratingFromStarWidth("width:90%;max-width:100%"), "4.5");
  assert.equal(ratingFromStarWidth("width:80%"), "4");
  assert.equal(ratingFromStarWidth(null), null);
});
const KOMET_RAW = {
  url: "https://www.coupang.com/vp/products/4760383959",
  title: "코멧 편안한 아웃도어 와이드 캠핑 의자 2개 + 수납가방 2개, 블랙, 1세트",
  pageProductIds: ["4760383959", "4760383959"],
  priceText: "27,990",
  originalPriceText: "84,000원",
  discountText: "66%",
  ratingText: "4.7",
  reviewCountText: "13372",
  badgeImageNames: ["logo_rocket_filter_medium.png"],
  sellerInfoText: null,
  observedOnly: { monthlyBuyers: "2,000명 이상", wowPrice: "25,990", jsonLdPrice: "25990", category: "스포츠/레저 > 낚시" },
};
test("Collector", "상품 페이지 → CollectedProduct (실제 화면값과 같은지)", () => {
  const c = adaptProductPage(KOMET_RAW, META);
  assert.deepEqual(
    [c.coupangProductId, c.price, c.originalPrice, c.discountRate, c.rating, c.reviewCount, c.deliveryType, c.sellerType],
    ["4760383959", 27990, 84000, 0.66, 4.7, 13372, "ROCKET", "COUPANG_RETAIL"],
  );
  assert.equal(c.observedOnly.monthlyBuyers, "2,000명 이상");
  assert.equal("salesActual" in c || "views28d" in c, false);
});
test("Collector", "리뷰 0: 탭 '상품평 (0)' → 0 (실제 0), 평점은 없음(null)", () => {
  const c = adaptProductPage({ url: "https://www.coupang.com/vp/products/9746232312", title: "x", reviewCountText: "상품평 (0)", ratingText: null }, META);
  assert.equal(c.reviewCount, 0);
  assert.equal(c.rating, null);
});
const SEARCH_RAW = {
  url: "https://www.coupang.com/np/search?q=%EC%BA%A0%ED%95%91%EC%9D%98%EC%9E%90&channel=user",
  keyword: "다른글자",
  items: [
    { href: "https://www.coupang.com/vp/products/4760383959", adLabelText: "광고" },
    { href: "https://www.coupang.com/vp/products/8989439257", adLabelText: "광고" },
    { href: "https://www.coupang.com/vp/products/4760383959", rankBadgeText: "1" },
    { href: "https://www.coupang.com/vp/products/8523224401", rankBadgeText: "2" },
    { href: "https://www.coupang.com/vp/products/8951131814", adLabelText: "광고" },
    { href: "https://www.coupang.com/vp/products/8508805387", rankBadgeText: "3" },
    { href: "https://www.coupang.com/vp/products/8508805387", rankBadgeText: "4" },
  ],
};
test("Collector", "검색: 키워드는 URL q 우선 · page 없으면 1 · 자연/광고 따로 센 순위 · 화면 위치", () => {
  const s = adaptSearchPage(SEARCH_RAW, META);
  assert.equal(s.keyword, "캠핑의자");
  assert.equal(s.page, 1);
  assert.deepEqual(
    s.items.map((i) => `${i.isAd ? "A" : "N"}${i.rank}@${i.displayPosition}`),
    ["A1@1", "A2@2", "N1@3", "N2@4", "A3@5", "N3@6", "N4@7"],
  );
  assert.deepEqual(searchParamsOf("https://www.coupang.com/np/search?q=a&page=2"), { keyword: "a", page: 2 });
  assert.deepEqual(searchParamsOf("https://www.coupang.com/vp/products/1"), { keyword: null, page: null });
});
test("Collector", "검색어 자동 수정(correctedQuery) 감지 — 다른 검색어 결과는 저장하지 않는다", () => {
  assert.equal(correctedQueryOf("https://www.coupang.com/np/search?q=%ED%95%98%EC%98%A4%EC%8A%A4%EC%A0%84%EC%9E%90+HS-6&correctedQuery=%ED%95%98%EC%9A%B0%EC%8A%A4%EC%A0%84%EC%9E%90+hs-6&spellCorrectionType=weak"), "하우스전자 hs-6");
  assert.equal(correctedQueryOf("https://www.coupang.com/np/search?q=AB&correctedQuery=ab"), null);
  assert.equal(correctedQueryOf("https://www.coupang.com/np/search?q=%EC%BA%A0%ED%95%91%EC%9D%98%EC%9E%90"), null);
});

// Normalize ---------------------------------------------------------------------------------
test("Normalize", "상품: 실제 화면값 → 스냅샷 지표 (출처 COUPANG_PAGE · 신뢰도 A)", () => {
  const { record, issues } = normalizeProduct(adaptProductPage(KOMET_RAW, META));
  assert.deepEqual(issues, []);
  assert.equal(record.source, "COUPANG_PAGE");
  assert.equal(record.confidence, "A");
  assert.deepEqual(record.metrics, {
    product_name_observed: KOMET_RAW.title,
    price: 27990,
    original_price: 84000,
    discount_rate: 0.66,
    review_count: 13372,
    rating: 4.7,
    delivery_type: "ROCKET",
    seller_type_observed: "COUPANG_RETAIL",
  });
});
test("Normalize", "상품 ID 교차 검증: URL 과 페이지 ID 가 다르면 저장하지 않음", () => {
  const { record, issues } = normalizeProduct(adaptProductPage({ ...KOMET_RAW, pageProductIds: ["4760383959", "1111111111"] }, META));
  assert.equal(record, null);
  assert.match(issues[0].message, /다릅니다/);
});
test("Normalize", "검색: 광고·자연 레코드 · 같은 상품 반복(옵션)은 뒤에서 건너뜀 대상", () => {
  const { records, issues } = normalizeSearch(adaptSearchPage(SEARCH_RAW, META));
  assert.deepEqual(issues, []);
  assert.deepEqual(
    records.map((r) => `${r.coupangProductId}:${r.isAd ? "A" : "N"}${r.rankPosition}`),
    ["4760383959:A1", "8989439257:A2", "4760383959:N1", "8523224401:N2", "8951131814:A3", "8508805387:N3", "8508805387:N4"],
  );
});
test("Normalize", "검색: 쿠팡 순위 배지와 계산 순위가 다르면 전체 저장하지 않음 (화면 구조 변경 감지)", () => {
  const broken = { ...SEARCH_RAW, items: SEARCH_RAW.items.map((i, n) => (n === 3 ? { ...i, rankBadgeText: "5" } : i)) };
  const { records, issues } = normalizeSearch(adaptSearchPage(broken, META));
  assert.equal(records.length, 0);
  assert.match(issues[0].message, /순위 배지/);
});
test("Normalize", "미래 수집 시각은 거부 (기존 규칙)", () => {
  const future = { ...META, capturedAt: new Date(Date.now() + 3600_000).toISOString() };
  assert.equal(normalizeProduct(adaptProductPage(KOMET_RAW, future)).record, null);
});

// API ---------------------------------------------------------------------------------------
const KEY = "0b9c6f0e-6a55-4bb1-9a66-1c3f2f4a8e21";
const req = (over = {}) => ({ idempotencyKey: KEY, tool: "jarvis-extension", version: "0.1.0", records: [{ kind: "product", ...adaptProductPage(KOMET_RAW, META) }], ...over });
test("API", "정상 요청 → 종류별로 나눔 · tool 은 이름/버전", () => {
  const r = parseIngestRequest(req({ records: [req().records[0], { kind: "search", ...adaptSearchPage(SEARCH_RAW, META) }] }));
  assert.equal(r.ok, true);
  assert.equal(r.batch.tool, "jarvis-extension/0.1.0");
  assert.deepEqual([r.batch.products.length, r.batch.searches.length, r.batch.keywords.length], [1, 1, 0]);
  assert.equal("kind" in r.batch.products[0], false);
});
test("API", "잘못된 요청: 객체 아님 · UUID · tool · version · 빈 records · 모르는 kind", () => {
  for (const [body, re] of [
    [null, /JSON 객체/],
    [[], /JSON 객체/],
    [req({ idempotencyKey: "abc" }), /UUID/],
    [req({ tool: "x y" }), /tool/],
    [req({ version: "1" }), /version/],
    [req({ records: [] }), /비어/],
    [req({ records: [{ kind: "order", capturedAt: META.capturedAt }] }), /kind/],
    [req({ records: ["x"] }), /객체/],
    [req({ records: [{ kind: "product" }] }), /capturedAt/],
    [req({ records: [{ kind: "search", capturedAt: META.capturedAt }] }), /items/],
  ]) {
    const r = parseIngestRequest(body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, re);
  }
});
test("API", "크기 제한: records 2,000건 통과 · 2,001건 413 · 검색 칸 201개 413", () => {
  const rec = req().records[0];
  assert.equal(parseIngestRequest(req({ records: Array.from({ length: MAX_RECORDS }, () => rec) })).ok, true);
  const over = parseIngestRequest(req({ records: Array.from({ length: MAX_RECORDS + 1 }, () => rec) }));
  assert.deepEqual([over.ok, over.status], [false, 413]);
  const big = parseIngestRequest(req({ records: [{ kind: "search", ...META, keyword: "a", items: Array.from({ length: 201 }, (_, i) => ({ rank: i + 1 })) }] }));
  assert.deepEqual([big.ok, big.status], [false, 413]);
});
test("API", "서버 시각 검사: 24시간보다 오래된 수집 시각 거부", () => {
  const old = new Date(Date.now() - 25 * 3600_000).toISOString();
  const r = parseIngestRequest(req({ records: [{ kind: "product", ...adaptProductPage(KOMET_RAW, { ...META, capturedAt: old }) }] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /24시간/);
});
test("API", "CORS origin: 확장 프로그램만 · 다른 사이트 거부 · '*' 없음 · 추가 ID 형식 검사", () => {
  const allowed = allowedOrigins("chrome-extension://abcdefghijklmnopabcdefghijklmnop, https://evil.example, *");
  assert.deepEqual(allowed, [`chrome-extension://${JARVIS_EXTENSION_ID}`, "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]);
  assert.equal(isAllowedOrigin(`chrome-extension://${JARVIS_EXTENSION_ID}`, allowed), true);
  assert.equal(isAllowedOrigin("https://www.coupang.com", allowed), false);
  assert.equal(isAllowedOrigin("http://localhost:3000", allowed), false);
  assert.equal(isAllowedOrigin("chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", allowed), false);
  assert.equal(isAllowedOrigin(null, allowed), true); // Origin 없는 요청은 토큰 검사로만
});
test("API", "Authorization 헤더: Bearer 토큰만", () => {
  assert.equal(bearerToken("Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abc-123"), "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abc-123");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer short"), null);
  assert.equal(bearerToken(null), null);
});
test("API", "사용자별 요청 제한: 1분 30회 · 31번째 거부(남은 초) · 다른 사용자 별도 · 1분 뒤 다시 허용", () => {
  const rl = new RateLimiter(30, 60_000);
  for (let i = 0; i < 30; i += 1) assert.equal(rl.take("u1", 1000 + i), 0);
  assert.ok(rl.take("u1", 2000) > 0);
  assert.equal(rl.take("u2", 2000), 0);
  assert.equal(rl.take("u1", 61_001), 0);
});

// Phase 12 -----------------------------------------------------------------------------------
// 실제 화면처럼: 광고 2칸 · 자연 5칸 (같은 상품 반복 1번 · 로켓 배지 없음 1 · 모르는 로켓 배지 1)
const P12_RAW = {
  url: "https://www.coupang.com/np/search?q=%EC%BA%A0%ED%95%91%EC%9D%98%EC%9E%90",
  items: [
    { href: "https://www.coupang.com/vp/products/1001", adLabelText: "광고", productName: "광고A", priceText: "30,000원", reviewCountText: "(100)", ratingText: "4.5", badgeImageNames: ["logo_rocket_filter_medium.png"] },
    { href: "https://www.coupang.com/vp/products/1002", rankBadgeText: "1", productName: "자연1", priceText: "27,990원", originalPriceText: "84,000원", discountText: "66%", reviewCountText: "(13,372)", ratingText: "4.5", badgeImageNames: ["logo_rocket_filter_medium.png"] },
    { href: "https://www.coupang.com/vp/products/1003", rankBadgeText: "2", productName: "자연2", priceText: "19,100원", reviewCountText: "(1,221)", ratingText: "4.5", badgeImageNames: ["logo_rocket_merchant_medium_v3_r3.png"] },
    { href: "https://www.coupang.com/vp/products/1002", rankBadgeText: "3", productName: "자연1 옵션", priceText: "29,000원", reviewCountText: "(13,372)", ratingText: "4.5", badgeImageNames: ["logo_rocket_filter_medium.png"] },
    { href: "https://www.coupang.com/vp/products/1004", adLabelText: "광고", productName: "광고B", priceText: "9,900원", badgeImageNames: [] },
    { href: "https://www.coupang.com/vp/products/1005", rankBadgeText: "4", productName: "판매자배송", priceText: "8,900원", reviewCountText: "(189)", ratingText: "4", badgeImageNames: [] },
    { href: "https://www.coupang.com/vp/products/1006", rankBadgeText: "5", productName: "모르는배지", priceText: null, reviewCountText: null, badgeImageNames: ["logo_rocket_fresh_x.png"] },
  ],
};
const p12 = () => adaptSearchPage(P12_RAW, META);
test("Phase12", "검색 칸 배송 배지: 로켓배송 · 판매자로켓 · 배지 없음(NONE) · 모르는 로켓 배지(UNKNOWN)", () => {
  assert.equal(searchBadgeOf(["logo_rocket_filter_medium.png"]), "ROCKET");
  assert.equal(searchBadgeOf(["logo_rocket_merchant_medium_v3_r3.png"]), "ROCKET_GROWTH");
  assert.equal(searchBadgeOf([]), "NONE");
  assert.equal(searchBadgeOf(["logo_rocket_fresh_x.png"]), "UNKNOWN");
  const s = p12();
  assert.deepEqual(
    s.items.map((i) => [i.price, i.reviewCount, i.rating, i.deliveryType, i.sellerType]),
    [
      [30000, 100, 4.5, "ROCKET", null],
      [27990, 13372, 4.5, "ROCKET", null],
      [19100, 1221, 4.5, "ROCKET_GROWTH", "ROCKET_GROWTH_SELLER"],
      [29000, 13372, 4.5, "ROCKET", null],
      [9900, null, null, null, null],
      [8900, 189, 4, null, null],
      [null, null, null, null, null],
    ],
  );
  assert.deepEqual([s.items[1].originalPrice, s.items[1].discountRate], [84000, 0.66]);
});
test("Phase12", "서로 다른 상품: 반복 칸은 첫 칸만 · 자연/광고 첫 순위 · 노출 횟수", () => {
  const u = uniqueSearchProducts(p12());
  assert.deepEqual(
    u.map((p) => [p.coupangProductId, p.organicRank, p.adRank, p.appearances]),
    [["1001", null, 1, 1], ["1002", 1, null, 2], ["1003", 2, null, 1], ["1004", null, 2, 1], ["1005", 4, null, 1], ["1006", 5, null, 1]],
  );
  assert.equal(u[1].item.productName, "자연1");
});
test("Phase12", "1페이지 집계 (광고 · 중복 제외): 평균가 · 평균 리뷰 · 로켓 비율 = 손 계산과 같음", () => {
  const a = aggregateSearch(p12());
  // 자연 · 중복 제외: 1002(27,990 · 13,372 · ROCKET) 1003(19,100 · 1,221 · GROWTH) 1005(8,900 · 189 · NONE) 1006(값 없음 · UNKNOWN)
  assert.equal(a.sampleSize, 4);
  assert.equal(a.averagePrice, Math.round((27990 + 19100 + 8900) / 3));
  assert.equal(a.averageReviews, Math.round(((13372 + 1221 + 189) / 3) * 10) / 10);
  assert.equal(a.rocketRatio, Math.round((2 / 3) * 10000) / 10000);
  assert.deepEqual([a.priceCount, a.reviewCount, a.badgeCount, a.rocketCount], [3, 3, 3, 2]);
});
test("Phase12", "집계 → 키워드 스냅샷 (COUPANG_PAGE · A · sample_size), 표본 없으면 레코드 없음", () => {
  const { record, issues } = normalizeKeyword(searchToKeywordRecord(p12()));
  assert.deepEqual(issues, []);
  assert.equal(record.source, "COUPANG_PAGE");
  assert.equal(record.confidence, "A");
  assert.deepEqual(record.metrics, { average_price: 18663, average_reviews: 4927.3, rocket_ratio: 0.6667, sample_size: 4 });
  assert.equal(searchToKeywordRecord({ ...p12(), items: [] }), null);
  assert.equal(normalizeKeyword({ ...searchToKeywordRecord(p12()), sampleSize: 0 }).issues.length, 1);
});
test("Phase12", "검색 칸 → 상품 스냅샷: 화면 칸 값만 · 반올림 별점 · 판매량 필드 없음", () => {
  const s = p12();
  const u = uniqueSearchProducts(s);
  const { record, issues } = normalizeProduct(searchItemToProduct(s, u[2]));
  assert.deepEqual(issues, []);
  // 평점은 저장하지 않는다 (검색 칸 별점은 0.5 단위 반올림) → 수집 기록에만
  assert.deepEqual(record.metrics, { product_name_observed: "자연2", price: 19100, review_count: 1221, delivery_type: "ROCKET_GROWTH", seller_type_observed: "ROCKET_GROWTH_SELLER" });
  assert.equal(searchItemToProduct(s, u[2]).observedOnly.searchStarRating, 4.5);
  const n = normalizeProduct(searchItemToProduct(s, u[1])).record;
  assert.deepEqual([n.metrics.original_price, n.metrics.discount_rate, n.metrics.seller_type_observed], [84000, 0.66, undefined]);
  assert.equal(Object.keys(n.metrics).some((k) => k.startsWith("sales") || k.startsWith("revenue")), false);
});
test("Phase12", "결과 상태: 완료 · 일부 미등록 · 등록 상품 없음 · 부분 오류 · 실패 구분", () => {
  assert.deepEqual(parseErrorSummary("KEYWORD_NOT_FOUND 3, PRODUCT_NOT_FOUND 42"), { KEYWORD_NOT_FOUND: 3, PRODUCT_NOT_FOUND: 42 });
  assert.equal(parseErrorSummary("전체 롤백 (저장된 데이터 없음): 22P02 x"), null);
  assert.equal(jobOutcome({ status: "SUCCEEDED", error_summary: null }), "COMPLETED");
  assert.equal(jobOutcome({ status: "PARTIAL", error_summary: "PRODUCT_NOT_FOUND 42" }), "PARTIAL");
  assert.equal(jobOutcome({ status: "PARTIAL", error_summary: "INVALID 1, PRODUCT_NOT_FOUND 2" }), "PARTIAL_ERROR");
  assert.equal(jobOutcome({ status: "FAILED", error_summary: "PRODUCT_NOT_FOUND 40" }), "NO_MATCH");
  assert.equal(jobOutcome({ status: "FAILED", error_summary: "KEYWORD_NOT_FOUND 49" }), "NO_MATCH");
  assert.equal(jobOutcome({ status: "FAILED", error_summary: "전체 롤백 (저장된 데이터 없음): P0001 x" }), "FAILED");
  assert.equal(jobOutcome({ status: "FAILED", error_summary: "INVALID 1" }), "FAILED");
  assert.equal(jobOutcome({ status: "ROLLED_BACK" }), "ROLLED_BACK");
});
test("Phase12", "등록 여부 요청: 숫자 ID · 300개 제한 · 키워드 1~100자 · 중복 제거", () => {
  assert.deepEqual(parseLookupRequest({ keyword: " 캠핑  의자 ", coupangProductIds: ["1", "1", "2"] }), { ok: true, keyword: "캠핑 의자", coupangProductIds: ["1", "2"] });
  assert.equal(parseLookupRequest({ coupangProductIds: ["abc"] }).ok, false);
  assert.equal(parseLookupRequest({ coupangProductIds: Array.from({ length: 301 }, (_, i) => String(i)) }).status, 413);
  assert.equal(parseLookupRequest({ keyword: "", coupangProductIds: [] }).ok, false);
  assert.equal(parseLookupRequest(null).ok, false);
});
const regBody = (over = {}) => ({
  idempotencyKey: KEY,
  tool: "jarvis-extension",
  version: "0.1.0",
  records: [{ kind: "search", ...p12() }],
  products: [{ coupangProductId: "1003", productName: " 자연2 " }],
  ...over,
});
test("Phase12", "선택 상품 등록 요청: 고른 상품만 · 검색 결과 밖 상품 거부 · 키워드는 검색어와 같아야 · 100개 제한", () => {
  const ok = parseRegisterRequest(regBody({ registerKeyword: "캠핑의자" }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.request.products, [{ coupang_product_id: "1003", product_name: "자연2" }]);
  assert.deepEqual(ok.request.keyword, { keyword: "캠핑의자", memo: null });
  assert.match(parseRegisterRequest(regBody({ products: [{ coupangProductId: "9999" }] })).error, /검색 결과에 없습니다/);
  assert.match(parseRegisterRequest(regBody({ products: [] })).error, /선택한 상품이 없습니다/);
  assert.match(parseRegisterRequest(regBody({ registerKeyword: "다른검색어" })).error, /검색어와 다릅니다/);
  assert.match(parseRegisterRequest(regBody({ records: [{ kind: "product", ...adaptProductPage(KOMET_RAW, META) }] })).error, /검색 결과에 없습니다/);
  assert.equal(parseRegisterRequest(regBody({ products: Array.from({ length: 101 }, (_, i) => ({ coupangProductId: String(1000 + i) })) })).status, 413);
  assert.equal(parseRegisterRequest(regBody({ idempotencyKey: "x" })).ok, false);
});

let failed = 0;
let total = 0;
for (const [g, list] of Object.entries(groups)) {
  let ok = 0;
  for (const [name, fn] of list) {
    total += 1;
    try {
      await fn();
      ok += 1;
      console.log(`  ✓ [${g}] ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ [${g}] ${name}\n    ${error.message.split("\n").join("\n    ")}`);
    }
  }
  console.log(`  ${g}: ${ok}/${list.length}`);
}
console.log(`\nExtension ${total - failed}/${total}`);
process.exit(failed ? 1 : 0);
