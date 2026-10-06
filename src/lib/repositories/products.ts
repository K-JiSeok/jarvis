import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ProductLatestRow } from "@/types/db";

/** 상품 1개의 현재 값 (v_product_latest: 항목별 최우선 스냅샷 + 출처·신뢰도·수집일) */
export async function getProductLatest(productId: string): Promise<ProductLatestRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_latest")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** 최근 관측된 상품 목록 (삭제 감지된 상품 제외) */
export async function listProductsLatest({ limit = 50 } = {}): Promise<ProductLatestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_latest")
    .select("*")
    .neq("lifecycle_status", "DELETED")
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
