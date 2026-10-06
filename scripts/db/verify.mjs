// npm run db:verify
// PGlite 에 supabase/migrations 를 순서대로 적용한 뒤 supabase/verify/phase2_verify.sql 을 실행한다.
// 검증 스크립트는 BEGIN … ROLLBACK 이며, 실패 항목이 있으면 즉시 오류로 멈춘다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, createMigratedDb } from "./pglite.mjs";

const VERIFY_SQL = join(ROOT, "supabase", "verify", "phase2_verify.sql");

console.log("마이그레이션 적용 (PGlite)");
const db = await createMigratedDb({ log: console.log });

try {
  console.log("\nscoring v1 seed ↔ src/config/scoring-weights.ts");
  await checkScoringSeed(db);

  console.log("\n검증 스크립트 실행");
  const results = await db.exec(readFileSync(VERIFY_SQL, "utf8"));
  const summary = results.findLast((r) => r.fields.some((f) => f.name === "passed"));
  const { passed, passed_checks: checks } = summary.rows[0];
  for (const line of checks.trim().split("\n")) console.log(`  ✓ ${line}`);
  console.log(`\n통과 ${passed}개`);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}

// DB seed 가 PHASE 1 TS 상수와 정확히 같은지 (Node 의 TS type stripping 으로 원본 파일을 직접 읽는다)
async function checkScoringSeed(db) {
  const ts = await import("../../src/config/scoring-weights.ts");
  const {
    rows: [seed],
  } = await db.query("select weights, thresholds, factor_definitions from public.scoring_versions where version = 'v1'");

  const tsWeights = Object.fromEntries(ts.SCORE_FACTORS.map((k) => [k, ts.DEFAULT_SCORE_WEIGHTS[k].weight]));
  const problems = [];
  for (const key of new Set([...Object.keys(tsWeights), ...Object.keys(seed.weights)])) {
    if (tsWeights[key] !== seed.weights[key]) problems.push(`weight ${key}: TS ${tsWeights[key]} / DB ${seed.weights[key]}`);
    if (ts.DEFAULT_SCORE_WEIGHTS[key]?.label !== seed.factor_definitions[key]?.label) problems.push(`label ${key}`);
  }
  for (const key of Object.keys(ts.VERDICT_THRESHOLDS)) {
    if (ts.VERDICT_THRESHOLDS[key] !== seed.thresholds[key]) problems.push(`threshold ${key}`);
  }
  if (ts.totalWeight() !== 100) problems.push(`TS totalWeight ${ts.totalWeight()}`);
  if (problems.length) throw new Error(`scoring seed 불일치: ${problems.join(", ")}`);
  console.log(`  ✓ 가중치 9개·라벨·판정 기준(${ts.VERDICT_THRESHOLDS.strongBuy}/${ts.VERDICT_THRESHOLDS.review}) 일치, 합계 100`);
}
