import "server-only";

import { marketStructure, type MarketItem, type MarketStructure } from "@/lib/market/structure";
import { createClient } from "@/lib/supabase/server";

/*
 * 시장 구조 repository (PHASE 25). 로그인 사용자 세션(RLS)으로만 읽는다. 쓰지 않는다.
 * 키워드의 가장 최근 검색 수집일 칸(keyword_product_ranks) + 각 상품의 현재 값(v_product_latest)
 * → marketStructure() (순수 함수).
 * 가격 · 리뷰 · 배송은 상품의 "현재 값"이라 순위 수집일보다 늦은 값일 수 있다 (같은 날 수집이 대부분).
 */

const CHUNK = 100;

export async function getMarketStructure(keywordId: string): Promise<MarketStructure | null> {
  return (await getMarketSnapshot(keywordId))?.market ?? null;
}

/** 시장 구조 + 그날 검색 결과에 나온 등록 상품 id (PHASE 29 키워드 기회 화면) */
export async function getMarketSnapshot(keywordId: string): Promise<{ capturedOn: string; market: MarketStructure | null; productIds: string[] } | null> {
  const supabase = await createClient();
  const { data: last, error: e1 } = await supabase
    .from("keyword_product_ranks")
    .select("captured_on")
    .eq("keyword_id", keywordId)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;
  if (!last) return null;

  const { data: ranks, error: e2 } = await supabase
    .from("keyword_product_ranks")
    .select("product_id, rank_position, is_ad")
    .eq("keyword_id", keywordId)
    .eq("captured_on", last.captured_on)
    .limit(1000);
  if (e2) throw e2;

  // 같은 날 출처가 여럿이면 (상품, 광고 여부)마다 가장 앞 순위 하나
  const best = new Map<string, { productId: string; rank: number; isAd: boolean }>();
  for (const r of ranks) {
    const key = `${r.product_id}:${r.is_ad}`;
    const prev = best.get(key);
    if (!prev || r.rank_position < prev.rank) best.set(key, { productId: r.product_id, rank: r.rank_position, isAd: r.is_ad });
  }
  const ids = [...new Set([...best.values()].map((b) => b.productId))];
  const latest = new Map<string, { price: number | null; review_count: number | null; delivery_type: string | null; seller_type_observed: string | null; snapshot_count: number | null }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("v_product_latest")
      .select("product_id, price, review_count, delivery_type, seller_type_observed, snapshot_count")
      .in("product_id", ids.slice(i, i + CHUNK));
    if (error) throw error;
    for (const d of data) if (d.product_id) latest.set(d.product_id, d);
  }

  const items: MarketItem[] = [...best.values()].map((b) => {
    const l = latest.get(b.productId);
    return {
      rankPosition: b.rank,
      isAd: b.isAd,
      price: l?.price != null ? Number(l.price) : null,
      reviewCount: l?.review_count != null ? Number(l.review_count) : null,
      sellerType: l?.seller_type_observed ?? null,
      deliveryType: l?.delivery_type ?? null,
      observed: (l?.snapshot_count ?? 0) > 0,
    };
  });
  return { capturedOn: last.captured_on, market: marketStructure(last.captured_on, items), productIds: ids };
}
