import "server-only";

import { toWatchlistEvent, toWatchlistItem } from "@/lib/mappers/watchlist";
import { createClient } from "@/lib/supabase/server";
import type { WatchlistEventView, WatchlistItem, WatchlistStatus } from "@/types/watchlist";

/*
 * 관심상품. 상태 이력(watchlist_events)은 log_watchlist_status 트리거가 기록한다 → 앱에서 직접 쓰지 않는다.
 * 해제 = status DROPPED (행 삭제 시 이력이 CASCADE 로 사라지므로 삭제하지 않는다, D1-A).
 * 상태 변경 메모는 전달하지 않는다 (D2-A). 관리 메모는 watchlist.memo.
 */

const SELECT = "*, products(product_name, coupang_product_id), keywords(keyword)";

/** 목록. 기본은 DROPPED 숨김, status 를 주면 그 상태만 ("ALL" = 전부) */
export async function listWatchlist({ status }: { status?: WatchlistStatus | "ALL" } = {}): Promise<WatchlistItem[]> {
  const supabase = await createClient();
  let query = supabase.from("watchlist").select(SELECT).order("status_changed_at", { ascending: false });
  if (status && status !== "ALL") query = query.eq("status", status);
  else if (!status) query = query.neq("status", "DROPPED");
  const { data, error } = await query;
  if (error) throw error;
  return data.map(toWatchlistItem);
}

export async function getWatchlistForProduct(productId: string): Promise<WatchlistItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("watchlist").select(SELECT).eq("product_id", productId).maybeSingle();
  if (error) throw error;
  return data ? toWatchlistItem(data) : null;
}

export type AddResult = "ADDED" | "RESTORED" | "ALREADY";

/**
 * 관심상품 등록. 새 상품이면 행 생성 (트리거: NULL → WATCHING),
 * DROPPED 였으면 같은 행을 WATCHING 으로 되돌림 (이력 이어짐), 그 밖의 상태면 그대로.
 */
export async function addToWatchlist(productId: string, keywordId: string | null): Promise<AddResult> {
  const existing = await getWatchlistForProduct(productId);
  const supabase = await createClient();

  if (!existing) {
    const { error } = await supabase.from("watchlist").insert({ product_id: productId, keyword_id: keywordId });
    if (error) throw error;
    return "ADDED";
  }
  if (existing.status === "DROPPED") {
    await updateWatchlistStatus(existing.id, "WATCHING");
    return "RESTORED";
  }
  return "ALREADY";
}

/** 해제 = DROPPED. 행과 이력은 남는다 */
export async function releaseFromWatchlist(watchlistId: string): Promise<void> {
  await updateWatchlistStatus(watchlistId, "DROPPED");
}

export async function updateWatchlistStatus(watchlistId: string, status: WatchlistStatus): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("watchlist").update({ status }).eq("id", watchlistId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("관심상품을 찾을 수 없습니다.");
}

export async function updateWatchlistMemo(watchlistId: string, memo: string | null): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("watchlist").update({ memo }).eq("id", watchlistId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("관심상품을 찾을 수 없습니다.");
}

/** 상태 이력 (오래된 것부터) */
export async function listWatchlistEvents(watchlistId: string): Promise<WatchlistEventView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist_events")
    .select("*")
    .eq("watchlist_id", watchlistId)
    .order("changed_at")
    .order("id");
  if (error) throw error;
  return data.map(toWatchlistEvent);
}

/** 여러 관심상품의 이력을 한 번에 (목록 화면용) */
export async function listWatchlistEventsFor(watchlistIds: string[]): Promise<Map<string, WatchlistEventView[]>> {
  const result = new Map<string, WatchlistEventView[]>();
  if (watchlistIds.length === 0) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist_events")
    .select("*")
    .in("watchlist_id", watchlistIds)
    .order("changed_at")
    .order("id");
  if (error) throw error;
  for (const row of data) {
    result.set(row.watchlist_id, [...(result.get(row.watchlist_id) ?? []), toWatchlistEvent(row)]);
  }
  return result;
}
