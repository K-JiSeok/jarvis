import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";
import { parseLookupRequest } from "@/lib/ingest/api-request";

/*
 * POST /api/extension/lookup — 검색 결과 상품 · 키워드가 JARVIS 에 등록돼 있는지 (PHASE 12, 읽기 전용)
 *   { keyword?, coupangProductIds: string[] (≤300) } → { keyword: { registered, id }, registered: [{ coupangProductId, productId, productName }] }
 * 인증 · CORS · 요청 제한은 /api/ingest 와 같다. 사용자 토큰 = RLS → 본인 데이터만 보인다.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  const { origin, supabase } = ctx;

  const parsed = parseLookupRequest(ctx.body);
  if (!parsed.ok) return apiJson(origin, { error: parsed.error }, parsed.status);

  const [products, keyword] = await Promise.all([
    parsed.coupangProductIds.length
      ? supabase.from("products").select("id, coupang_product_id, product_name").in("coupang_product_id", parsed.coupangProductIds)
      : Promise.resolve({ data: [], error: null }),
    parsed.keyword
      ? supabase.from("keywords").select("id, keyword").eq("normalized_keyword", parsed.keyword.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (products.error || keyword.error) return apiJson(origin, { error: "조회 중 오류가 났습니다." }, 500);

  return apiJson(origin, {
    ok: true,
    keyword: parsed.keyword ? { keyword: parsed.keyword, registered: !!keyword.data, id: keyword.data?.id ?? null } : null,
    registered: (products.data ?? []).map((p) => ({ coupangProductId: p.coupang_product_id, productId: p.id, productName: p.product_name })),
  });
}
