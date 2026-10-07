import "server-only";

import { pickTopKeywordRank, toKeywordRankView } from "@/lib/mappers/product";
import { createClient } from "@/lib/supabase/server";
import type { Confidence } from "@/types/common";
import type { KeywordRankView } from "@/types/product";

/*
 * 키워드 ↔ 상품 검색 순위 (keyword_product_ranks).
 * products 는 상품 master, 이 테이블은 "이 상품이 이 키워드에서 언제 몇 위였나" 관계 데이터다.
 * 같은 (키워드, 상품, 수집일, 출처, 광고 여부)는 UNIQUE → 다시 입력하면 갱신.
 * is_excluded 가 없으므로 잘못 만든 행은 MANUAL 에 한해 삭제한다 (D3-A).
 */

const RANK_SELECT = "*, keywords(keyword), products(product_name, coupang_product_id)";

export async function saveKeywordProductRank(input: {
  keywordId: string;
  productId: string;
  capturedOn: string;
  confidence: Confidence;
  rank: number;
  isAd: boolean;
  page: number | null;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("keyword_product_ranks").upsert(
    {
      keyword_id: input.keywordId,
      product_id: input.productId,
      captured_on: input.capturedOn,
      captured_at: new Date().toISOString(),
      source_type: "MANUAL",
      confidence: input.confidence,
      rank_position: input.rank,
      is_ad: input.isAd,
      page: input.page,
      // 직접 입력으로 덮어쓰면 "마지막으로 쓴 import" 가 아니게 된다
      import_job_id: null,
    },
    { onConflict: "keyword_id,product_id,captured_on,source_type,is_ad" },
  );
  if (error) throw error;
}

export async function listRanksForProduct(productId: string): Promise<KeywordRankView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keyword_product_ranks")
    .select(RANK_SELECT)
    .eq("product_id", productId)
    .order("captured_on", { ascending: false })
    .order("rank_position");
  if (error) throw error;
  return data.map(toKeywordRankView);
}

export async function listRanksForKeyword(keywordId: string): Promise<KeywordRankView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keyword_product_ranks")
    .select(RANK_SELECT)
    .eq("keyword_id", keywordId)
    .order("captured_on", { ascending: false })
    .order("is_ad")
    .order("rank_position");
  if (error) throw error;
  return data.map(toKeywordRankView);
}

/** 상품별 대표 키워드 순위 (D4-A: 최근 수집일 · 자연 노출 · 최고 순위) */
export async function latestKeywordRanks(productIds: string[]): Promise<Map<string, KeywordRankView>> {
  const result = new Map<string, KeywordRankView>();
  if (productIds.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keyword_product_ranks")
    .select(RANK_SELECT)
    .in("product_id", productIds)
    .eq("is_ad", false)
    .order("captured_on", { ascending: false });
  if (error) throw error;

  const byProduct = new Map<string, KeywordRankView[]>();
  for (const rank of data.map(toKeywordRankView)) {
    byProduct.set(rank.productId, [...(byProduct.get(rank.productId) ?? []), rank]);
  }
  for (const [productId, ranks] of byProduct) {
    const top = pickTopKeywordRank(ranks);
    if (top) result.set(productId, top);
  }
  return result;
}

/** 직접 입력(MANUAL) 순위만 삭제한다. 다른 출처의 데이터는 거부 */
export async function deleteManualRank(rankId: number): Promise<void> {
  const supabase = await createClient();
  const { data: row, error: findError } = await supabase
    .from("keyword_product_ranks")
    .select("id, source_type")
    .eq("id", rankId)
    .maybeSingle();
  if (findError) throw findError;
  if (!row) throw new Error("순위 기록을 찾을 수 없습니다.");
  if (row.source_type !== "MANUAL") throw new Error("직접 입력한 순위만 삭제할 수 있습니다.");

  // 조건에 source_type 을 한 번 더 걸어 조회와 삭제 사이에 바뀌어도 MANUAL 만 지운다
  const { error } = await supabase.from("keyword_product_ranks").delete().eq("id", rankId).eq("source_type", "MANUAL");
  if (error) throw error;
}
