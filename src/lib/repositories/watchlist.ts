import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { WatchlistRow, WatchlistStatus } from "@/types/db";

/** 관심상품 목록 (상태 필터 선택) */
export async function listWatchlist({ status }: { status?: WatchlistStatus } = {}): Promise<WatchlistRow[]> {
  const supabase = await createClient();
  let query = supabase.from("watchlist").select("*").order("status_changed_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** 관심상품 상태별 변경 이력 (log_watchlist_status 트리거가 기록) */
export async function listWatchlistEvents(watchlistId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist_events")
    .select("*")
    .eq("watchlist_id", watchlistId)
    .order("changed_at", { ascending: true });
  if (error) throw error;
  return data;
}
