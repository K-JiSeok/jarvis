import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CurrentScoreRow } from "@/types/db";

/** 활성 점수 버전의 현재 점수, 높은 순 (v_current_scores) */
export async function listCurrentScores({ limit = 20 } = {}): Promise<CurrentScoreRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_current_scores")
    .select("*")
    .order("total_score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** 상품 1개의 점수 이력 (모든 버전, 최신순) */
export async function listScoreHistory(productId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunity_scores")
    .select("*")
    .eq("product_id", productId)
    .order("calculated_at", { ascending: false });
  if (error) throw error;
  return data;
}
