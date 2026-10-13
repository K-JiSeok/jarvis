// npm run picks:candidates [-- --owner <uuid>] [--out file.json]
// 매일 오전 추천 (PHASE 24) 1단계: 추천 후보 묶음을 만든다 (읽기만 — DB 에 쓰지 않음).
// 기존 순수 함수를 그대로 쓴다: 판매량 추정(est-sales-v1) · 단위 경제성(unit-econ-v1) · 카테고리 추정 · 단계(PHASE 21) · 검색어(sourcing-dict).
// 결과는 JSON. 최종 3개 선정 · 근거 작성은 예약 작업(Claude)이 한다.
import { writeFileSync } from "node:fs";
import { adminClient, kstToday, resolveOwner } from "./lib.mjs";

const { estimateSales } = await import("../../src/lib/estimate/sales.ts");
const { unitEconomics } = await import("../../src/lib/estimate/economics.ts");
const { guessCategory } = await import("../../src/lib/costs/category.ts");
const { productStage } = await import("../../src/lib/discover/stage.ts");
const { toSourcingQuery } = await import("../../src/lib/sourcing/translate.ts");

const argv = process.argv.slice(2);
const db = adminClient();
const owner = await resolveOwner(db, argv);
const today = kstToday();
const all = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};

const [prods, latest, snaps, rows, cardRows, watch, comp, links, picks, ranks, kws] = await Promise.all([
  all(db.from("products").select("id, coupang_product_id, product_name, created_at").eq("owner_id", owner)),
  all(db.from("v_product_latest").select("product_id, price, review_count, rating, delivery_type").eq("owner_id", owner)),
  all(db.from("product_snapshots").select("product_id, captured_on, review_count, is_excluded").eq("owner_id", owner).not("review_count", "is", null).limit(20000)),
  all(
    db
      .from("import_rows")
      .select("record_key, created_at, mb:payload->collected->observedOnly->>monthlyBuyers, rd:payload->collected->observedOnly->>reviewDates, cat:payload->collected->observedOnly->>category")
      .eq("owner_id", owner)
      .like("record_key", "product\\_snapshot:%")
      .order("created_at", { ascending: false })
      .limit(20000),
  ),
  all(db.from("cost_rate_cards").select("*").or(`owner_id.is.null,owner_id.eq.${owner}`)),
  all(db.from("watchlist").select("product_id, status").eq("owner_id", owner)),
  all(db.from("product_compliance").select("product_id, status, decided_by").eq("owner_id", owner)),
  all(db.from("product_supply_links").select("product_id, user_status").eq("owner_id", owner)),
  all(db.from("daily_picks").select("product_id, pick_date, status, picked_by, rank, title").eq("owner_id", owner).gte("pick_date", new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))),
  all(db.from("keyword_product_ranks").select("product_id, keyword_id, captured_on").eq("owner_id", owner).order("captured_on", { ascending: false }).limit(20000)),
  all(db.from("keywords").select("id, keyword, is_tracking").eq("owner_id", owner)),
]);

const cards = cardRows.map((r) => ({ id: r.id, ownerId: r.owner_id, kind: r.kind, scope: r.scope, rates: r.rates, vatBasis: r.vat_basis, validFrom: r.valid_from, validTo: r.valid_to, promoUntil: r.promo_until, sourceUrl: r.source_url, sourceLabel: r.source_label, checkedOn: r.checked_on, verification: r.verification, note: r.note }));
const byCoupang = new Map(prods.map((p) => [p.coupang_product_id, p.id]));
const priceOf = new Map(latest.map((l) => [l.product_id, l]));
const hist = new Map();
for (const s of snaps) {
  if (s.is_excluded) continue;
  const m = hist.get(s.product_id) ?? new Map();
  m.set(s.captured_on, Math.max(m.get(s.captured_on) ?? 0, s.review_count));
  hist.set(s.product_id, m);
}
const badge = new Map();
const sample = new Map();
const catOf = new Map();
let lastProductCollect = null;
for (const r of rows) {
  const [, cid, day] = (r.record_key ?? "").split(":");
  const pid = byCoupang.get(cid);
  if (!pid) continue;
  if (!lastProductCollect || day > lastProductCollect) lastProductCollect = day;
  if (r.mb && !badge.has(pid)) badge.set(pid, { text: r.mb, on: day });
  if (r.rd && !sample.has(pid)) sample.set(pid, { dates: r.rd.split(","), capturedOn: day });
  if (r.cat && !catOf.has(pid)) catOf.set(pid, r.cat);
}
const watchOf = new Map(watch.map((w) => [w.product_id, w.status]));
const blocked = new Set(comp.filter((c) => c.decided_by === "USER" && c.status === "BLOCKED").map((c) => c.product_id));
const compOf = new Map(comp.map((c) => [c.product_id, c.status]));
const linksOf = new Map();
for (const l of links) linksOf.set(l.product_id, [...(linksOf.get(l.product_id) ?? []), l.user_status]);
const recentPick = new Map(picks.map((p) => [p.product_id, p]));
const kwName = new Map(kws.map((k) => [k.id, k.keyword]));
const kwOf = new Map();
let lastSearchCollect = null;
for (const r of ranks) {
  if (!lastSearchCollect || r.captured_on > lastSearchCollect) lastSearchCollect = r.captured_on;
  if (!kwOf.has(r.product_id)) kwOf.set(r.product_id, kwName.get(r.keyword_id) ?? null);
}

const pool = [];
const excluded = { noSales: 0, lowPrice: 0, rejected: 0, recentlyPicked: 0, noPrice: 0 };
for (const p of prods) {
  const l = priceOf.get(p.id);
  const price = l?.price != null ? Number(l.price) : null;
  const sales = estimateSales({ price, monthlyBuyersText: badge.get(p.id)?.text ?? null, monthlyBuyersOn: badge.get(p.id)?.on ?? null, reviewSample: sample.get(p.id) ?? null, reviewHistory: [...(hist.get(p.id) ?? new Map()).entries()].map(([on, count]) => ({ on, count })) });
  const stage = productStage({ watchStatus: watchOf.get(p.id) ?? null, blockedByUser: blocked.has(p.id), linkStatuses: linksOf.get(p.id) ?? [] });
  if (price == null) {
    excluded.noPrice += 1;
    continue;
  }
  if (!sales.monthly) {
    excluded.noSales += 1;
    continue;
  }
  if (["REJECTED", "BLOCKED", "STOPPED"].includes(stage.stage)) {
    excluded.rejected += 1;
    continue;
  }
  const rp = recentPick.get(p.id);
  if (rp && rp.pick_date !== today) {
    excluded.recentlyPicked += 1;
    continue;
  }
  const g = guessCategory(p.product_name, catOf.get(p.id) ?? null);
  const econ = unitEconomics({ today, price, cards, salesScope: g.salesScope, feeGroup: g.feeGroup });
  const bundleOk = econ?.bundles.some((b) => b.grade !== "AVOID") ?? false;
  if (econ?.grade === "AVOID" && !bundleOk) {
    excluded.lowPrice += 1;
    continue;
  }
  const q = toSourcingQuery(p.product_name);
  pool.push({
    productId: p.id,
    coupangProductId: p.coupang_product_id,
    name: p.product_name,
    keyword: kwOf.get(p.id) ?? null,
    category: catOf.get(p.id) ?? null,
    price,
    reviewCount: l?.review_count ?? null,
    rating: l?.rating != null ? Number(l.rating) : null,
    delivery: l?.delivery_type ?? null,
    registeredOn: p.created_at.slice(0, 10),
    stage: stage.stage,
    compliance: compOf.get(p.id) ?? null,
    sales: { monthly: sales.monthly, revenue: sales.revenue, methods: sales.methods.map((m) => m.detail), confidence: sales.confidence },
    economics: econ && { grade: econ.grade, allowedCost: econ.single.allowedPerUnit, afterPromo: econ.afterPromo?.allowedPerUnit ?? null, bestBundle: econ.bestBundle && { units: econ.bestBundle.units, price: econ.bestBundle.price, allowedPerUnit: econ.bestBundle.allowedPerUnit, grade: econ.bestBundle.grade } },
    sourcingQuery: { zh: q.zh, en: q.en },
    url: `https://www.coupang.com/vp/products/${p.coupang_product_id}`,
  });
}
const gradeRank = { OK: 0, CAUTION: 1, AVOID: 2 };
pool.sort((a, b) => (gradeRank[a.economics?.grade] ?? 3) - (gradeRank[b.economics?.grade] ?? 3) || (b.sales.revenue?.mid ?? 0) - (a.sales.revenue?.mid ?? 0));

const out = {
  generatedAt: new Date().toISOString(),
  today,
  products: prods.length,
  // 오늘 이미 저장된 추천 — 예약 작업이 PC 를 늦게 켠 날 · 두 번 실행된 날 중복으로 고르지 않도록 (CLAUDE_SCHEDULED 가 있으면 건너뜀)
  todayPicks: picks.filter((p) => p.pick_date === today).map((p) => ({ rank: p.rank, title: p.title, pickedBy: p.picked_by })),
  freshness: { lastSearchCollect, lastProductCollect, trackedKeywords: kws.filter((k) => k.is_tracking).map((k) => k.keyword), newProductsToday: prods.filter((p) => p.created_at.slice(0, 10) === today).length },
  excluded,
  rules: "판매량 추정 있음 · 판매가 있음 · 검토 제외/판매 불가 아님 · 최근 14일 추천 안 함 · 단품 비추천이면 묶음으로 가능한 것만. 정렬: 가격 구조 등급 → 추정 월 매출",
  pool: pool.slice(0, 25),
};
const oi = argv.indexOf("--out");
if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
