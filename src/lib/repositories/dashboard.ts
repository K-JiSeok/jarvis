import "server-only";

import { MOCK_DASHBOARD } from "@/lib/mock/dashboard";
import type { DashboardData } from "@/types/dashboard";

/**
 * Dashboard 데이터의 단일 진입점. 페이지는 이 함수만 호출한다.
 *
 * 지금은 항상 DEMO (mode: "DEMO") 다. DEMO 데이터는 DB 에 넣지 않는다.
 * PHASE 8 에서 isSupabaseConfigured() 일 때 listCurrentScores() + v_product_latest 로
 * RecommendationView 를 만들어 mode: "LIVE" 로 반환한다.
 */
export async function getDashboardData(): Promise<DashboardData> {
  return MOCK_DASHBOARD;
}
