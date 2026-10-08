import "server-only";

import {
  pickRecommendations,
  recentlyAnalyzed,
  summarizeDataQuality,
  summarizeScores,
  type PreviewLike,
} from "@/lib/dashboard/aggregate";
import { createClient } from "@/lib/supabase/server";
import type { DashboardData } from "@/types/dashboard";

import { listCurrentScoresByProduct, listScoreKeywordOptions, previewScore } from "./opportunity";
import { listWatchlist } from "./watchlist";

/*
 * Dashboard 데이터의 단일 진입점. 페이지는 getDashboardData() 만 호출한다.
 * 로그인 사용자 세션(RLS)으로만 읽는다 — 다른 사용자 데이터는 조회되지 않는다.
 *
 * - 대상 상품 = 삭제·판매 종료(DELETED)를 뺀 상품 (/products 기본 목록과 같다)
 * - 점수 = listCurrentScoresByProduct(): 활성 버전 is_current 점수 중 상품별 가장 최근 계산 1개 (이력 제외)
 * - 데이터 상태 = 상품마다 점수 엔진 미리 보기를 돌려 9개 요소 계산 가능 여부를 센다 (상품 상세와 같은 기본 맥락 키워드)
 */

const RECOMMEND_LIMIT = 6;
const RECENT_LIMIT = 5;
const WATCH_LIMIT = 8;
/** 데이터 상태 계산 대상 상품 수 상한 (상품마다 여러 쿼리를 쓰므로) */
const QUALITY_LIMIT = 50;
const QUALITY_CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type Latest = PromiseLike<{ data: { captured_on: string } | null; error: unknown }>;

/** 가장 최근 수집일 (없으면 null) */
async function latest(query: Latest): Promise<string | null> {
  const { data, error } = await query;
  if (error) throw error;
  return data?.captured_on ?? null;
}

/** 키워드 · 상품 · 가격 · 순위 데이터의 가장 최근 수집일. 제외 처리된 스냅샷은 뺀다 */
async function latestCollectedDates() {
  const supabase = await createClient();
  const newest = { ascending: false } as const;
  const [keyword, product, price, rank] = await Promise.all([
    latest(supabase.from("keyword_snapshots").select("captured_on").eq("is_excluded", false).order("captured_on", newest).limit(1).maybeSingle()),
    latest(supabase.from("product_snapshots").select("captured_on").eq("is_excluded", false).order("captured_on", newest).limit(1).maybeSingle()),
    latest(
      supabase.from("product_snapshots").select("captured_on").eq("is_excluded", false).not("price", "is", null).order("captured_on", newest).limit(1).maybeSingle(),
    ),
    latest(supabase.from("keyword_product_ranks").select("captured_on").order("captured_on", newest).limit(1).maybeSingle()),
  ]);
  return { keyword, product, price, rank };
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();

  const [products, deleted, scores, watching, dates] = await Promise.all([
    supabase
      .from("products")
      .select("id, product_name, coupang_product_id, created_at")
      .neq("lifecycle_status", "DELETED")
      .order("created_at", { ascending: false }),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("lifecycle_status", "DELETED"),
    listCurrentScoresByProduct(),
    listWatchlist({ status: "WATCHING" }),
    latestCollectedDates(),
  ]);
  if (products.error) throw products.error;
  if (deleted.error) throw deleted.error;

  const names = new Map(products.data.map((p) => [p.id, p.product_name]));
  // 삭제된 상품의 점수는 현황에서 뺀다 (상품 수와 맞추기 위해)
  const liveScores = [...scores.values()].filter((s) => names.has(s.productId)).map((s) => ({ ...s, productName: names.get(s.productId)! }));
  const summary = summarizeScores(products.data.map((p) => p.id), scores);

  // 데이터 상태: 최근 등록 순으로 QUALITY_LIMIT 개까지 엔진 미리 보기
  const targets = products.data.slice(0, QUALITY_LIMIT);
  const previews = await mapLimit(targets, QUALITY_CONCURRENCY, async (p): Promise<PreviewLike | null> => {
    const options = await listScoreKeywordOptions(p.id);
    const preview = await previewScore(p.id, options[0]?.id ?? null);
    if (!preview) return null;
    return {
      productId: p.id,
      complete: preview.result.complete,
      factors: preview.result.factors.map((f) => ({ factor: f.factor, label: f.label, score: f.score, missing: f.missing })),
    };
  });
  const quality = summarizeDataQuality(
    previews.filter((p): p is PreviewLike => p !== null),
    new Set(liveScores.map((s) => s.productId)),
  );

  return {
    generatedAt: new Date().toISOString(),
    summary,
    deletedProducts: deleted.count ?? 0,
    watchingCount: watching.length,
    recommendations: pickRecommendations(liveScores, RECOMMEND_LIMIT),
    recentProducts: products.data.slice(0, RECENT_LIMIT).map((p) => ({
      id: p.id,
      productName: p.product_name,
      coupangProductId: p.coupang_product_id,
      createdAt: p.created_at,
      score: scores.get(p.id) ?? null,
    })),
    recentScores: recentlyAnalyzed(liveScores, RECENT_LIMIT),
    watching: watching.slice(0, WATCH_LIMIT).map((w) => ({ ...w, score: scores.get(w.productId) ?? null })),
    quality: { ...quality, limit: QUALITY_LIMIT, truncated: products.data.length > QUALITY_LIMIT },
    freshness: {
      ...dates,
      score: recentlyAnalyzed(liveScores, 1)[0]?.calculatedAt ?? null,
    },
  };
}
