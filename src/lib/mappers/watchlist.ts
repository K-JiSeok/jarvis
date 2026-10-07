import { isWatchlistStatus, WATCHLIST_OUTCOMES, type Tables, type WatchlistOutcome } from "@/types/db";
import type { WatchlistEventView, WatchlistItem } from "@/types/watchlist";

type WatchlistRow = Tables<"watchlist"> & {
  products?: { product_name: string; coupang_product_id: string } | null;
  keywords?: { keyword: string } | null;
};
type EventRow = Tables<"watchlist_events">;

export function toWatchlistItem(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.products?.product_name ?? "",
    coupangProductId: row.products?.coupang_product_id ?? "",
    keywordId: row.keyword_id,
    keyword: row.keywords?.keyword ?? null,
    status: isWatchlistStatus(row.status) ? row.status : "WATCHING",
    outcome: (WATCHLIST_OUTCOMES as readonly string[]).includes(row.outcome ?? "") ? (row.outcome as WatchlistOutcome) : null,
    memo: row.memo,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
  };
}

export function toWatchlistEvent(row: EventRow): WatchlistEventView {
  return {
    id: row.id,
    fromStatus: isWatchlistStatus(row.from_status) ? row.from_status : null,
    toStatus: isWatchlistStatus(row.to_status) ? row.to_status : "WATCHING",
    changedAt: row.changed_at,
  };
}
