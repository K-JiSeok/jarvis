// npm run test:validation — src/lib/validation/engine.ts (validation-v1) 순수 함수 검증
import assert from "node:assert/strict";

const { evaluatePrediction, summarizeValidation, reviewRateBound, VALIDATION_RULES } = await import("../../src/lib/validation/engine.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const pred = (over = {}) => ({ productId: "p1", start: "2026-10-28", sales: { min: 600, mid: 1000, max: 3000 }, verdict: "REVIEW", keyword: "k", name: "n", ...over });

test("예측 뒤 7일 미만 → 대기 / 기준일 리뷰 기록 없음 → 대기", () => {
  assert.equal(evaluatePrediction(pred(), [{ on: "2026-10-28", count: 100 }], [], "2026-11-01").status, "PENDING");
  const e = evaluatePrediction(pred(), [{ on: "2026-10-01", count: 100 }], [], "2026-11-10");
  assert.equal(e.status, "PENDING");
  assert.ok(e.note.includes("리뷰 수 기록 없음"));
});

test("지속성: 14일 동안 리뷰 +14 → 월 30개 리뷰 → 가운데(3%) 월 1,000개 = 예측과 같음 · 범위 안", () => {
  const e = evaluatePrediction(pred(), [{ on: "2026-10-28", count: 100 }, { on: "2026-11-11", count: 114 }], [], "2026-11-12");
  assert.equal(e.status, "EVALUATED");
  assert.equal(e.persistence.observedMid, 1000);
  assert.equal(e.persistence.ratio, 1);
  assert.equal(e.persistence.within, true);
});

test("지속성: 리뷰가 거의 안 늘면 범위 밖 · 비율 낮음 / 35일 넘은 관찰은 쓰지 않음", () => {
  const e = evaluatePrediction(pred(), [{ on: "2026-10-28", count: 100 }, { on: "2026-11-04", count: 101 }], [], "2026-11-05");
  assert.equal(e.persistence.within, false);
  assert.ok(e.persistence.ratio < 0.5);
  const far = evaluatePrediction(pred(), [{ on: "2026-10-28", count: 100 }, { on: "2026-12-20", count: 200 }], [], "2026-12-21");
  assert.equal(far.persistence, null);
  assert.equal(far.status, "NO_DATA");
});

test("쿠팡 표시 하한: 예측 최대값보다 크면 과소 추정 / 작으면 정상", () => {
  assert.equal(evaluatePrediction(pred(), [], [{ on: "2026-10-30", floor: 5000 }], "2026-11-01").badge.under, true);
  assert.equal(evaluatePrediction(pred(), [], [{ on: "2026-10-30", floor: 800 }], "2026-11-01").badge.under, false);
});

test("요약: 범위 안 비율 · 비율 중앙값 · 절반 미만 하락 수 · 과소 추정 수", () => {
  const evals = [
    evaluatePrediction(pred({ productId: "a" }), [{ on: "2026-10-28", count: 100 }, { on: "2026-11-11", count: 114 }], [], "2026-11-12"),
    evaluatePrediction(pred({ productId: "b" }), [{ on: "2026-10-28", count: 100 }, { on: "2026-11-11", count: 101 }], [{ on: "2026-11-11", floor: 5000 }], "2026-11-12"),
    evaluatePrediction(pred({ productId: "c" }), [{ on: "2026-10-28", count: 100 }], [], "2026-11-01"),
  ];
  const s = summarizeValidation(evals);
  assert.deepEqual([s.predictions, s.evaluated, s.pending], [3, 2, 1]);
  assert.equal(s.persistence.n, 2);
  assert.equal(s.persistence.withinRate, 0.5);
  assert.equal(s.persistence.dropCount, 1);
  assert.deepEqual(s.badge, { n: 1, under: 1 });
});

test("리뷰 작성률 상한: 10-28 실제 예 — 파티아일랜드 토퍼 월 리뷰 20 · 하한 700명 → 2.86% 이하", () => {
  const b = reviewRateBound({ productId: "x", name: "토퍼", floor: 700, monthlyReviews: 20 });
  assert.equal(b.upper, 0.0286);
  assert.equal(reviewRateBound({ productId: "x", name: null, floor: 0, monthlyReviews: 1 }), null);
  assert.equal(VALIDATION_RULES.minDays, 7);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\nValidation ${passed}/${tests.length}`);
