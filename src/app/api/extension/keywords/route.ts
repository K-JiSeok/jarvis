import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";

/*
 * POST /api/extension/keywords — 검색 결과 자동 수집(PHASE 27)이 수집할 키워드 목록 (읽기 전용)
 *   → { ok, keywords: [{ keyword, lastCollectedOn }] }  추적 중(is_tracking)인 키워드만, 마지막 검색 수집일 포함
 * 인증 · CORS · 요청 제한은 /api/extension/lookup 과 같다. 사용자 토큰 = RLS → 본인 키워드만 보인다.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  const { origin, supabase } = ctx;

  const { data: kws, error } = await supabase.from("keywords").select("id, keyword").eq("is_tracking", true).order("keyword").limit(100);
  if (error) return apiJson(origin, { error: "조회 중 오류가 났습니다." }, 500);
  const ids = (kws ?? []).map((k) => k.id);
  const last = new Map<string, string>();
  if (ids.length) {
    const { data: ranks, error: e2 } = await supabase
      .from("keyword_product_ranks")
      .select("keyword_id, captured_on")
      .in("keyword_id", ids)
      .order("captured_on", { ascending: false })
      .limit(5000);
    if (e2) return apiJson(origin, { error: "조회 중 오류가 났습니다." }, 500);
    for (const r of ranks ?? []) if (!last.has(r.keyword_id)) last.set(r.keyword_id, r.captured_on);
  }
  return apiJson(origin, { ok: true, keywords: (kws ?? []).map((k) => ({ keyword: k.keyword, lastCollectedOn: last.get(k.id) ?? null })) });
}
