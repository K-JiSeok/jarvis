// npm run test:dashboard — src/lib/dashboard/aggregate.ts 순수 함수 검증 (Node 내장 assert)
import assert from "node:assert/strict";

import {
  pickReasons,
  pickRecommendations,
  recentlyAnalyzed,
  summarizeDataQuality,
  summarizeScores,
} from "../../src/lib/dashboard/aggregate.ts";

const s = (productId, total, verdict, calculatedAt = "2026-10-08T00:00:00Z") => ({ productId, total, verdict, calculatedAt });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("판정별 집계 · 미계산 = 점수 없는 상품 (EXCLUDE 로 치지 않음)", () => {
  const scores = new Map([
    ["a", s("a", 86, "STRONG_BUY")],
    ["b", s("b", 70, "REVIEW")],
    ["c", s("c", 40, "EXCLUDE")],
  ]);
  const r = summarizeScores(["a", "b", "c", "d", "e"], scores);
  assert.deepEqual(r, { products: 5, scored: 3, unscored: 2, byVerdict: { STRONG_BUY: 1, REVIEW: 1, EXCLUDE: 1 } });
});

test("대상 목록에 없는 상품(삭제 등)의 점수는 세지 않음", () => {
  const scores = new Map([["gone", s("gone", 95, "STRONG_BUY")], ["a", s("a", 50, "EXCLUDE")]]);
  const r = summarizeScores(["a", "b"], scores);
  assert.equal(r.scored, 1);
  assert.equal(r.byVerdict.STRONG_BUY, 0);
  assert.equal(r.unscored, 1);
});

test("같은 상품 id 가 중복돼도 한 번만 센다", () => {
  const r = summarizeScores(["a", "a", "b"], new Map([["a", s("a", 80, "STRONG_BUY")]]));
  assert.deepEqual([r.products, r.scored, r.unscored], [2, 1, 1]);
});

test("상품 0개 · 점수 0개", () => {
  assert.deepEqual(summarizeScores([], new Map()), { products: 0, scored: 0, unscored: 0, byVerdict: { STRONG_BUY: 0, REVIEW: 0, EXCLUDE: 0 } });
  assert.equal(summarizeScores(["a"], new Map()).unscored, 1);
});

test("추천: STRONG_BUY 전부 → REVIEW, 점수 높은 순, EXCLUDE 제외", () => {
  const list = [s("r1", 79.3, "REVIEW"), s("x", 99, "EXCLUDE"), s("sb2", 82.1, "STRONG_BUY"), s("r2", 71, "REVIEW"), s("sb1", 86.4, "STRONG_BUY")];
  assert.deepEqual(pickRecommendations(list, 10).map((x) => x.productId), ["sb1", "sb2", "r1", "r2"]);
});

test("추천: REVIEW 점수가 높아도 STRONG_BUY 뒤", () => {
  const list = [s("r", 79.99, "REVIEW"), s("sb", 80, "STRONG_BUY")];
  assert.deepEqual(pickRecommendations(list, 10).map((x) => x.productId), ["sb", "r"]);
});

test("추천: 같은 점수면 최근 계산 먼저 · 개수 제한", () => {
  const list = [s("old", 85, "STRONG_BUY", "2026-10-01T00:00:00Z"), s("new", 85, "STRONG_BUY", "2026-10-08T00:00:00Z"), s("z", 81, "STRONG_BUY")];
  assert.deepEqual(pickRecommendations(list, 2).map((x) => x.productId), ["new", "old"]);
});

test("추천: 점수 없음 → 빈 목록", () => {
  assert.deepEqual(pickRecommendations([], 6), []);
  assert.deepEqual(pickRecommendations([s("x", 10, "EXCLUDE")], 6), []);
});

test("최근 분석 순 · 원본 배열 변경 없음", () => {
  const list = [s("a", 1, "EXCLUDE", "2026-10-01T00:00:00Z"), s("b", 1, "EXCLUDE", "2026-10-08T00:00:00Z")];
  assert.deepEqual(recentlyAnalyzed(list, 5).map((x) => x.productId), ["b", "a"]);
  assert.equal(list[0].productId, "a");
});

test("근거: 가점 3 · 주의 2 까지, 문구 그대로", () => {
  const reasons = [
    { kind: "CAUTION", message: "c1" },
    { kind: "POSITIVE", message: "p1" },
    { kind: "POSITIVE", message: "p2" },
    { kind: "POSITIVE", message: "p3" },
    { kind: "POSITIVE", message: "p4" },
    { kind: "CAUTION", message: "c2" },
    { kind: "CAUTION", message: "c3" },
  ];
  assert.deepEqual(pickReasons(reasons).map((r) => r.message), ["p1", "p2", "p3", "c1", "c2"]);
  assert.deepEqual(pickReasons([]), []);
});

test("데이터 상태: 계산 가능 / 부족 / 저장 안 한 계산 가능 / 요소별 부족 수", () => {
  const f = (factor, score, need = "필요") => ({ factor, label: factor, score, missing: score == null ? [need] : [] });
  const previews = [
    { productId: "a", complete: true, factors: [f("demand", 50), f("conversion", 40)] },
    { productId: "b", complete: true, factors: [f("demand", 50), f("conversion", 40)] },
    { productId: "c", complete: false, factors: [f("demand", null, "키워드"), f("conversion", null, "전환율")] },
    { productId: "d", complete: false, factors: [f("demand", 50), f("conversion", null, "전환율")] },
  ];
  const q = summarizeDataQuality(previews, new Set(["a"]));
  assert.deepEqual([q.checked, q.computable, q.insufficient, q.computableUnsaved], [4, 2, 2, 1]);
  assert.deepEqual(q.missing.map((m) => [m.factor, m.count, m.need]), [["conversion", 2, "전환율"], ["demand", 1, "키워드"]]);
});

test("데이터 상태: 상품 없음", () => {
  assert.deepEqual(summarizeDataQuality([], new Set()), { checked: 0, computable: 0, insufficient: 0, computableUnsaved: 0, missing: [] });
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
console.log(`\nDashboard 집계 ${passed}/${tests.length}`);
