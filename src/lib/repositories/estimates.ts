import "server-only";

import { guessCategory } from "@/lib/costs/category";
import type { DetailResult } from "@/lib/costs/detail";
import { unitEconomics, type UnitEconomics } from "@/lib/estimate/economics";
import { estimateOpportunity, type Opportunity } from "@/lib/estimate/opportunity";
import { estimateSales, type SalesEstimate } from "@/lib/estimate/sales";
import { listRateCards } from "@/lib/repositories/costs";
import { productContexts } from "@/lib/repositories/sourcing";
import { fetchAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";

/*
 * 추정 판매 · 기회 (PHASE 22). 저장된 수집 기록만 읽는다 (사용자 RLS). 새 테이블 없음:
 *   - 상품 스냅샷(product_snapshots): 날짜별 누적 리뷰 수 → 리뷰 증가
 *   - 수집 원본(import_rows.payload.collected.observedOnly): "한 달간 N명 이상 구매" 문구 · 최근 리뷰 날짜
 */

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export interface EstimateView {
  productId: string;
  productName: string;
  price: number | null;
  sales: SalesEstimate;
  opportunity: Opportunity;
  economics: UnitEconomics | null;
  categoryPath: string | null;
  /** 최근 누적 리뷰 수 (수집 우선순위용) */
  reviewCount: number | null;
}

export async function loadEstimates(productIds: string[], details: Map<string, { result: DetailResult }> = new Map()): Promise<Map<string, EstimateView>> {
  const out = new Map<string, EstimateView>();
  if (productIds.length === 0) return out;
  const supabase = await createClient();
  // 상품이 수백 개면 .in(ids) 주소가 16KB 를 넘는다 → 사용자 전체(RLS)를 읽고 아래에서 거른다
  // PHASE 29: API 는 한 번에 1,000행까지만 준다 → 끝까지 나눠 읽는다 (안 그러면 오래된 리뷰 수 기록이 빠져 판매 추정이 틀어진다)
  const [ctx, cards, prods, snaps, rows, latest] = await Promise.all([
    productContexts(productIds),
    listRateCards(),
    fetchAllRows((a, b) => supabase.from("products").select("id, coupang_product_id").order("id").range(a, b)),
    fetchAllRows((a, b) => supabase.from("product_snapshots").select("product_id, captured_on, review_count, is_excluded").not("review_count", "is", null).order("captured_on").order("id").range(a, b)),
    fetchAllRows((a, b) =>
      supabase
        .from("import_rows")
        .select("record_key, created_at, mb:payload->collected->observedOnly->>monthlyBuyers, rd:payload->collected->observedOnly->>reviewDates, cap:payload->collected->>capturedAt")
        .like("record_key", "product\\_snapshot:%")
        .or("payload->collected->observedOnly->>monthlyBuyers.not.is.null,payload->collected->observedOnly->>reviewDates.not.is.null")
        .order("created_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    fetchAllRows((a, b) => supabase.from("v_product_latest").select("product_id, review_count").order("product_id").range(a, b)),
  ]);
  const reviewsOf = new Map((latest ?? []).map((l) => [l.product_id, l.review_count]));
  const wanted = new Set(productIds);
  const idByCoupang = new Map((prods ?? []).filter((p) => wanted.has(p.id)).map((p) => [p.coupang_product_id, p.id]));
  const hist = new Map<string, Map<string, number>>();
  for (const s of snaps ?? []) {
    if (s.is_excluded || s.review_count == null) continue;
    const m = hist.get(s.product_id) ?? new Map<string, number>();
    m.set(s.captured_on, Math.max(m.get(s.captured_on) ?? 0, s.review_count));
    hist.set(s.product_id, m);
  }
  const badge = new Map<string, { text: string; on: string }>();
  const sample = new Map<string, { dates: string[]; capturedOn: string }>();
  for (const r of rows ?? []) {
    const [, cid, day] = (r.record_key ?? "").split(":");
    const pid = idByCoupang.get(cid);
    if (!pid) continue;
    // 가장 최근 수집 1건씩 (created_at 내림차순)
    if (typeof r.mb === "string" && !badge.has(pid)) badge.set(pid, { text: r.mb, on: day });
    if (typeof r.rd === "string" && r.rd && !sample.has(pid)) sample.set(pid, { dates: r.rd.split(","), capturedOn: day });
  }
  const today = kstToday();
  for (const id of productIds) {
    const p = ctx.get(id);
    if (!p) continue;
    const b = badge.get(id);
    const sales = estimateSales({
      price: p.salePrice,
      monthlyBuyersText: b?.text ?? null,
      monthlyBuyersOn: b?.on ?? null,
      reviewSample: sample.get(id) ?? null,
      reviewHistory: [...(hist.get(id) ?? new Map()).entries()].map(([on, count]) => ({ on, count })),
    });
    const g = guessCategory(p.name, p.categoryPath);
    const opportunity = estimateOpportunity({ today, price: p.salePrice, sales, cards, salesScope: g.salesScope, feeGroup: g.feeGroup, detail: details.get(id)?.result ?? null });
    const economics = p.salePrice != null ? unitEconomics({ today, price: p.salePrice, cards, salesScope: g.salesScope, feeGroup: g.feeGroup }) : null;
    out.set(id, { productId: id, productName: p.name, price: p.salePrice, sales, opportunity, economics, categoryPath: p.categoryPath, reviewCount: reviewsOf.get(id) ?? null });
  }
  return out;
}
