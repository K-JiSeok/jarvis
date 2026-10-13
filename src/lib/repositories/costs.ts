import "server-only";

import { guessCategory, type CategoryGuess } from "@/lib/costs/category";
import { calculateCostDetail, COST_DETAIL_VERSION, type DetailInput, type DetailResult } from "@/lib/costs/detail";
import { parsePackageText } from "@/lib/costs/pack";
import type { RateCard, RateKind } from "@/lib/costs/rate-cards";
import { sanitizeItems, type SettingItems, type TaxType } from "@/lib/costs/settings";
import { productContexts, toOffer, type OfferDb, type ProductCtx } from "@/lib/repositories/sourcing";
import { fingerprint } from "@/lib/sourcing/cost-record";
import { getFxRate } from "@/lib/sourcing/fx";
import { pickUnitPrice } from "@/lib/sourcing/landed-cost";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables, TablesInsert } from "@/types/database";

/*
 * 상세 원가 · 수익성 (PHASE 20). 모두 사용자 클라이언트(RLS) — service role 없음.
 *
 *   listRateCards       시스템 요율(공식 페이지 수기 확인, 읽기 전용) + 내 요율
 *   getCostSettings     반복 비용 설정 · 과세 유형 (없으면 빈 설정 = 모두 미설정)
 *   loadDetail          상품 1개의 계산 입력을 모아 cost-detail-v1 으로 계산 (선택한 공급 후보 · 직접 입력 원가)
 *   recordDetail        계산 결과를 이력으로 (입력이 같으면 그대로 — 수정 금지 트리거로 과거 보존)
 */

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

const toCard = (r: Tables<"cost_rate_cards">): RateCard => ({
  id: r.id,
  ownerId: r.owner_id,
  kind: r.kind as RateKind,
  scope: r.scope,
  rates: r.rates as Record<string, unknown>,
  vatBasis: r.vat_basis as RateCard["vatBasis"],
  validFrom: r.valid_from,
  validTo: r.valid_to,
  promoUntil: r.promo_until,
  sourceUrl: r.source_url,
  sourceLabel: r.source_label,
  checkedOn: r.checked_on,
  verification: r.verification as RateCard["verification"],
  note: r.note,
});

export async function listRateCards(): Promise<RateCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_rate_cards").select("*").order("kind").order("scope").order("valid_from", { ascending: false });
  if (error) throw error;
  return data.map(toCard);
}

export async function addRateCard(card: Omit<TablesInsert<"cost_rate_cards">, "owner_id" | "verification">): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("cost_rate_cards").insert({ ...card, verification: "USER_ENTERED" });
  if (error) throw error;
}

/** 내가 넣은 요율만 지울 수 있다 (시스템 행은 RLS 가 막는다) */
export async function deleteRateCard(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_rate_cards").delete().eq("id", id).not("owner_id", "is", null).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface CostSettingsView {
  items: SettingItems;
  taxType: TaxType;
  updatedAt: string | null;
}

export async function getCostSettings(): Promise<CostSettingsView> {
  const supabase = await createClient();
  const { data } = await supabase.from("cost_settings").select("items, tax_type, updated_at").maybeSingle();
  return { items: sanitizeItems(data?.items), taxType: (data?.tax_type as TaxType) ?? "UNKNOWN", updatedAt: data?.updated_at ?? null };
}

export async function saveCostSettings(items: SettingItems, taxType: TaxType): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("cost_settings").upsert({ items: items as unknown as Json, tax_type: taxType }, { onConflict: "owner_id" });
  if (error) throw error;
}

export type CostInputRow = Tables<"product_cost_inputs">;

export async function getCostInput(productId: string): Promise<CostInputRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("product_cost_inputs").select("*").eq("product_id", productId).maybeSingle();
  return data;
}

export async function saveCostInput(productId: string, patch: Omit<TablesInsert<"product_cost_inputs">, "owner_id" | "product_id">): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("product_cost_inputs").upsert({ product_id: productId, ...patch }, { onConflict: "owner_id,product_id" });
  if (error) throw error;
}

export interface DetailView {
  productId: string;
  productName: string;
  coupangPath: string | null;
  guess: CategoryGuess;
  inputRow: CostInputRow | null;
  /** 계산에 쓴 공급 원가 (선택한 후보 또는 직접 입력) */
  supplyRef: { kind: "OFFER" | "MANUAL"; linkId: string | null; title: string; url: string | null; matchLevel: string | null } | null;
  selectedCount: number;
  input: DetailInput;
  result: DetailResult;
  hash: string;
}

type LinkRow = { id: string; product_id: string; match: Json; match_level: string; updated_at: string; supply_offers: unknown };

/** 상품들의 계산 입력을 한 번에 모아 계산 (요율 · 설정은 한 번만 읽는다) */
export async function loadDetails(productIds: string[]): Promise<Map<string, DetailView>> {
  const out = new Map<string, DetailView>();
  if (productIds.length === 0) return out;
  const supabase = await createClient();
  const [cards, settings, ctx, { data: inputs }, { data: links }] = await Promise.all([
    listRateCards(),
    getCostSettings(),
    productContexts(productIds),
    supabase.from("product_cost_inputs").select("*").in("product_id", productIds),
    supabase
      .from("product_supply_links")
      .select("id, product_id, match, match_level, updated_at, supply_offers!product_supply_links_offer_fk(*)")
      .in("product_id", productIds)
      .eq("user_status", "SELECTED")
      .order("updated_at", { ascending: false }),
  ]);
  const inputOf = new Map((inputs ?? []).map((r) => [r.product_id, r]));
  const linksOf = new Map<string, LinkRow[]>();
  for (const l of (links ?? []) as LinkRow[]) linksOf.set(l.product_id, [...(linksOf.get(l.product_id) ?? []), l]);
  const today = kstToday();
  const fxCache = new Map<string, Awaited<ReturnType<typeof getFxRate>>>();
  const fx = async (cur: string) => {
    if (!fxCache.has(cur)) fxCache.set(cur, await getFxRate(cur));
    return fxCache.get(cur)!;
  };

  for (const id of productIds) {
    const p: ProductCtx | undefined = ctx.get(id);
    if (!p) continue;
    const row = inputOf.get(id) ?? null;
    const selected = linksOf.get(id) ?? [];
    const guess = guessCategory(p.name, p.categoryPath);
    const link = selected[0] ?? null;
    const offerDb = link ? (link.supply_offers as (OfferDb & { package_size_text: string | null; url: string }) | null) : null;
    const offer = offerDb ? toOffer(offerDb) : null;
    const orderQty = row?.order_qty ?? offer?.moq ?? null;

    let supply: DetailInput["supply"] = null;
    let supplyRef: DetailView["supplyRef"] = null;
    if (row?.unit_cost_krw != null) {
      supply = { kind: "MANUAL", title: "직접 입력 원가", unitCostKrw: Number(row.unit_cost_krw), basis: (row.unit_cost_basis as "QUOTE" | "USER") ?? "USER" };
      supplyRef = { kind: "MANUAL", linkId: null, title: "직접 입력 원가", url: null, matchLevel: null };
    } else if (offer && link) {
      const unit = pickUnitPrice(offer, orderQty ?? offer.moq ?? 1);
      const rate = unit && unit.currency !== "KRW" ? await fx(unit.currency) : null;
      const s = offer.shipping;
      const match = link.match as { unitsPerListing?: number | null } | null;
      supply = {
        kind: "OFFER",
        title: offer.title,
        tiers: offer.tiers,
        tiersConverted: offer.tiersConverted,
        basePrice: offer.basePrice,
        moq: offer.moq,
        fx: rate,
        unitsPerListing: row?.units_per_listing != null ? Number(row.units_per_listing) : (match?.unitsPerListing ?? null),
        matchLevel: link.match_level,
        siteShipping: s && s.currency === "KRW" && s.perQty && s.amount ? { perQty: s.perQty, amountKrw: s.amount, text: s.text } : null,
      };
      supplyRef = { kind: "OFFER", linkId: link.id, title: offer.title, url: offer.url, matchLevel: link.match_level };
    }

    let pack: DetailInput["pack"] = null;
    if (row?.length_cm != null && row.width_cm != null && row.height_cm != null && row.weight_kg != null) {
      pack = { l: Number(row.length_cm), w: Number(row.width_cm), h: Number(row.height_cm), kg: Number(row.weight_kg), status: "MEASURED", basis: "판매 단위 포장 후 실측 (사용자 입력)" };
    } else if (offerDb) {
      const dims = parsePackageText(offerDb.package_size_text);
      if (dims && offer?.weightKg) pack = { ...dims, kg: offer.weightKg, status: "SUPPLIER", basis: `공급 페이지 포장 정보 "${offerDb.package_size_text}" · ${offer.weightKg}kg — 판매 단위 포장인지 미확인` };
    }

    const confirmed = row?.category_confirmed ?? false;
    const input: DetailInput = {
      today,
      cards,
      sale: row?.sale_price != null ? { price: Number(row.sale_price), discount: row.seller_discount != null ? Number(row.seller_discount) : null, source: "USER" } : { price: p.salePrice, discount: row?.seller_discount != null ? Number(row.seller_discount) : null, source: p.salePrice != null ? "OBSERVED" : null },
      category: {
        salesScope: row?.sales_scope ?? guess.salesScope,
        salesPath: row?.sales_path ?? null,
        feeGroup: row?.fee_group ?? guess.feeGroup,
        confirmed,
        basis: confirmed ? "사용자 확인" : row?.sales_scope || row?.fee_group ? "사용자 입력 · 미확인" : guess.basis,
      },
      pack,
      supply,
      orderQty,
      settings: settings.items,
      overrides: sanitizeItems(row?.overrides),
      taxType: settings.taxType,
      tariff: { rate: row?.tariff_rate != null ? Number(row.tariff_rate) : null, hsCode: row?.hs_code ?? null, basis: row?.tariff_basis ?? null, confirmed: row?.tariff_confirmed ?? false },
      storageDays: row?.storage_days ?? null,
      returnRate: row?.return_rate != null ? Number(row.return_rate) : null,
    };
    const result = calculateCostDetail(input);
    // 기준일 · 전체 요율 목록은 지문에서 뺀다 (날짜만 바뀌면 같은 입력) — 실제로 쓴 요율 행 · 프로모션 적용 여부만 넣는다
    const hash = fingerprint({ v: COST_DETAIL_VERSION, input: { ...input, today: undefined, cards: undefined }, cards: result.usedCards.map((u) => [u.id, u.checkedOn, u.promo]) });
    out.set(id, { productId: id, productName: p.name, coupangPath: p.categoryPath, guess, inputRow: row, supplyRef, selectedCount: selected.length, input, result, hash });
  }
  return out;
}

export async function loadDetail(productId: string): Promise<DetailView | null> {
  return (await loadDetails([productId])).get(productId) ?? null;
}

/** 이력 저장: 분석할 수 있는 경우만 (공급 원가 · 판매가가 없으면 저장하지 않음). 같은 입력이면 그대로 */
export async function recordDetail(v: DetailView): Promise<"CREATED" | "UNCHANGED" | "NOT_ANALYZABLE"> {
  if (v.result.status === "NOT_ANALYZABLE") return "NOT_ANALYZABLE";
  const supabase = await createClient();
  const usedIds = new Set(v.result.usedCards.map((u) => u.id));
  const row = {
    product_id: v.productId,
    link_id: v.supplyRef?.linkId ?? null,
    engine: COST_DETAIL_VERSION,
    input_hash: v.hash,
    inputs: { ...v.input, cards: v.input.cards.filter((c) => usedIds.has(c.id)) } as unknown as Json,
    result: v.result as unknown as Json,
    status: v.result.status,
    sale_price: v.result.salePrice,
    confirmed_profit: v.result.confirmed.outcome?.profit ?? null,
    estimated_low: v.result.estimated.worst?.profit ?? null,
    estimated_high: v.result.estimated.best?.profit ?? null,
  };
  const { data, error } = await supabase.from("product_cost_calculations").upsert(row, { onConflict: "owner_id,product_id,input_hash", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data && data.length > 0 ? "CREATED" : "UNCHANGED";
}

/** 자동 실행: 공급 후보를 선택했거나 비용 입력이 있는 상품만 계산 · 이력 */
export async function recordAllDetails(): Promise<{ products: number; created: number; unchanged: number; notAnalyzable: number; confirmed: number; estimateOnly: number }> {
  const supabase = await createClient();
  const [{ data: sel }, { data: inp }] = await Promise.all([
    supabase.from("product_supply_links").select("product_id").eq("user_status", "SELECTED"),
    supabase.from("product_cost_inputs").select("product_id"),
  ]);
  const ids = [...new Set([...(sel ?? []).map((r) => r.product_id), ...(inp ?? []).map((r) => r.product_id)])];
  const views = await loadDetails(ids);
  const out = { products: views.size, created: 0, unchanged: 0, notAnalyzable: 0, confirmed: 0, estimateOnly: 0 };
  for (const v of views.values()) {
    const r = await recordDetail(v);
    if (r === "CREATED") out.created += 1;
    else if (r === "UNCHANGED") out.unchanged += 1;
    else out.notAnalyzable += 1;
    if (v.result.status === "CONFIRMED") out.confirmed += 1;
    if (v.result.status === "ESTIMATE_ONLY") out.estimateOnly += 1;
  }
  return out;
}

export interface CostHistoryRow {
  id: string;
  computedAt: string;
  status: string;
  salePrice: number | null;
  confirmedProfit: number | null;
  estimatedLow: number | null;
  estimatedHigh: number | null;
  engine: string;
  cards: { kind: string; scope: string; checkedOn: string; promo: boolean }[];
}

export async function listCostHistory(productId: string): Promise<CostHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_cost_calculations")
    .select("id, computed_at, status, sale_price, confirmed_profit, estimated_low, estimated_high, engine, used:result->usedCards")
    .eq("product_id", productId)
    .order("computed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    computedAt: r.computed_at,
    status: r.status,
    salePrice: r.sale_price,
    confirmedProfit: r.confirmed_profit,
    estimatedLow: r.estimated_low,
    estimatedHigh: r.estimated_high,
    engine: r.engine,
    cards: ((r.used as unknown as { kind: string; scope: string; checkedOn: string; promo: boolean }[]) ?? []).map((c) => ({ kind: c.kind, scope: c.scope, checkedOn: c.checkedOn, promo: c.promo })),
  }));
}
