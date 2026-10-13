import "server-only";

import type { CollectedSupplyOffer, PriceTier, SupplySite } from "@/lib/collectors/supplier/page";
import { getFxRate } from "@/lib/sourcing/fx";
import { PROFIT_FORMULA_VERSION } from "@/lib/profit/calculate";
import { costRecord } from "@/lib/sourcing/cost-record";
import { calculateLandedCost, pickUnitPrice, type LandedCostResult } from "@/lib/sourcing/landed-cost";
import { matchSupply, type MatchLevel, type MatchResult } from "@/lib/sourcing/matching";
import { toSourcingQuery, type SourcingQuery } from "@/lib/sourcing/translate";
import { createClient } from "@/lib/supabase/server";
import type { Json, TablesInsert } from "@/types/database";

/*
 * 중국 도매 소싱 저장 · 조회 (PHASE 18). 모두 사용자 클라이언트(RLS) — service role 없음.
 *
 *   saveOffer        공급 후보 1행 (사이트 · 상품 ID 기준 갱신) + 오늘 가격 이력 1행 (같은 날은 갱신)
 *   linkOffer        쿠팡 상품 ↔ 공급 후보 연결 · 매칭 판정 · 도착 원가 계산 결과 저장 (사용자 선택 상태는 유지)
 *   refreshLinks     소싱 대상 상품의 연결만 매칭 · 원가 재계산 (환율 · 판매가 변화 반영). 대상 밖 상품의 기존 연결 · 이력은 그대로 둔다
 *   ensureQueries    소싱 대상 상품만 도매 검색어 (사전 버전이 바뀌거나 상품명이 바뀌면 갱신, 사용자가 직접 고친 검색어는 유지)
 *   autoLinkOffer    대상 상품 없이 저장된 후보 → 소싱 대상 상품과만 비교해 자동 연결 제안 (PHASE 21: 전체 상품 → 소싱 대상)
 * 소싱 대상 = 사용자가 [소싱 시작]한 상품 (repositories/stage · lib/discover/stage)
 */

const kstDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));

export async function saveOffer(o: CollectedSupplyOffer, capturedAt: string): Promise<{ id: string; created: boolean }> {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("supply_offers").select("id").eq("site", o.site).eq("site_product_id", o.siteProductId).maybeSingle();
  const row = {
    site: o.site,
    site_product_id: o.siteProductId,
    url: o.url,
    title: o.title || "(상품명 없음)",
    image_urls: o.imageUrls,
    category_path: o.categoryPath,
    base_price: o.basePrice?.amount ?? null,
    base_currency: o.basePrice?.currency ?? null,
    tiers: o.tiers as unknown as Json,
    tiers_converted: o.tiersConverted,
    moq: o.moq,
    supplier_name: o.supplierName,
    supplier_url: o.supplierUrl,
    supplier_meta: o.supplierMeta as unknown as Json,
    attributes: o.attributes as unknown as Json,
    material: o.material,
    size_text: o.sizeText,
    colors: o.colors,
    brand: o.brand,
    model: o.model,
    weight_kg: o.weightKg,
    package_size_text: o.packageSizeText,
    shipping: o.shipping as unknown as Json,
    issues: o.issues,
    source_type: "EXTENSION",
    confidence: "A",
    last_captured_at: capturedAt,
  };
  let id: string;
  if (existing) {
    const { error } = await supabase.from("supply_offers").update(row).eq("id", existing.id);
    if (error) throw error;
    id = existing.id;
  } else {
    const { data, error } = await supabase.from("supply_offers").insert(row).select("id").single();
    if (error) throw error;
    id = data.id;
  }
  const { error: snapErr } = await supabase.from("supply_offer_snapshots").upsert(
    { offer_id: id, captured_on: kstDate(capturedAt), captured_at: capturedAt, base_price: row.base_price, base_currency: row.base_currency, tiers: row.tiers, moq: row.moq, shipping: row.shipping },
    { onConflict: "owner_id,offer_id,captured_on" },
  );
  if (snapErr) throw snapErr;
  return { id, created: !existing };
}

export interface OfferRow {
  id: string;
  site: SupplySite;
  url: string;
  title: string;
  imageUrls: string[];
  categoryPath: string | null;
  basePrice: { amount: number; currency: string } | null;
  tiers: PriceTier[];
  tiersConverted: boolean;
  moq: number | null;
  supplierName: string | null;
  supplierMeta: { years: number | null; rating: number | null; location: string | null };
  attributes: Record<string, string>;
  material: string | null;
  sizeText: string | null;
  weightKg: number | null;
  shipping: CollectedSupplyOffer["shipping"];
  lastCapturedAt: string;
}

export type OfferDb = {
  id: string;
  site: string;
  url: string;
  title: string;
  image_urls: string[];
  category_path: string | null;
  base_price: number | null;
  base_currency: string | null;
  tiers: Json;
  tiers_converted: boolean;
  moq: number | null;
  supplier_name: string | null;
  supplier_meta: Json;
  attributes: Json;
  material: string | null;
  size_text: string | null;
  weight_kg: number | null;
  shipping: Json | null;
  last_captured_at: string;
};
export const toOffer = (r: OfferDb): OfferRow => ({
  id: r.id,
  site: r.site as SupplySite,
  url: r.url,
  title: r.title,
  imageUrls: r.image_urls,
  categoryPath: r.category_path,
  basePrice: r.base_price != null && r.base_currency ? { amount: Number(r.base_price), currency: r.base_currency } : null,
  tiers: (r.tiers as unknown as PriceTier[]) ?? [],
  tiersConverted: r.tiers_converted,
  moq: r.moq,
  supplierName: r.supplier_name,
  supplierMeta: r.supplier_meta as unknown as OfferRow["supplierMeta"],
  attributes: (r.attributes as unknown as Record<string, string>) ?? {},
  material: r.material,
  sizeText: r.size_text,
  weightKg: r.weight_kg != null ? Number(r.weight_kg) : null,
  shipping: r.shipping as unknown as CollectedSupplyOffer["shipping"],
  lastCapturedAt: r.last_captured_at,
});

export interface ProductCtx {
  id: string;
  name: string;
  categoryPath: string | null;
  salePrice: number | null;
  feeRate: number | null;
}

/** 상품 문맥: 이름 · 상품 페이지 카테고리 · 현재 판매가 · 카테고리 수수료율(설정돼 있을 때만) */
export async function productContexts(ids?: string[]): Promise<Map<string, ProductCtx>> {
  const supabase = await createClient();
  let pq = supabase.from("products").select("id, coupang_product_id, product_name, category_id");
  // 100개 이하만 주소에 넣는다 (그보다 많으면 전체를 읽고 아래에서 거름 — 요청 주소 16KB 한도)
  if (ids && ids.length <= 100) pq = pq.in("id", ids);
  const [{ data: prods, error }, { data: latest }, { data: cats }, { data: catRows }] = await Promise.all([
    pq,
    supabase.from("v_product_latest").select("product_id, price"),
    supabase.from("categories").select("id, coupang_fee_rate"),
    supabase
      .from("import_rows")
      .select("record_key, created_at, category:payload->collected->observedOnly->>category")
      .like("record_key", "product\\_snapshot:%")
      .not("payload->collected->observedOnly->>category", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (error) throw error;
  const priceOf = new Map((latest ?? []).map((l) => [l.product_id, l.price]));
  const feeOf = new Map((cats ?? []).map((c) => [c.id, c.coupang_fee_rate]));
  const catOf = new Map<string, string>();
  for (const c of catRows ?? []) {
    const cid = c.record_key?.split(":")[1];
    if (cid && typeof c.category === "string" && !catOf.has(cid)) catOf.set(cid, c.category);
  }
  const wanted = ids ? new Set(ids) : null;
  return new Map(
    prods.filter((p) => !wanted || wanted.has(p.id)).map((p) => [
      p.id,
      {
        id: p.id,
        name: p.product_name,
        categoryPath: catOf.get(p.coupang_product_id) ?? null,
        salePrice: priceOf.get(p.id) != null ? Number(priceOf.get(p.id)) : null,
        feeRate: p.category_id && feeOf.get(p.category_id) != null ? Number(feeOf.get(p.category_id)) : null,
      },
    ]),
  );
}

async function evaluate(product: ProductCtx, offer: OfferRow): Promise<{ match: MatchResult; landed: LandedCostResult | null; unit: ReturnType<typeof pickUnitPrice>; orderQty: number }> {
  const match = matchSupply({ product: { name: product.name, categoryPath: product.categoryPath }, offer: { title: offer.title, categoryPath: offer.categoryPath, material: offer.material, sizeText: offer.sizeText, attributes: offer.attributes, moq: offer.moq } });
  const orderQty = offer.moq ?? 1;
  const unit = pickUnitPrice(offer, orderQty);
  if (!unit) return { match, landed: null, unit: null, orderQty };
  const fx = unit.currency === "KRW" ? null : await getFxRate(unit.currency);
  const s = offer.shipping;
  const shippingKrw = s && s.currency === "KRW" && s.perQty && s.amount ? { perQty: s.perQty, amountKrw: s.amount, text: s.text } : null;
  const landed = calculateLandedCost({ unitPrice: unit, unitsPerListing: match.unitsPerListing, fx, shipping: shippingKrw, orderQty, salePrice: product.salePrice, feeRate: product.feeRate });
  return { match, landed, unit, orderQty };
}

/** 연결 (같은 상품 · 후보면 판정 · 원가만 갱신하고 사용자 선택 상태는 그대로) */
export async function linkOffer(productId: string, offerId: string, origin: "TARGET" | "AUTO" | "USER"): Promise<{ level: MatchLevel; landed: LandedCostResult | null; snapshot: "CREATED" | "UNCHANGED" | "NOT_SELECTED" | "NOT_COMPUTABLE" }> {
  const supabase = await createClient();
  const [ctx, { data: o, error }] = await Promise.all([productContexts([productId]), supabase.from("supply_offers").select("*").eq("id", offerId).single()]);
  if (error) throw error;
  const product = ctx.get(productId);
  if (!product) throw new Error("상품을 찾을 수 없습니다.");
  const { match, landed, unit, orderQty } = await evaluate(product, toOffer(o));
  const { data: cur } = await supabase.from("product_supply_links").select("id, origin, user_status").eq("product_id", productId).eq("offer_id", offerId).maybeSingle();
  const patch = { match_level: match.level, match: match as unknown as Json, landed: landed as unknown as Json, landed_at: new Date().toISOString() };
  let linkId: string;
  if (cur) {
    // 경로는 더 확실한 쪽을 남긴다 (TARGET · USER 가 AUTO 보다 우선). 사용자 선택 상태(user_status)는 건드리지 않는다
    const keepOrigin = cur.origin === "AUTO" ? origin : cur.origin;
    const { error: e } = await supabase.from("product_supply_links").update({ ...patch, origin: keepOrigin }).eq("id", cur.id);
    if (e) throw e;
    linkId = cur.id;
  } else {
    const { data: ins, error: e } = await supabase.from("product_supply_links").insert({ product_id: productId, offer_id: offerId, origin, ...patch }).select("id").single();
    if (e) throw e;
    linkId = ins.id;
  }

  // 사용자가 [선택]한 후보만 계산 이력을 쌓는다 (같은 입력이면 그대로 — 과거 이력은 수정 금지 트리거로 보호)
  if (cur?.user_status !== "SELECTED") return { level: match.level, landed, snapshot: "NOT_SELECTED" };
  if (!landed || !unit) return { level: match.level, landed, snapshot: "NOT_COMPUTABLE" };
  const rec = costRecord({ productId, offerId, linkId, matchLevel: match.level, salePrice: product.salePrice, feeRate: product.feeRate, orderQty, unitsPerListing: match.unitsPerListing, unitPrice: unit, landed, profitFormulaVersion: PROFIT_FORMULA_VERSION });
  const { data: inserted, error: se } = await supabase
    .from("supply_cost_snapshots")
    .upsert(rec as unknown as TablesInsert<"supply_cost_snapshots">, { onConflict: "owner_id,link_id,input_hash", ignoreDuplicates: true })
    .select("id");
  if (se) throw se;
  return { level: match.level, landed, snapshot: inserted && inserted.length > 0 ? "CREATED" : "UNCHANGED" };
}

/** 대상 상품 없이 저장된 후보 → 소싱 대상 상품과만 비교해 유사 이상만 자동 연결 제안 (최대 5개). 소싱 대상이 없으면 연결하지 않는다 */
export async function autoLinkOffer(offerId: string, scope: string[]): Promise<{ linked: number; checked: number }> {
  if (scope.length === 0) return { linked: 0, checked: 0 };
  const supabase = await createClient();
  const [ctx, { data: o, error }] = await Promise.all([productContexts(scope), supabase.from("supply_offers").select("*").eq("id", offerId).single()]);
  if (error) throw error;
  const offer = toOffer(o);
  const hits = [...ctx.values()]
    .map((p) => ({ p, m: matchSupply({ product: { name: p.name, categoryPath: p.categoryPath }, offer: { title: offer.title, categoryPath: offer.categoryPath, material: offer.material, sizeText: offer.sizeText, attributes: offer.attributes, moq: offer.moq } }) }))
    .filter((x) => x.m.level !== "UNCLEAR")
    .slice(0, 5);
  for (const h of hits) await linkOffer(h.p.id, offerId, "AUTO");
  return { linked: hits.length, checked: ctx.size };
}

export async function refreshLinks(scope: string[]): Promise<{ refreshed: number; skipped: number; failed: number; snapshotsCreated: number; snapshotsUnchanged: number }> {
  const supabase = await createClient();
  const { data: all, error } = await supabase.from("product_supply_links").select("product_id, offer_id, origin");
  if (error) throw error;
  const inScope = new Set(scope);
  const links = all.filter((l) => inScope.has(l.product_id));
  const skipped = all.length - links.length;
  let refreshed = 0;
  let failed = 0;
  let snapshotsCreated = 0;
  let snapshotsUnchanged = 0;
  for (const l of links) {
    try {
      const r = await linkOffer(l.product_id, l.offer_id, l.origin as "TARGET" | "AUTO" | "USER");
      refreshed += 1;
      if (r.snapshot === "CREATED") snapshotsCreated += 1;
      if (r.snapshot === "UNCHANGED") snapshotsUnchanged += 1;
    } catch {
      failed += 1;
    }
  }
  return { refreshed, skipped, failed, snapshotsCreated, snapshotsUnchanged };
}

export async function ensureQueries(scope: string[]): Promise<{ created: number; updated: number; kept: number }> {
  if (scope.length === 0) return { created: 0, updated: 0, kept: 0 };
  const supabase = await createClient();
  const [{ data: prods, error }, { data: cur }] = await Promise.all([supabase.from("products").select("id, product_name").in("id", scope), supabase.from("sourcing_queries").select("product_id, original, method, dict_version").in("product_id", scope)]);
  if (error) throw error;
  const byProduct = new Map((cur ?? []).map((q) => [q.product_id, q]));
  let created = 0;
  let updated = 0;
  let kept = 0;
  const rows = [];
  for (const p of prods) {
    const q = byProduct.get(p.id);
    if (q && (q.method === "MANUAL" || (q.original === p.product_name && q.dict_version === toSourcingQuery("").dictVersion))) {
      kept += 1;
      continue;
    }
    const s: SourcingQuery = toSourcingQuery(p.product_name);
    rows.push({ product_id: p.id, original: s.original, query_zh: s.zh || null, query_en: s.en || null, query_ko: s.koCore || null, mapped: s.mapped as unknown as Json, unmapped: s.unmapped, pack_qty: s.packQty, cavities: s.cavities, method: "DICTIONARY", dict_version: s.dictVersion });
    if (q) updated += 1;
    else created += 1;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await supabase.from("sourcing_queries").upsert(rows.slice(i, i + 500), { onConflict: "owner_id,product_id" });
    if (e) throw e;
  }
  return { created, updated, kept };
}

export interface SupplyLinkView {
  linkId: string;
  origin: "TARGET" | "AUTO" | "USER";
  matchLevel: MatchLevel;
  match: MatchResult;
  userStatus: "CANDIDATE" | "SELECTED" | "REJECTED";
  landed: LandedCostResult | null;
  landedAt: string | null;
  offer: OfferRow;
  history: { capturedOn: string; basePrice: number | null; baseCurrency: string | null; firstTier: PriceTier | null }[];
  /** 선택한 후보의 원가 계산 이력 (최신 순, 수정되지 않음) */
  costHistory: CostSnapshotView[];
}

export interface CostSnapshotView {
  id: string;
  computedAt: string;
  landedMin: number | null;
  landedMax: number | null;
  salePrice: number | null;
  feeSource: string;
  fx: { currency: string; krw: number; rateDate: string } | null;
  unitPrice: { amount: number; currency: string; basis: string } | null;
  confirmedOnly: { cost: number | null; profit: { complete: boolean; netProfitPerUnit: number | null; netMarginRate: number | null } | null };
  estimated: { low: { netProfitPerUnit: number | null; netMarginRate: number | null } | null; high: { netProfitPerUnit: number | null; netMarginRate: number | null } | null } | null;
  insufficient: string[];
  confidence: string;
  matchLevel: string;
  engine: Record<string, string>;
}

export interface QueryView {
  original: string;
  zh: string | null;
  en: string | null;
  ko: string | null;
  unmapped: string[];
  packQty: number | null;
  method: string;
  dictVersion: string | null;
}

export async function listSourcing(productIds: string[]): Promise<{ queries: Map<string, QueryView>; links: Map<string, SupplyLinkView[]> }> {
  const supabase = await createClient();
  if (productIds.length === 0) return { queries: new Map(), links: new Map() };
  const [{ data: qs }, { data: ls }] = await Promise.all([
    supabase.from("sourcing_queries").select("*").in("product_id", productIds),
    supabase.from("product_supply_links").select("*, supply_offers!product_supply_links_offer_fk(*)").in("product_id", productIds).order("created_at"),
  ]);
  const offerIds = [...new Set((ls ?? []).map((l) => l.offer_id))];
  const { data: costs } = await supabase
    .from("supply_cost_snapshots")
    .select("id, link_id, computed_at, landed_min, landed_max, sale_price, fee_source, fx, unit_price, confirmed_only, estimated, insufficient, confidence, match_level, engine")
    .in("product_id", productIds)
    .order("computed_at", { ascending: false })
    .limit(500);
  const { data: snaps } = offerIds.length
    ? await supabase.from("supply_offer_snapshots").select("offer_id, captured_on, base_price, base_currency, tiers").in("offer_id", offerIds).order("captured_on", { ascending: false }).limit(1000)
    : { data: [] };
  const queries = new Map<string, QueryView>(
    (qs ?? []).map((q) => [q.product_id, { original: q.original, zh: q.query_zh, en: q.query_en, ko: q.query_ko, unmapped: q.unmapped, packQty: q.pack_qty, method: q.method, dictVersion: q.dict_version }]),
  );
  const links = new Map<string, SupplyLinkView[]>();
  for (const l of ls ?? []) {
    const o = l.supply_offers as unknown as OfferDb | null;
    if (!o) continue;
    const view: SupplyLinkView = {
      linkId: l.id,
      origin: l.origin as SupplyLinkView["origin"],
      matchLevel: l.match_level as MatchLevel,
      match: l.match as unknown as MatchResult,
      userStatus: l.user_status as SupplyLinkView["userStatus"],
      landed: l.landed as unknown as LandedCostResult | null,
      landedAt: l.landed_at,
      offer: toOffer(o),
      history: (snaps ?? [])
        .filter((s) => s.offer_id === l.offer_id)
        .map((s) => ({ capturedOn: s.captured_on, basePrice: s.base_price != null ? Number(s.base_price) : null, baseCurrency: s.base_currency, firstTier: ((s.tiers as unknown as PriceTier[]) ?? [])[0] ?? null })),
      costHistory: (costs ?? [])
        .filter((c) => c.link_id === l.id)
        .map((c) => ({
          id: c.id,
          computedAt: c.computed_at,
          landedMin: c.landed_min,
          landedMax: c.landed_max,
          salePrice: c.sale_price,
          feeSource: c.fee_source,
          fx: c.fx as unknown as CostSnapshotView["fx"],
          unitPrice: c.unit_price as unknown as CostSnapshotView["unitPrice"],
          confirmedOnly: c.confirmed_only as unknown as CostSnapshotView["confirmedOnly"],
          estimated: c.estimated as unknown as CostSnapshotView["estimated"],
          insufficient: c.insufficient,
          confidence: c.confidence,
          matchLevel: c.match_level,
          engine: c.engine as unknown as Record<string, string>,
        })),
    };
    links.set(l.product_id, [...(links.get(l.product_id) ?? []), view]);
  }
  return { queries, links };
}
