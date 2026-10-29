import "server-only";

import { effectiveCompliance } from "@/lib/automation/compliance";
import { judge, type JudgeResult } from "@/lib/judge/engine";
import { keywordOpportunity, KW_OPPORTUNITY_RULES, queueCandidate, sortOpportunities, type KwOpportunity, type QueueCandidate, type QueueSkip } from "@/lib/discover/keyword-opportunity";
import { fetchAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";

import { listCompliance } from "./automation";
import { loadEstimates, type EstimateView } from "./estimates";
import { listKeywords } from "./keywords";
import { getMarketSnapshot } from "./market";

/*
 * 키워드 기회 · 수집 대기열 (PHASE 29). 로그인 사용자 세션(RLS)으로 읽기만 한다.
 * 키워드마다: 가장 최근 검색 결과(시장 구조 · 등록 상품) + 판매 추정 · 단위 경제성 + 판매 가능성(새 규칙)
 *   → 상품마다 판정 V2 (상품 발굴 화면과 같은 입력, 공급 원가는 넣지 않음) → keywordOpportunity()
 */

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export interface KeywordOpportunityRow extends KwOpportunity {
  keywordId: string;
  searchVolume: number | null;
}

export interface JudgedProduct {
  productId: string;
  judge: JudgeResult;
  estimate: EstimateView | null;
  certification: boolean;
}

export interface JudgedKeyword {
  keywordId: string;
  keyword: string;
  searchVolume: number | null;
  volumeHistory: { on: string; value: number }[];
  snapshot: Awaited<ReturnType<typeof getMarketSnapshot>>;
  collectedDays: string[];
  products: JudgedProduct[];
}

/**
 * 추적 키워드마다 가장 최근 검색 결과의 등록 상품을 판정 V2 로 계산한다 (PHASE 29 키워드 기회 · PHASE 30 예측 기록이 함께 쓴다).
 * 상품 발굴 화면과 같은 입력이고 공급 원가는 넣지 않는다.
 */
export async function judgeTrackedKeywords(): Promise<{ asOf: string; keywords: JudgedKeyword[] }> {
  const supabase = await createClient();
  const asOf = kstToday();
  const keywords = (await listKeywords()).filter((k) => k.isTracking);
  if (!keywords.length) return { asOf, keywords: [] };

  const [snapshots, history, days, compliance, brands] = await Promise.all([
    Promise.all(keywords.map(async (k) => [k.id, await getMarketSnapshot(k.id)] as const)),
    fetchAllRows((a, b) => supabase.from("keyword_snapshots").select("keyword_id, captured_on, search_volume, is_excluded").not("search_volume", "is", null).order("id").range(a, b)),
    fetchAllRows((a, b) => supabase.from("v_keyword_collection_days").select("keyword_id, captured_on").order("captured_on").order("keyword_id").range(a, b)),
    listCompliance(),
    fetchAllRows((a, b) => supabase.from("products").select("id, brand").order("id").range(a, b)),
  ]);
  const snapOf = new Map(snapshots);
  const brandOf = new Map(brands.map((p) => [p.id, p.brand]));
  const histOf = new Map<string, { on: string; value: number }[]>();
  for (const h of history) {
    if (h.is_excluded || h.search_volume == null) continue;
    histOf.set(h.keyword_id, [...(histOf.get(h.keyword_id) ?? []), { on: h.captured_on, value: Number(h.search_volume) }]);
  }
  const daysOf = new Map<string, string[]>();
  for (const d of days) if (d.keyword_id && d.captured_on) daysOf.set(d.keyword_id, [...(daysOf.get(d.keyword_id) ?? []), d.captured_on]);

  const allIds = [...new Set([...snapOf.values()].flatMap((s) => s?.productIds ?? []))];
  const estimates = await loadEstimates(allIds);
  const nowIso = new Date().toISOString();

  const out: JudgedKeyword[] = keywords.map((k) => {
    const snap = snapOf.get(k.id) ?? null;
    const pids = snap?.productIds ?? [];
    const peerSalesMin = pids.map((id) => estimates.get(id)?.sales.monthly?.min).filter((x): x is number => x != null);
    const history = histOf.get(k.id) ?? [];
    const products: JudgedProduct[] = pids.map((id) => {
      const e = estimates.get(id);
      const stored = compliance.get(id);
      const comp = effectiveCompliance(
        stored ? { status: stored.status, decidedBy: stored.decidedBy, ruleVersion: stored.ruleVersion } : null,
        { productName: e?.productName ?? "", brand: brandOf.get(id) ?? null, category: e?.categoryPath ?? null },
        nowIso,
      );
      const j = judge({
        asOf,
        keyword: k.keyword,
        searchVolume: k.metrics.searchVolume ?? null,
        searchGrowthRate: k.metrics.searchGrowthRate ?? null,
        market: snap?.market ?? null,
        price: e?.price ?? null,
        sales: e?.sales ?? null,
        economics: e?.economics ?? null,
        supplyMargin: null,
        conversionRate: null,
        compliance: comp.status,
        certifications: comp.certifications,
        productName: e?.productName ?? null,
        searchVolumeHistory: history,
        peerSalesMin,
      });
      return { productId: id, judge: j, estimate: e ?? null, certification: comp.status === "REQUIRES_CERTIFICATION" };
    });
    return { keywordId: k.id, keyword: k.keyword, searchVolume: k.metrics.searchVolume?.value ?? null, volumeHistory: history, snapshot: snap, collectedDays: daysOf.get(k.id) ?? [], products };
  });
  return { asOf, keywords: out };
}

export async function listKeywordOpportunities(): Promise<{ asOf: string; items: KeywordOpportunityRow[]; tracked: number }> {
  const { asOf, keywords } = await judgeTrackedKeywords();
  const items: KeywordOpportunityRow[] = keywords.map((k) => {
    const o = keywordOpportunity({
      keyword: k.keyword,
      asOf,
      searchVolume: k.searchVolume,
      volumeHistory: k.volumeHistory,
      market: k.snapshot?.market ?? null,
      collectedDays: k.collectedDays,
      products: k.products.map((p) => ({ verdict: p.judge.verdict, total: p.judge.total, hasSales: p.estimate?.sales.monthly != null, certification: p.certification })),
    });
    return { ...o, keywordId: k.keywordId, searchVolume: k.searchVolume };
  });
  return { asOf, items: sortOpportunities(items) as KeywordOpportunityRow[], tracked: keywords.length };
}

export interface QueueRow extends QueueCandidate {
  id: string;
  searchVolume: number | null;
  compIdx: string | null;
  seedKeyword: string | null;
}

/** 수집 대기열: 대기 중인 키워드 후보(월 검색량 3,000 이상)를 거르고 점수 순으로 */
export async function listCollectionQueue(limit = 15): Promise<{ items: QueueRow[]; skipped: Partial<Record<QueueSkip, number>>; total: number; freeSlots: number }> {
  const supabase = await createClient();
  const asOf = kstToday();
  const [cands, { count: tracked }] = await Promise.all([
    fetchAllRows((a, b) =>
      supabase
        .from("keyword_candidates")
        .select("id, keyword, seed_keyword, search_volume, comp_idx")
        .eq("status", "NEW")
        .eq("below_10", false)
        .gte("search_volume", 3000)
        .order("search_volume", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    supabase.from("keywords").select("id", { count: "exact", head: true }).eq("is_tracking", true),
  ]);
  const skipped: Partial<Record<QueueSkip, number>> = {};
  const ok: QueueRow[] = [];
  for (const c of cands) {
    const q = queueCandidate({ keyword: c.keyword, searchVolume: c.search_volume, compIdx: c.comp_idx }, asOf);
    if (q.skip) skipped[q.skip] = (skipped[q.skip] ?? 0) + 1;
    else ok.push({ ...q, id: c.id, searchVolume: c.search_volume, compIdx: c.comp_idx, seedKeyword: c.seed_keyword });
  }
  ok.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
  return { items: ok.slice(0, limit), skipped, total: cands.length, freeSlots: Math.max(0, KW_OPPORTUNITY_RULES.collectSlots - (tracked ?? 0)) };
}
