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
const { marketStructure, describeMarket } = await import("../../src/lib/market/structure.ts");
const { interpolate, RULES } = await import("../../src/lib/scoring/engine.ts");
const { judge } = await import("../../src/lib/judge/engine.ts");
const { effectiveCompliance } = await import("../../src/lib/automation/compliance.ts");

const argv = process.argv.slice(2);
const db = adminClient();
const owner = await resolveOwner(db, argv);
const today = kstToday();
const all = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};
// PHASE 29: API 는 한 번에 1,000행까지만 준다 (service role 도 같음) → 큰 표는 1,000행씩 끝까지 읽는다.
// make() 는 매번 새 쿼리를 만들고, 순서가 바뀌지 않는 정렬(id 등)을 붙인다.
const allPaged = async (make) => {
  const out = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
};

const [prods, latest, snaps, rows, cardRows, watch, comp, links, picks, ranks, kws, kwLatest, kwHist] = await Promise.all([
  allPaged(() => db.from("products").select("id, coupang_product_id, product_name, brand, created_at").eq("owner_id", owner).order("id")),
  allPaged(() => db.from("v_product_latest").select("product_id, price, review_count, rating, delivery_type, seller_type_observed, snapshot_count").eq("owner_id", owner).order("product_id")),
  allPaged(() => db.from("product_snapshots").select("product_id, captured_on, review_count, is_excluded").eq("owner_id", owner).not("review_count", "is", null).order("id")),
  allPaged(() =>
    db
      .from("import_rows")
      .select("record_key, created_at, mb:payload->collected->observedOnly->>monthlyBuyers, rd:payload->collected->observedOnly->>reviewDates, cat:payload->collected->observedOnly->>category")
      .eq("owner_id", owner)
      .like("record_key", "product\\_snapshot:%")
      .order("created_at", { ascending: false })
      .order("id"),
  ),
  all(db.from("cost_rate_cards").select("*").or(`owner_id.is.null,owner_id.eq.${owner}`)),
  all(db.from("watchlist").select("product_id, status").eq("owner_id", owner)),
  allPaged(() => db.from("product_compliance").select("product_id, status, decided_by, rule_version").eq("owner_id", owner).order("product_id")),
  all(db.from("product_supply_links").select("product_id, user_status").eq("owner_id", owner)),
  all(db.from("daily_picks").select("product_id, pick_date, status, picked_by, rank, title").eq("owner_id", owner).gte("pick_date", new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))),
  allPaged(() => db.from("keyword_product_ranks").select("product_id, keyword_id, captured_on, rank_position, is_ad").eq("owner_id", owner).order("captured_on", { ascending: false }).order("id")),
  all(db.from("keywords").select("id, keyword, is_tracking").eq("owner_id", owner)),
  all(db.from("v_keyword_latest").select("keyword_id, search_volume, search_growth_rate, search_volume_source, search_volume_confidence, search_volume_captured_on").eq("owner_id", owner)),
  // PHASE 28: 검색량 기록 (급증 판단)
  allPaged(() => db.from("keyword_snapshots").select("keyword_id, captured_on, search_volume, is_excluded").eq("owner_id", owner).not("search_volume", "is", null).order("id")),
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
const storedComp = new Map(comp.map((c) => [c.product_id, { status: c.status, decidedBy: c.decided_by, ruleVersion: c.rule_version }]));
// PHASE 28: 자동 판단은 지금 규칙(compliance-rules-v2)으로 다시 본다 — 다음 자동 발굴 전에도 판정에 반영
const effComp = new Map(prods.map((p) => [p.id, effectiveCompliance(storedComp.get(p.id) ?? null, { productName: p.product_name ?? "", brand: p.brand ?? null, category: catOf.get(p.id) ?? null }, new Date().toISOString())]));
const compOf = new Map([...effComp].map(([id, e]) => [id, e.status]));
const linksOf = new Map();
for (const l of links) linksOf.set(l.product_id, [...(linksOf.get(l.product_id) ?? []), l.user_status]);
const recentPick = new Map(picks.map((p) => [p.product_id, p]));
const kwName = new Map(kws.map((k) => [k.id, k.keyword]));
const kwOf = new Map();
const kwIdOf = new Map();
let lastSearchCollect = null;
for (const r of ranks) {
  if (!lastSearchCollect || r.captured_on > lastSearchCollect) lastSearchCollect = r.captured_on;
  if (!kwOf.has(r.product_id)) {
    kwOf.set(r.product_id, kwName.get(r.keyword_id) ?? null);
    kwIdOf.set(r.product_id, r.keyword_id);
  }
}

// PHASE 25 시장 구조: 키워드마다 가장 최근 수집일의 칸 → market-structure-v1 (자연 상위 10개 · 직매입/제3자 · 광고 칸)
const lastDayOf = new Map();
for (const r of ranks) if (!lastDayOf.has(r.keyword_id) || r.captured_on > lastDayOf.get(r.keyword_id)) lastDayOf.set(r.keyword_id, r.captured_on);
const cellsOf = new Map();
for (const r of ranks) {
  if (r.captured_on !== lastDayOf.get(r.keyword_id)) continue;
  const cells = cellsOf.get(r.keyword_id) ?? new Map();
  const key = `${r.product_id}:${r.is_ad}`;
  const prev = cells.get(key);
  if (!prev || r.rank_position < prev.rank_position) cells.set(key, r);
  cellsOf.set(r.keyword_id, cells);
}
const volOf = new Map(kwLatest.map((k) => [k.keyword_id, k]));
const histOf = new Map();
for (const h of kwHist) {
  if (h.is_excluded) continue;
  const list = histOf.get(h.keyword_id) ?? [];
  list.push({ on: h.captured_on, value: Number(h.search_volume) });
  histOf.set(h.keyword_id, list);
}
const marketOf = new Map();
for (const [kid, cells] of cellsOf) {
  const items = [...cells.values()].map((r) => {
    const l = priceOf.get(r.product_id);
    return {
      rankPosition: r.rank_position,
      isAd: r.is_ad,
      price: l?.price != null ? Number(l.price) : null,
      reviewCount: l?.review_count != null ? Number(l.review_count) : null,
      sellerType: l?.seller_type_observed ?? null,
      deliveryType: l?.delivery_type ?? null,
      observed: (l?.snapshot_count ?? 0) > 0,
    };
  });
  marketOf.set(kid, marketStructure(lastDayOf.get(kid), items));
}
/** 진입 점수 0~100 (임시 — 판정 엔진 V2 전까지): 리뷰 장벽 · 제3자 판매자 비율 · 직매입 비율 중 있는 것의 평균 (엔진 v1.1 과 같은 구간) */
function entryScore(m) {
  if (!m) return null;
  const parts = [];
  if (m.medianReviews != null) parts.push(interpolate(m.medianReviews, RULES.reviewCount));
  if (m.thirdPartyRatio != null) parts.push(interpolate(m.thirdPartyRatio, RULES.wingRatio));
  if (m.retailRatio != null) parts.push(interpolate(m.retailRatio, RULES.retailRatio));
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 : null;
}

// PHASE 28: 같은 키워드 상품의 판매 추정 최소값 (과대 추정 판단)
const salesOf = new Map();
const salesFor = (p) => {
  if (!salesOf.has(p.id)) {
    const l = priceOf.get(p.id);
    const price = l?.price != null ? Number(l.price) : null;
    salesOf.set(p.id, estimateSales({ price, monthlyBuyersText: badge.get(p.id)?.text ?? null, monthlyBuyersOn: badge.get(p.id)?.on ?? null, reviewSample: sample.get(p.id) ?? null, reviewHistory: [...(hist.get(p.id) ?? new Map()).entries()].map(([on, count]) => ({ on, count })) }));
  }
  return salesOf.get(p.id);
};
const peersOf = new Map();
for (const p of prods) {
  const kid = kwIdOf.get(p.id);
  const min = salesFor(p).monthly?.min;
  if (kid && min != null) peersOf.set(kid, [...(peersOf.get(kid) ?? []), min]);
}

const pool = [];
const excluded = { noSales: 0, lowPrice: 0, rejected: 0, recentlyPicked: 0, noPrice: 0 };
for (const p of prods) {
  const l = priceOf.get(p.id);
  const price = l?.price != null ? Number(l.price) : null;
  const sales = salesFor(p);
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
  const market = kwIdOf.has(p.id) ? marketOf.get(kwIdOf.get(p.id)) ?? null : null;
  // PHASE 26 판정 V2 (judge-v2): 시장 50% + 상품 50%, "확실한 수익" 관문. 공급 원가는 후보 단계에서 모름 → 강력추천은 나오지 않는다
  const kl = kwIdOf.has(p.id) ? volOf.get(kwIdOf.get(p.id)) : null;
  const point = (v, on) => (v == null ? null : { value: Number(v), source: kl?.search_volume_source ?? "OFFICIAL_API", confidence: kl?.search_volume_confidence ?? "A", collectedAt: on ?? undefined });
  const j = judge({
    asOf: today,
    keyword: kwOf.get(p.id) ?? null,
    searchVolume: point(kl?.search_volume, kl?.search_volume_captured_on),
    searchGrowthRate: point(kl?.search_growth_rate, kl?.search_volume_captured_on),
    market,
    price,
    sales,
    economics: econ,
    supplyMargin: null,
    conversionRate: null,
    compliance: compOf.get(p.id) ?? null,
    certifications: effComp.get(p.id)?.certifications ?? [],
    productName: p.product_name,
    searchVolumeHistory: kwIdOf.has(p.id) ? histOf.get(kwIdOf.get(p.id)) ?? null : null,
    peerSalesMin: kwIdOf.has(p.id) ? peersOf.get(kwIdOf.get(p.id)) ?? null : null,
  });
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
    judge: { version: j.version, verdict: j.verdict, total: j.total, marketScore: j.marketScore, productScore: j.productScore, confidence: j.confidence, gates: j.gates, risks: j.risks.map((x) => x.message), missing: j.missing, parts: j.parts.map((x) => `${x.label} ${x.score ?? "-"} — ${x.basis}`) },
    market: market && { capturedOn: market.capturedOn, summary: describeMarket(market), entryScore: entryScore(market), medianReviews: market.medianReviews, lowReviewCount: market.lowReviewCount, retailRatio: market.retailRatio, thirdPartyRatio: market.thirdPartyRatio, adRatio: market.adRatio, risks: market.risks.map((r) => r.message) },
    sourcingQuery: { zh: q.zh, en: q.en },
    url: `https://www.coupang.com/vp/products/${p.coupang_product_id}`,
  });
}
const gradeRank = { OK: 0, CAUTION: 1, AVOID: 2 };
// PHASE 25: 추정 매출(인기) 순 → 진입 가능성 순. 매출이 큰 상품일수록 경쟁이 센 경우가 많아 매출은 마지막 동점 정리에만 쓴다 (보수적인 최소값).
// PHASE 26: 판정 V2 순 (판정 → 총점 → 판매 최소값). 판정이 없는 후보(데이터 부족)는 뒤로.
const verdictRank = { STRONG_BUY: 0, REVIEW: 1, EXCLUDE: 3 };
pool.sort(
  (a, b) =>
    (verdictRank[a.judge.verdict] ?? 2) - (verdictRank[b.judge.verdict] ?? 2) ||
    (b.judge.total ?? -1) - (a.judge.total ?? -1) ||
    (gradeRank[a.economics?.grade] ?? 3) - (gradeRank[b.economics?.grade] ?? 3) ||
    (b.market?.entryScore ?? -1) - (a.market?.entryScore ?? -1) ||
    (b.sales.monthly?.min ?? 0) - (a.sales.monthly?.min ?? 0),
);

const out = {
  generatedAt: new Date().toISOString(),
  today,
  products: prods.length,
  // 오늘 이미 저장된 추천 — 예약 작업이 PC 를 늦게 켠 날 · 두 번 실행된 날 중복으로 고르지 않도록 (CLAUDE_SCHEDULED 가 있으면 건너뜀)
  todayPicks: picks.filter((p) => p.pick_date === today).map((p) => ({ rank: p.rank, title: p.title, pickedBy: p.picked_by })),
  freshness: { lastSearchCollect, lastProductCollect, trackedKeywords: kws.filter((k) => k.is_tracking).map((k) => k.keyword), newProductsToday: prods.filter((p) => p.created_at.slice(0, 10) === today).length },
  excluded,
  rules: "판매량 추정 있음 · 판매가 있음 · 검토 제외/판매 불가 아님 · 최근 14일 추천 안 함 · 단품 비추천이면 묶음으로 가능한 것만. 정렬(PHASE 26): 판정 V2(judge-v2.1: 시장 50% + 상품 50%, 확실한 수익 관문 · 시즌 · 인증 · 판매 과대 추정) → 총점 → 가격 구조 등급 → 진입 점수 → 추정 월 판매 최소값",
  // 예약 작업(Claude)이 3개를 고를 때 따르는 기준 — 정렬을 그대로 믿지 말고 market 을 읽고 판단한다
  guide: [
    "judge.verdict 가 EXCLUDE 인 후보는 고르지 않는다. judge.verdict 가 없으면(데이터 부족) judge.missing 을 위험에 적고, REVIEW 후보가 3개 미만일 때만 고른다.",
    "후보 단계에서는 공급 원가를 모르므로 강력추천(STRONG_BUY)이 나오지 않는다. 근거에 판정 · 총점 · 신뢰도를 그대로 적는다.",
    "추정 매출이 크다는 이유만으로 고르지 않는다. 잘 팔리는 상품은 대부분 경쟁이 가장 센 상품이다.",
    "market.entryScore 가 높은(리뷰 장벽 낮음 · 제3자 판매자 많음 · 직매입 적음) 후보를 우선한다. market 이 없으면 근거에 '시장 구조 미확인'을 적는다.",
    "market.risks(직매입 지배 · 광고 과다 · 리뷰 장벽)가 있으면 위험에 그대로 적고, 2개 이상이면 고르지 않는다.",
    "판매량 추정은 범위(min~max)로만 쓰고 가운데 값을 사실처럼 쓰지 않는다.",
    "judge.risks 에 시즌(SEASONAL) · 인증 · 판매 과대 추정이 있으면 근거에 그대로 적는다. 시즌 상품은 입고 예정일과 남은 시즌을 함께 적는다.",
  ],
  pool: pool.slice(0, 25),
};
const oi = argv.indexOf("--out");
if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
