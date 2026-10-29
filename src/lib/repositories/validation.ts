import "server-only";

import { JUDGE_VERSION } from "@/lib/judge/engine";
import { parseBuyers, rateFromGrowth, SALES_ESTIMATE_VERSION } from "@/lib/estimate/sales";
import { fetchAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";
import { evaluatePrediction, reviewRateBound, summarizeValidation, type PredictionEval, type RateBound, type ValidationSummary } from "@/lib/validation/engine";
import type { Json } from "@/types/database";

import { judgeTrackedKeywords } from "./keyword-opportunity";

/*
 * 검증 루프 (PHASE 30). 로그인 사용자 세션(RLS)으로만 읽고 쓴다.
 *   recordJudgePredictions  자동 발굴 파이프라인 단계 — 추적 키워드 상품의 판정 · 판매 추정을 기준일마다 한 번 predictions 에 남긴다 (수정 불가 표)
 *   getValidationReport     남긴 예측 ↔ 그 뒤 관찰(리뷰 증가 · 쿠팡 표시 하한) 비교
 */

export const PREDICTION_MODEL_VERSION = `${JUDGE_VERSION} · ${SALES_ESTIMATE_VERSION}`;
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export async function recordJudgePredictions(): Promise<{ candidates: number; inserted: number; skippedExisting: number; noSales: number }> {
  const supabase = await createClient();
  const { keywords } = await judgeTrackedKeywords();
  const rows: { product_id: string; model_version: string; target_period_start: string; target_period_end: string; sales_predicted: number; revenue_predicted: number | null; assumptions: Json }[] = [];
  const seen = new Set<string>();
  let noSales = 0;
  for (const k of keywords) {
    const start = k.snapshot?.capturedOn;
    if (!start) continue;
    for (const p of k.products) {
      if (seen.has(p.productId)) continue;
      seen.add(p.productId);
      const s = p.estimate?.sales;
      if (!s?.monthly) {
        noSales += 1;
        continue;
      }
      const j = p.judge;
      rows.push({
        product_id: p.productId,
        model_version: PREDICTION_MODEL_VERSION,
        target_period_start: start,
        target_period_end: addDays(start, 29),
        sales_predicted: s.monthly.mid,
        revenue_predicted: s.revenue?.mid ?? null,
        assumptions: {
          keyword: k.keyword,
          keywordId: k.keywordId,
          verdict: j.verdict,
          total: j.total,
          marketScore: j.marketScore,
          productScore: j.productScore,
          confidence: j.confidence,
          sales: s.monthly,
          salesConfidence: s.confidence,
          methods: s.methods.map((m) => m.method),
          buyersFloor: s.buyersFloor,
          monthlyReviews: s.monthlyReviews,
          price: p.estimate?.price ?? null,
          reviewCount: p.estimate?.reviewCount ?? null,
          risks: j.risks.map((r) => r.code),
        } as unknown as Json,
      });
    }
  }
  if (!rows.length) return { candidates: 0, inserted: 0, skippedExisting: 0, noSales };
  const starts = [...new Set(rows.map((r) => r.target_period_start))];
  const existing = await fetchAllRows((a, b) =>
    supabase.from("predictions").select("product_id, target_period_start").eq("model_version", PREDICTION_MODEL_VERSION).in("target_period_start", starts).order("id").range(a, b),
  );
  const have = new Set(existing.map((e) => `${e.product_id}:${e.target_period_start}`));
  const fresh = rows.filter((r) => !have.has(`${r.product_id}:${r.target_period_start}`));
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await supabase.from("predictions").insert(fresh.slice(i, i + 500));
    if (error) throw error;
  }
  return { candidates: rows.length, inserted: fresh.length, skippedExisting: rows.length - fresh.length, noSales };
}

export interface ValidationRow extends PredictionEval {
  name: string | null;
  keyword: string | null;
  verdict: string | null;
  sales: { min: number; mid: number; max: number };
}

export interface ValidationReport {
  asOf: string;
  modelVersions: string[];
  summary: ValidationSummary;
  rows: ValidationRow[];
  rateBounds: RateBound[];
  /** 내 상품 실제 판매 기록 (검증 3 — 판매 시작 뒤) */
  own: { listings: number; salesRows: number };
  firstPredictionOn: string | null;
}

export async function getValidationReport(): Promise<ValidationReport> {
  const supabase = await createClient();
  const asOf = kstToday();
  const [preds, snaps, badgeRows, prods, listings, sales] = await Promise.all([
    fetchAllRows((a, b) => supabase.from("predictions").select("product_id, model_version, target_period_start, sales_predicted, assumptions").like("model_version", "judge-%").order("id").range(a, b)),
    fetchAllRows((a, b) => supabase.from("product_snapshots").select("product_id, captured_on, review_count, is_excluded").not("review_count", "is", null).order("id").range(a, b)),
    fetchAllRows((a, b) =>
      supabase
        .from("import_rows")
        .select("record_key, mb:payload->collected->observedOnly->>monthlyBuyers")
        .like("record_key", "product\\_snapshot:%")
        .not("payload->collected->observedOnly->>monthlyBuyers", "is", null)
        .order("id")
        .range(a, b),
    ),
    fetchAllRows((a, b) => supabase.from("products").select("id, coupang_product_id, product_name").order("id").range(a, b)),
    supabase.from("my_listings").select("id", { count: "exact", head: true }),
    supabase.from("sales_results").select("id", { count: "exact", head: true }),
  ]);

  const nameOf = new Map(prods.map((p) => [p.id, p.product_name]));
  const idByCoupang = new Map(prods.map((p) => [p.coupang_product_id, p.id]));
  const reviewsOf = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    if (s.is_excluded || s.review_count == null) continue;
    const m = reviewsOf.get(s.product_id) ?? new Map<string, number>();
    m.set(s.captured_on, Math.max(m.get(s.captured_on) ?? 0, s.review_count));
    reviewsOf.set(s.product_id, m);
  }
  const badgesOf = new Map<string, { on: string; floor: number }[]>();
  for (const r of badgeRows) {
    const [, cid, day] = (r.record_key ?? "").split(":");
    const pid = idByCoupang.get(cid);
    const floor = parseBuyers(typeof r.mb === "string" ? r.mb : null);
    if (!pid || !day || floor == null) continue;
    badgesOf.set(pid, [...(badgesOf.get(pid) ?? []), { on: day, floor }]);
  }
  const reviewList = (id: string) => [...(reviewsOf.get(id) ?? new Map()).entries()].map(([on, count]) => ({ on, count }));

  const rows: ValidationRow[] = preds.map((p) => {
    const a = (p.assumptions ?? {}) as { sales?: { min: number; mid: number; max: number }; verdict?: string | null; keyword?: string | null };
    const salesRange = a.sales ?? { min: p.sales_predicted ?? 0, mid: p.sales_predicted ?? 0, max: p.sales_predicted ?? 0 };
    const e = evaluatePrediction(
      { productId: p.product_id, start: p.target_period_start, sales: salesRange, verdict: a.verdict ?? null, keyword: a.keyword ?? null, name: nameOf.get(p.product_id) ?? null },
      reviewList(p.product_id),
      badgesOf.get(p.product_id) ?? [],
      asOf,
    );
    return { ...e, name: nameOf.get(p.product_id) ?? null, keyword: a.keyword ?? null, verdict: a.verdict ?? null, sales: salesRange };
  });

  // 리뷰 작성률 상한: 표시 하한을 본 날 앞뒤 35일 안의 리뷰 증가 (7일 이상 간격)
  const rateBounds: RateBound[] = [];
  for (const [pid, badges] of badgesOf) {
    const b = [...badges].sort((x, y) => x.on.localeCompare(y.on)).at(-1)!;
    const near = reviewList(pid).filter((r) => Math.abs(Date.parse(r.on) - Date.parse(b.on)) <= 35 * DAY);
    const g = rateFromGrowth(near);
    if (!g) continue;
    const bound = reviewRateBound({ productId: pid, name: nameOf.get(pid) ?? null, floor: b.floor, monthlyReviews: g.perDay * 30 });
    if (bound) rateBounds.push(bound);
  }
  rateBounds.sort((x, y) => x.upper - y.upper);

  return {
    asOf,
    modelVersions: [...new Set(preds.map((p) => p.model_version))].sort(),
    summary: summarizeValidation(rows),
    rows: rows.sort((x, y) => (x.status === y.status ? (y.persistence?.ratio ?? -1) - (x.persistence?.ratio ?? -1) : x.status === "EVALUATED" ? -1 : y.status === "EVALUATED" ? 1 : 0)),
    rateBounds,
    own: { listings: listings.count ?? 0, salesRows: sales.count ?? 0 },
    firstPredictionOn: preds.length ? preds.map((p) => p.target_period_start).sort()[0] : null,
  };
}
