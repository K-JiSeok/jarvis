import type { DataQuality, ScoreSummary } from "@/lib/dashboard/aggregate";

import type { WatchlistItem } from "./watchlist";
import type { SavedScoreView } from "./score";

/**
 * Dashboard (LIVE) 뷰 모델. 모든 값은 로그인 사용자의 실제 DB 데이터 (RLS).
 * 점수가 없는 상품은 score = null ("미계산").
 */

export interface DashboardProductRef {
  id: string;
  productName: string;
  coupangProductId: string;
  createdAt: string;
  score: SavedScoreView | null;
}

export interface DashboardData {
  generatedAt: string;
  summary: ScoreSummary;
  /** 등록 상품 수에서 뺀 삭제·판매 종료 상품 수 */
  deletedProducts: number;
  watchingCount: number;
  recommendations: (SavedScoreView & { productName: string })[];
  recentProducts: DashboardProductRef[];
  recentScores: (SavedScoreView & { productName: string })[];
  watching: (WatchlistItem & { score: SavedScoreView | null })[];
  quality: DataQuality & { limit: number; truncated: boolean };
  freshness: {
    keyword: string | null;
    product: string | null;
    price: string | null;
    rank: string | null;
    score: string | null;
  };
}
