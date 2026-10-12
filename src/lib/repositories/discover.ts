import "server-only";

import type { ScoreInput, ScoreResult } from "@/lib/scoring/engine";
import { createClient } from "@/lib/supabase/server";
import type { ProfitScenario } from "@/types/profit";
import type { ProductRiskView } from "@/types/score";

import { getKeywordDetail } from "./keywords";
import { listNaverStatus, type NaverKeywordStatus } from "./naver-status";
import { listActiveRisks, previewScore } from "./opportunity";
import { listScenariosForProduct } from "./profit";
import { listSearchObservations } from "./search-observations";

/*
 * 상품 발굴 (/discover, PHASE 15) — 읽기 전용. 새 저장소 · 새 점수 공식 없음.
 *
 *   키워드 선택 → 이 키워드와 연결된 등록 상품 모으기 (중복 제거)
 *     · 검색 순위 (keyword_product_ranks)  · 경쟁 관계 (competitors.keyword_id — 기준 · 경쟁 양쪽)  · 관심상품 (watchlist.keyword_id)
 *   → 상품마다 기존 Score Engine V1 미리 보기 (previewScore — 이 키워드 맥락) · 대표 수익성 시나리오(기존 Profit 엔진 계산 결과) · 활성 위험
 * 점수를 저장하지 않는다 (기존 정책: 상품 상세의 "점수 다시 계산"으로만 저장).
 */

/** 한 번에 분석하는 상품 수 상한 (상품마다 미리 보기 조회가 여러 번이라) */
export const DISCOVER_MAX_PRODUCTS = 30;

export type DiscoverOrigin = "RANK" | "COMPETITOR" | "WATCHLIST";

export interface DiscoverProduct {
  id: string;
  productName: string;
  coupangProductId: string;
  origins: DiscoverOrigin[];
  /** 이 키워드의 가장 최근 순위 (자연 · 광고 각각) */
  latestRank: { organic: number | null; ad: number | null; capturedOn: string | null };
  preview: ScoreResult;
  /** Score 엔진이 받은 입력 그대로 (데이터 준비 상태 표시용, PHASE 16) */
  input: ScoreInput;
  /** 리뷰 수 기록 (제외되지 않은 스냅샷) */
  reviewHistory: { capturedOn: string; value: number }[];
  primaryScenario: ProfitScenario | null;
  risks: ProductRiskView[];
}

export interface DiscoverAnalysis {
  keyword: NonNullable<Awaited<ReturnType<typeof getKeywordDetail>>>;
  naver: NaverKeywordStatus | null;
  /** 확장 프로그램 검색 결과 수집 (가장 최근 1회, PHASE 16) */
  coupangSearch: { capturedAt: string; total: number; registered: number } | null;
  products: DiscoverProduct[];
  /** 연결 상품이 상한을 넘어 일부만 분석했을 때 전체 수 */
  totalLinked: number;
}

export async function getDiscoverAnalysis(keywordId: string, { limit = DISCOVER_MAX_PRODUCTS }: { limit?: number } = {}): Promise<DiscoverAnalysis | null> {
  const keyword = await getKeywordDetail(keywordId);
  if (!keyword) return null;
  const supabase = await createClient();
  const [ranks, comps, watch, naver, observations] = await Promise.all([
    supabase.from("keyword_product_ranks").select("product_id, rank_position, is_ad, captured_on").eq("keyword_id", keywordId).order("captured_on", { ascending: false }),
    supabase.from("competitors").select("product_id, competitor_product_id").eq("keyword_id", keywordId).eq("is_active", true),
    supabase.from("watchlist").select("product_id").eq("keyword_id", keywordId),
    listNaverStatus([keywordId]),
    listSearchObservations(keyword.keyword, { limit: 1 }),
  ]);
  const obs = observations[0];
  const coupangSearch = obs ? { capturedAt: obs.capturedAt, total: obs.total, registered: obs.registered } : null;
  for (const r of [ranks, comps, watch]) if (r.error) throw r.error;

  // 중복 제거: 같은 상품이 순위 · 경쟁 관계 · 관심상품에 여러 번 나와도 한 번만
  const origins = new Map<string, Set<DiscoverOrigin>>();
  const add = (id: string | null, o: DiscoverOrigin) => {
    if (!id) return;
    origins.set(id, (origins.get(id) ?? new Set()).add(o));
  };
  const latestDate = ranks.data?.[0]?.captured_on ?? null;
  const rankOf = new Map<string, DiscoverProduct["latestRank"]>();
  for (const r of ranks.data ?? []) {
    add(r.product_id, "RANK");
    const cur = rankOf.get(r.product_id) ?? { organic: null, ad: null, capturedOn: r.captured_on };
    if (r.captured_on !== cur.capturedOn) continue; // 상품별 가장 최근 수집일만
    if (r.is_ad) cur.ad = cur.ad == null ? r.rank_position : Math.min(cur.ad, r.rank_position);
    else cur.organic = cur.organic == null ? r.rank_position : Math.min(cur.organic, r.rank_position);
    rankOf.set(r.product_id, cur);
  }
  for (const c of comps.data ?? []) {
    add(c.product_id, "COMPETITOR");
    add(c.competitor_product_id, "COMPETITOR");
  }
  for (const w of watch.data ?? []) add(w.product_id, "WATCHLIST");

  // 최근 순위가 있는 상품부터 (최근 수집일 · 자연 순위) — 순서는 화면 정렬 전 분석 대상 선택에만 쓴다
  const ids = [...origins.keys()].sort((a, b) => {
    const ra = rankOf.get(a);
    const rb = rankOf.get(b);
    const da = ra?.capturedOn === latestDate ? 0 : 1;
    const db = rb?.capturedOn === latestDate ? 0 : 1;
    return da - db || (ra?.organic ?? 9999) - (rb?.organic ?? 9999);
  });
  const picked = ids.slice(0, limit);
  if (picked.length === 0) return { keyword, naver: naver.get(keywordId) ?? null, coupangSearch, products: [], totalLinked: 0 };

  const [{ data: masters, error }, { data: reviewRows, error: reviewError }] = await Promise.all([
    supabase.from("products").select("id, product_name, coupang_product_id").in("id", picked),
    supabase.from("product_snapshots").select("product_id, captured_on, review_count").in("product_id", picked).eq("is_excluded", false).not("review_count", "is", null).limit(5000),
  ]);
  if (error) throw error;
  if (reviewError) throw reviewError;
  const master = new Map(masters.map((m) => [m.id, m]));
  const reviewsOf = new Map<string, { capturedOn: string; value: number }[]>();
  for (const r of reviewRows ?? []) reviewsOf.set(r.product_id, [...(reviewsOf.get(r.product_id) ?? []), { capturedOn: r.captured_on, value: r.review_count! }]);

  const products = await Promise.all(
    picked
      .filter((id) => master.has(id))
      .map(async (id): Promise<DiscoverProduct | null> => {
        const [pv, scenarios, risks] = await Promise.all([previewScore(id, keywordId), listScenariosForProduct(id), listActiveRisks(id)]);
        if (!pv) return null;
        const m = master.get(id)!;
        return {
          id,
          productName: m.product_name,
          coupangProductId: m.coupang_product_id,
          origins: [...(origins.get(id) ?? [])],
          latestRank: rankOf.get(id) ?? { organic: null, ad: null, capturedOn: null },
          preview: pv.result,
          input: pv.input,
          reviewHistory: reviewsOf.get(id) ?? [],
          primaryScenario: scenarios.find((s) => s.isPrimary) ?? null,
          risks,
        };
      }),
  );
  return { keyword, naver: naver.get(keywordId) ?? null, coupangSearch, products: products.filter((p): p is DiscoverProduct => !!p), totalLinked: ids.length };
}
