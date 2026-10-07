import type { WatchlistOutcome, WatchlistStatus } from "./db";

export { WATCHLIST_OUTCOMES, WATCHLIST_STATUSES, type WatchlistOutcome, type WatchlistStatus } from "./db";

/** watchlist.status 표시 이름 (값은 DB CHECK 와 동일, 추가하지 않는다) */
export const WATCHLIST_STATUS_LABELS: Record<WatchlistStatus, string> = {
  WATCHING: "관찰",
  SOURCING: "소싱 검토",
  TESTING: "테스트 판매",
  SELLING: "판매 중",
  PAUSED: "일시 중지",
  SOLD_OUT: "품절",
  STOPPED: "판매 종료",
  DROPPED: "해제(제외)",
};

export const WATCHLIST_OUTCOME_LABELS: Record<WatchlistOutcome, string> = {
  SUCCESS: "성공",
  BREAK_EVEN: "본전",
  FAILED: "실패",
};

/** 관심상품 1건. 해제는 행 삭제가 아니라 status = DROPPED (이력 보존) */
export interface WatchlistItem {
  id: string;
  productId: string;
  productName: string;
  coupangProductId: string;
  keywordId: string | null;
  keyword: string | null;
  status: WatchlistStatus;
  outcome: WatchlistOutcome | null;
  memo: string | null;
  statusChangedAt: string;
  createdAt: string;
}

/** 상태 이력 (log_watchlist_status 트리거가 기록) */
export interface WatchlistEventView {
  id: number;
  fromStatus: WatchlistStatus | null;
  toStatus: WatchlistStatus;
  changedAt: string;
}
