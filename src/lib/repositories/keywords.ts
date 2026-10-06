import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { KeywordLatestRow } from "@/types/db";

/** keywords.normalized_keyword 생성 규칙: 소문자 + 앞뒤 공백 제거 + 연속 공백 1개 */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 키워드 1개의 현재 값 (v_keyword_latest) */
export async function getKeywordLatest(keywordId: string): Promise<KeywordLatestRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_keyword_latest")
    .select("*")
    .eq("keyword_id", keywordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** 정기 수집 대상 키워드 목록 */
export async function listTrackedKeywords({ limit = 100 } = {}): Promise<KeywordLatestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_keyword_latest")
    .select("*")
    .eq("is_tracking", true)
    .order("latest_captured_on", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
