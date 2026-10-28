// npm run picks:save -- <picks.json> --candidates <candidates.json> [--owner <uuid>] [--by CLAUDE_SCHEDULED|CLAUDE_MANUAL]
// 매일 오전 추천 (PHASE 24) 2단계: 고른 상품(최대 3개)을 오늘 날짜로 daily_picks 에 저장한다.
// 입력 JSON: [{ "productId": "...", "reason": "...", "risks": ["..."], "sourcing": {...}, "metrics": {...} }, ...] (순서 = 순위)
// 그 사용자의 상품인지 확인한 뒤 저장한다. 오늘 이미 저장한 순위는 바꾸고, 남는 순위는 지운다 (과거 날짜는 그대로).
// --candidates 를 주면 productId 앞자리(8자 이상)로 후보를 찾고, 판단에 쓴 수치(metrics)를 후보 값으로 채운다 (손으로 옮겨 적지 않도록).
import { readFileSync } from "node:fs";
import { adminClient, kstToday, resolveOwner } from "./lib.mjs";

const argv = process.argv.slice(2);
// 2026-10-28 사용자 결정: 판정 엔진이 검증될 때까지 매일 추천 저장을 멈춘다 (src/config/picks.ts). 테스트 발굴은 picks:candidates 로.
const { DAILY_PICKS } = await import("../../src/config/picks.ts");
if (!DAILY_PICKS.enabled && !argv.includes("--force")) {
  console.error(`매일 추천이 멈춰 있습니다 (${DAILY_PICKS.pausedOn}~): ${DAILY_PICKS.reason}. 저장하지 않았습니다. 정말 저장하려면 --force`);
  process.exit(2);
}
const flagVal = new Set(["--owner", "--by", "--candidates"]);
const file = argv.find((a, i) => !a.startsWith("--") && !flagVal.has(argv[i - 1]));
if (!file) throw new Error("저장할 추천 JSON 파일 경로가 필요합니다");
const by = argv.includes("--by") ? argv[argv.indexOf("--by") + 1] : "CLAUDE_SCHEDULED";
const picks = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(picks) || picks.length === 0 || picks.length > 3) throw new Error("추천은 1~3개 배열이어야 합니다");

const ci = argv.indexOf("--candidates");
const cand = ci >= 0 ? JSON.parse(readFileSync(argv[ci + 1], "utf8")) : null;
if (cand) {
  for (const p of picks) {
    const hits = cand.pool.filter((c) => c.productId.startsWith(p.productId));
    if (p.productId.length < 8 || hits.length !== 1) throw new Error(`후보에서 상품을 하나로 찾지 못했습니다: ${p.productId}`);
    const c = hits[0];
    p.productId = c.productId;
    p.metrics = {
      ...(p.metrics ?? {}),
      price: c.price,
      monthlySales: c.sales.monthly,
      revenueMid: c.sales.revenue?.mid ?? null,
      salesConfidence: c.sales.confidence,
      salesBasis: c.sales.methods,
      allowedCost: c.economics?.allowedCost ?? null,
      afterPromo: c.economics?.afterPromo ?? null,
      grade: c.economics?.grade ?? null,
      reviewCount: c.reviewCount,
      rating: c.rating,
      keyword: c.keyword,
      candidatesAt: cand.generatedAt,
      versions: "est-sales-v1 · unit-econ-v2 · judge-v2",
    };
  }
}

const db = adminClient();
const owner = await resolveOwner(db, argv);
const today = kstToday();
const ids = picks.map((p) => p.productId);
const { data: prods, error } = await db.from("products").select("id, product_name").eq("owner_id", owner).in("id", ids);
if (error) throw error;
const nameOf = new Map(prods.map((p) => [p.id, p.product_name]));
for (const id of ids) if (!nameOf.has(id)) throw new Error(`이 사용자의 상품이 아닙니다: ${id}`);
if (new Set(ids).size !== ids.length) throw new Error("같은 상품이 두 번 들어 있습니다");

const rows = picks.map((p, i) => ({
  owner_id: owner,
  pick_date: today,
  rank: i + 1,
  product_id: p.productId,
  title: nameOf.get(p.productId),
  reason: String(p.reason ?? "").slice(0, 2000),
  risks: (p.risks ?? []).map((r) => String(r).slice(0, 300)).slice(0, 10),
  sourcing: p.sourcing ?? {},
  metrics: p.metrics ?? {},
  picked_by: by,
  status: "NEW",
}));
const { error: e1 } = await db.from("daily_picks").upsert(rows, { onConflict: "owner_id,pick_date,rank" });
if (e1) throw e1;
const { error: e2 } = await db.from("daily_picks").delete().eq("owner_id", owner).eq("pick_date", today).gt("rank", rows.length);
if (e2) throw e2;
console.log(`저장: ${today} 추천 ${rows.length}개 — ${rows.map((r) => `${r.rank}. ${r.title.slice(0, 30)}`).join(" / ")}`);
