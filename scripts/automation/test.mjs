// npm run test:automation — PHASE 17 자동 발굴 순수 함수 (키워드 후보 · 상품 자동 선정 · 판매 가능성 사전 검토) · PHASE 21 소싱 대상 단계
import assert from "node:assert/strict";

const { candidatesFromRelated } = await import("../../src/lib/automation/discovery.ts");
const { searchResultFromRows, selectUnregistered, autoRegisterBatch, MAX_AUTO_REGISTER } = await import("../../src/lib/automation/selection.ts");
const { screenCompliance, overallStatus, isGeneralCandidate, isExcluded, effectiveCompliance, COMPLIANCE_RULE_VERSION } = await import("../../src/lib/automation/compliance.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = "2026-10-12T06:00:00.000Z";

// 키워드 후보 ------------------------------------------------------------------------
const rel = (relKeyword, pc, mobile, compIdx = "중간") => ({ relKeyword, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, compIdx });

test("후보: 시드 · 등록 키워드(공백 · 대소문자 무시) · 응답 중복 · 의미 없는 문자열 제외, 나머지는 모두 남김 (검색량으로 거르지 않음)", () => {
  const { candidates, dropped } = candidatesFromRelated(
    "실리콘 트레이",
    [rel("실리콘트레이", 120, 440), rel("실리콘얼음틀", 1200, 9800), rel("실리콘얼음틀", 1200, 9800), rel("실리콘주방트레이", "< 10", "< 10"), rel("1", 10, 10), rel("123", 50, 50), rel("SILICONE", 30, 70), rel("이유식큐브", 15, "1,200")],
    ["실리콘주방 트레이", "silicone"],
  );
  assert.deepEqual(candidates.map((c) => c.keyword), ["실리콘얼음틀", "이유식큐브"]);
  assert.deepEqual(dropped, { SAME_AS_SEED_OR_REGISTERED: 3, DUPLICATE: 1, MEANINGLESS: 2 });
  assert.equal(candidates[0].searchVolume, 11000);
  assert.equal(candidates[1].searchVolume, 1215); // "1,200" 쉼표 숫자
  assert.equal(candidates[0].seed, "실리콘 트레이");
});
test("후보: \"<10\" 은 버리지 않고 검색량 NULL + below10 (0 으로 만들지 않음)", () => {
  const { candidates } = candidatesFromRelated("시드", [rel("실리콘 받침", "< 10", 40)], []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].below10, true);
  assert.equal(candidates[0].searchVolume, null);
  assert.equal(candidates[0].monthlyPc, null);
  assert.equal(candidates[0].monthlyMobile, 40);
});

// 상품 자동 선정 ---------------------------------------------------------------------
const slot = (id, rank, isAd, extra = {}) => ({
  payload: { collected: { keyword: "실리콘 트레이", page: 1, coupangProductId: id, rank, isAd, productName: `상품${id}`, price: 1000 + Number(id), reviewCount: 10, rating: 4.5, badge: "ROCKET", deliveryType: "ROCKET", ...extra } },
});
const rows = [slot("1", 1, true), slot("2", 1, false), slot("1", 2, false), slot("3", 3, false), slot("3", 4, false), slot("4", 5, false), { payload: { collected: { keyword: "다른 키워드", coupangProductId: "9", rank: 1 } } }, { payload: null }];

test("자동 선정: 수집 기록 → 화면 값 그대로 검색 결과 (다른 키워드 · 빈 행은 섞지 않음)", () => {
  const r = searchResultFromRows(rows, { keyword: "실리콘 트레이", capturedAt: NOW, tool: "jarvis-automation/1" });
  assert.equal(r.items.length, 6);
  assert.equal(r.source, "COUPANG_PAGE");
  assert.equal(r.confidence, "A");
  assert.equal(r.page, 1);
  assert.ok(r.items.every((i) => !("keyword" in i) && !("page" in i)));
  assert.equal(searchResultFromRows([], { keyword: "x", capturedAt: NOW, tool: "t" }), null);
});
test("자동 선정: 미등록 상품만 · 같은 상품 반복 칸은 하나로 (사람이 고르던 단계 대신, 새 기준 없음)", () => {
  const r = searchResultFromRows(rows, { keyword: "실리콘 트레이", capturedAt: NOW, tool: "t" });
  const sel = selectUnregistered(r, new Set(["2"]));
  assert.deepEqual(sel.picked.map((p) => p.coupangProductId), ["1", "3", "4"]);
  assert.equal(sel.alreadyRegistered, 1);
  assert.equal(sel.duplicateSlots, 2);
  const p1 = sel.picked[0];
  assert.equal(p1.organicRank, 2);
  assert.equal(p1.adRank, 1);
  const batch = autoRegisterBatch(r, sel.picked);
  assert.deepEqual([...new Set(batch.searches[0].items.map((i) => i.coupangProductId))], ["1", "3", "4"]);
  assert.equal(batch.products.length, 3);
  // 검색 화면에 없는 값 (판매량 · 전환율)은 만들지 않는다 · 평점은 검색 칸 값을 상품 값으로 쓰지 않음 (기존 규칙)
  for (const p of batch.products) {
    assert.ok(!("salesActual" in p) && !("conversionRate" in p));
    assert.equal(p.rating, undefined);
  }
});
test("자동 선정: 모두 등록돼 있으면 0개 (다음 실행 중복 등록 없음) · 한 번에 100개 상한", () => {
  const r = searchResultFromRows(rows, { keyword: "실리콘 트레이", capturedAt: NOW, tool: "t" });
  assert.equal(selectUnregistered(r, new Set(["1", "2", "3", "4"])).picked.length, 0);
  const many = { ...r, items: Array.from({ length: 130 }, (_, i) => ({ coupangProductId: String(1000 + i), rank: i + 1, isAd: false })) };
  const sel = selectUnregistered(many, new Set());
  assert.equal(sel.picked.length, MAX_AUTO_REGISTER);
  assert.equal(sel.overLimit, 30);
});

// 판매 가능성 ------------------------------------------------------------------------
const screen = (productName, brand = null, category = null) => screenCompliance({ productName, brand, category }, NOW);
const areas = (r) => Object.fromEntries(r.findings.map((f) => [f.area + ":" + f.rule, f.status]));

test("판매 가능성: 실리콘 트레이 · 얼음틀 → 식품용 기구 확인 필요 (근거 · 규정 · 시점 · 자동 표시), 판매 금지 확정 아님", () => {
  for (const name of ["모나코올리브 모던 실리콘 트레이 대형, 화이트", "실리콘 소분용기 2P세트 냉동 멀티큐브 얼음틀"]) {
    const r = screen(name);
    assert.equal(r.status, "REQUIRES_CERTIFICATION", name);
    const f = r.findings.find((x) => x.rule === "food-contact");
    assert.match(f.evidence, /상품명에/);
    assert.match(f.source, /식품위생법/);
    assert.equal(f.method, "AUTO");
    assert.equal(f.checkedAt, NOW);
    assert.ok(!isExcluded(r.status) && !isGeneralCandidate(r.status));
  }
});
test("판매 가능성: 문맥 없는 단어는 걸지 않는다 (자동차 수납 트레이 → 식품용 기구 아님 → 근거 부족 UNKNOWN)", () => {
  const r = screen("자동차 콘솔 수납 트레이");
  assert.equal(r.status, "UNKNOWN");
  assert.equal(areas(r)["CERTIFICATION:no-rule-matched"], "UNKNOWN");
  assert.ok(!r.findings.some((f) => f.rule === "food-contact"));
});
test("판매 가능성: 실제 수집 상품명에서 찾은 오탐 · 누락 (색상 '크림' · 식기건조대 · 펜 트레이 / 소분 냉동 몰드)", () => {
  assert.ok(!screen("유피어 가죽 모던 트레이, 크림, 1개").findings.some((f) => f.rule === "cosmetics"));
  assert.ok(!screen("실리가든 국산 실리콘 얼음트레이 원형 6구 2종, 피치핑크 + 크림베이지").findings.some((f) => f.rule === "cosmetics"));
  for (const name of ["HeyHome 실리콘 물빠짐 트레이 싱크대 식기건조대 건조 방수", "블리스온 경사형 실리콘 싱크대 세면대 선반 물빠짐 건조 거치대 트레이", "페니체 오피스 가죽 펜 트레이, 1개, 화이트"]) {
    assert.ok(!screen(name).findings.some((f) => f.rule === "food-contact"), name);
  }
  assert.equal(screen("나르비 푸드블럭 4구 실리콘 소분 냉동 몰드, 1개, 파스텔그린").status, "REQUIRES_CERTIFICATION");
  assert.equal(screen("실리콘 대형 얼음트레이 하이볼 얼음틀 8구").status, "REQUIRES_CERTIFICATION");
  // 쟁반 카테고리 + 일반 단어 트레이 → 식품용 기구 가능성 (카테고리 근거)
  assert.equal(screen("리빙메이트 국산 컬러 트레이", null, "결혼준비 > 주방용품 > 테이블웨어 > 쟁반/베드트레이 > 쟁반").status, "REQUIRES_CERTIFICATION");
  assert.equal(screen("리빙메이트 국산 컬러 트레이").status, "UNKNOWN");
});
test("판매 가능성: 브랜드 상품은 제외하지 않고 정품 증빙 필요로 · 브랜드 모르면 근거 부족", () => {
  const r = screen("원목 책상 정리함", "에이드엘");
  assert.equal(r.status, "REQUIRES_BRAND_PROOF");
  assert.ok(!isExcluded(r.status));
  assert.equal(areas(screen("원목 책상 정리함"))["BRAND:brand-unknown"], "UNKNOWN");
});
test("판매 가능성: 위조 표현 · 제한 품목 단어 → 추가 확인 필요 (단어만으로 판매 금지 확정 안 함)", () => {
  for (const name of ["명품 스타일 레플리카 가방", "전자담배 액상 케이스"]) {
    const r = screen(name);
    assert.equal(r.status, "MANUAL_REVIEW", name);
    assert.ok(r.findings.every((f) => f.status !== "BLOCKED"));
  }
});
test("판매 가능성: 품목별 규정 (전기 · 어린이 · 화장품 · 생활화학) — 모든 상품에 같은 인증을 붙이지 않음", () => {
  assert.equal(screen("USB 충전식 미니 히터").findings.find((f) => f.area === "CERTIFICATION").rule, "electric");
  assert.ok(screen("유아 실리콘 이유식 식판").findings.some((f) => f.rule === "children-product"));
  assert.equal(screen("수분 크림 50ml").findings.find((f) => f.area === "CERTIFICATION").rule, "cosmetics");
  assert.equal(screen("욕실 곰팡이 세정제").findings.find((f) => f.area === "CERTIFICATION").rule, "household-chemical");
  assert.ok(!screen("원목 책상 정리함").findings.some((f) => f.status === "REQUIRES_CERTIFICATION"));
  // 카테고리로도 판단 (근거에 카테고리 표시)
  const c = screen("멀티 큐브 세트", null, "주방용품 > 실리콘 용기");
  assert.equal(c.status, "REQUIRES_CERTIFICATION");
  assert.match(c.findings.find((f) => f.rule === "food-contact").evidence, /카테고리: 주방용품/);
});
test("판매 가능성: 공급 가능성은 항상 근거 부족 · 자동 판단은 BLOCKED · CLEARED 를 만들지 않음 · CLEARED 는 사용자 확인만", () => {
  for (const name of ["모나코올리브 실리콘 트레이", "원목 책상 정리함", "레플리카 가방", "USB 히터"]) {
    const r = screen(name);
    assert.equal(areas(r)["SUPPLY:no-supplier-source"], "UNKNOWN");
    assert.ok(!["BLOCKED", "CLEARED"].includes(r.status));
  }
  const userCleared = [{ area: "PROHIBITED", status: "CLEARED", method: "USER" }, { area: "SUPPLY", status: "CLEARED", method: "USER" }];
  assert.equal(overallStatus(userCleared), "CLEARED");
  assert.equal(overallStatus([{ area: "SUPPLY", status: "CLEARED", method: "AUTO" }]), "UNKNOWN");
  assert.equal(overallStatus([{ area: "PROHIBITED", status: "BLOCKED", method: "USER" }, { area: "BRAND", status: "REQUIRES_BRAND_PROOF", method: "AUTO" }]), "BLOCKED");
  assert.ok(isGeneralCandidate("CLEARED") && !isGeneralCandidate("UNKNOWN") && !isGeneralCandidate("REQUIRES_CERTIFICATION"));
  assert.ok(isExcluded("BLOCKED") && !isExcluded("MANUAL_REVIEW"));
  assert.equal(COMPLIANCE_RULE_VERSION, "compliance-rules-v2");
});

test("[PHASE 28] 전기 · 전파 규칙 v2: 무선 청소기 · 블루투스 · 랜턴은 인증 필요, 청소솔 · 밀대는 아님", () => {
  const at = "2026-10-28T00:00:00Z";
  const rules = (name) => screenCompliance({ productName: name, brand: null, category: null }, at).findings.filter((f) => f.status === "REQUIRES_CERTIFICATION").map((f) => f.rule);
  assert.deepEqual(rules("차량용 무선 청소기 핸디형 초강력 흡입"), ["electric"]);
  assert.deepEqual(rules("미니 핸디 청소기 차량용"), ["electric"]);
  assert.ok(rules("블루투스 무선 스피커 캠핑").includes("radio") && rules("블루투스 무선 스피커 캠핑").includes("electric"));
  assert.deepEqual(rules("캠핑 랜턴 감성 캠핑등"), ["electric"]);
  assert.deepEqual(rules("차량용 청소솔 틈새 브러쉬"), []);
  assert.deepEqual(rules("방풍비닐 투명 창문 외풍차단"), []);
  assert.deepEqual(rules("허리 서포트 쿠션"), []);
  assert.deepEqual(rules("보온보냉 주전자 1.5L"), []);
  assert.deepEqual(rules("케이크토퍼 문구완전자유"), []);
  // PHASE 29: 가스 · 유선 전자기기(EMC) · 액세서리 제외
  assert.deepEqual(rules("캠핑 요리용 토치"), ["gas-appliance"]);
  assert.deepEqual(rules("저소음 사무용 키보드"), ["radio"]);
  assert.deepEqual(rules("대형 마우스패드 데스크매트"), []);
  assert.deepEqual(rules("캠핑화로대 접이식"), []);
});

test("[PHASE 28] effectiveCompliance: 사용자 판단 유지 · 자동이면 새 규칙과 저장값 중 엄격한 쪽", () => {
  const at = "2026-10-28T00:00:00Z";
  const input = { productName: "차량용 무선 청소기", brand: null, category: null };
  const oldAuto = { status: "UNKNOWN", decidedBy: "AUTO", ruleVersion: "compliance-rules-v1" };
  const e = effectiveCompliance(oldAuto, input, at);
  assert.equal(e.status, "REQUIRES_CERTIFICATION");
  assert.deepEqual(e.certifications, ["전기용품 KC"]);
  assert.equal(e.rescreened, true);
  assert.equal(effectiveCompliance({ status: "CLEARED", decidedBy: "USER", ruleVersion: "compliance-rules-v1" }, input, at).status, "CLEARED");
  // 저장값이 더 엄격하면 (브랜드 · 판매 제한) 유지
  assert.equal(effectiveCompliance({ status: "MANUAL_REVIEW", decidedBy: "AUTO", ruleVersion: "compliance-rules-v1" }, input, at).status, "MANUAL_REVIEW");
  assert.equal(effectiveCompliance(null, { productName: "방풍비닐", brand: null, category: null }, at).status, "UNKNOWN");
});

// 발굴 → 후보 → 소싱 단계 (PHASE 21) ----------------------------------------------------
const { productStage, sourcingScope, stageCounts, SOURCING_SCOPE_STATUSES } = await import("../../src/lib/discover/stage.ts");
const { readFileSync: readSrc } = await import("node:fs");
const row = (id, watchStatus, linkStatuses = [], blockedByUser = false) => ({ productId: id, watchStatus, linkStatuses, blockedByUser });

test("[PHASE 21] 선택 상품 0개: 발굴 상품이 있어도 소싱 대상 0 (미검토 · 후보 · 제외 모두 대상 아님)", () => {
  const rows = [row("a", null), row("b", null), row("c", "WATCHING"), row("d", "DROPPED")];
  assert.deepEqual(sourcingScope(rows), []);
  const c = stageCounts(rows);
  assert.equal(c.total, 4);
  assert.equal(c.inScope, 0);
  assert.equal(c.DISCOVERED, 2);
  assert.equal(c.SHORTLISTED, 1);
  assert.equal(c.REJECTED, 1);
});

test("[PHASE 21] 1개 [소싱 시작] → 그 상품만 대상 / 여러 개 → 고른 것만 대상", () => {
  assert.deepEqual(sourcingScope([row("a", "SOURCING"), row("b", null), row("c", "WATCHING")]), ["a"]);
  assert.deepEqual(sourcingScope([row("a", "SOURCING"), row("b", "SOURCING"), row("c", "WATCHING"), row("d", null), row("e", "SOURCING")]), ["a", "b", "e"]);
  // 샘플 · 판매 등 이후 단계도 계속 소싱 대상 (공급 후보 · 원가 갱신)
  for (const s of SOURCING_SCOPE_STATUSES) assert.equal(productStage(row("x", s)).inScope, true, s);
});

test("[PHASE 21] 검토 제외 · 판매 중단 · 판매 불가(사용자 판단)는 소싱 단계여도 대상 아님", () => {
  assert.equal(productStage(row("a", "DROPPED")).inScope, false);
  assert.equal(productStage(row("a", "STOPPED")).inScope, false);
  const b = productStage(row("a", "SOURCING", ["SELECTED"], true));
  assert.equal(b.stage, "BLOCKED");
  assert.equal(b.inScope, false);
  assert.match(b.blocker, /판매 불가/);
});

test("[PHASE 21] 소싱 대상 안의 단계: 공급 후보 없음 → 진행 중 / 제외 아닌 후보 → 확보(검증 아님) / [선택] → 공급업체 선택됨", () => {
  assert.equal(productStage(row("a", "SOURCING")).stage, "SOURCING");
  assert.equal(productStage(row("a", "SOURCING", ["REJECTED"])).stage, "SOURCING");
  assert.equal(productStage(row("a", "SOURCING", ["CANDIDATE", "REJECTED"])).stage, "SOURCED");
  assert.equal(productStage(row("a", "SOURCING", ["CANDIDATE", "SELECTED"])).stage, "SUPPLIER_SELECTED");
  assert.match(productStage(row("a", "SOURCING")).blocker, /자동 검색 없음/);
  // 후보 단계 상품에 예전 공급 후보 기록이 있어도 대상이 아니다 (기록은 지우지 않음)
  assert.equal(productStage(row("a", "WATCHING", ["SELECTED"])).inScope, false);
});

test("[PHASE 21] 자동 실행 · 소싱 코드는 사용자의 선택 · 제외 상태를 쓰지 않는다 (관심상품 · 공급 후보 선택 상태 쓰기 없음)", () => {
  const files = ["src/lib/automation/pipeline.ts", "src/lib/repositories/sourcing.ts", "src/lib/repositories/costs.ts", "src/lib/repositories/stage.ts", "src/app/api/supply/ingest/route.ts"];
  for (const f of files) {
    const s = readSrc(f, "utf8");
    assert.ok(!/from\("watchlist"\)\s*\.(insert|update|upsert|delete)/.test(s), `${f}: watchlist 쓰기`);
    assert.ok(!/updateWatchlistStatus|addToWatchlist|releaseFromWatchlist/.test(s), `${f}: 관심상품 단계 변경 호출`);
    assert.ok(!/user_status\s*:/.test(s), `${f}: 공급 후보 선택 상태 쓰기`);
  }
  const pipe = readSrc("src/lib/automation/pipeline.ts", "utf8");
  assert.match(pipe, /listSourcingScope\(\)/);
  assert.match(pipe, /ensureQueries\(scope\)/);
  assert.match(pipe, /refreshLinks\(scope\)/);
  assert.match(pipe, /recordAllDetails\(scope\)/);
  assert.match(pipe, /scope\.length === 0[\s\S]{0,80}SKIPPED/);
  const ingest = readSrc("src/app/api/supply/ingest/route.ts", "utf8");
  assert.match(ingest, /autoLinkOffer\(saved\.id, scope\)/);
  const src = readSrc("src/lib/repositories/sourcing.ts", "utf8");
  assert.match(src, /if \(scope\.length === 0\) return \{ linked: 0, checked: 0 \}/);
  assert.match(src, /if \(scope\.length === 0\) return \{ created: 0, updated: 0, kept: 0 \}/);
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
console.log(`\nAutomation ${passed}/${tests.length}`);
