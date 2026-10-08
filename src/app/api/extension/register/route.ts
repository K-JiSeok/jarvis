import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";
import { parseRegisterRequest } from "@/lib/ingest/api-request";
import { jobOutcome } from "@/lib/ingest/outcome";
import { IngestInputError, registerSelected } from "@/lib/ingest/service";
import { jobKindSummary } from "@/lib/repositories/ingest";

/*
 * POST /api/extension/register — 검색 결과에서 사용자가 고른 상품 등록 + 검색 데이터 저장 (PHASE 12)
 *
 *   { idempotencyKey, tool, version, records: [search · product · keyword …],  ← /api/ingest 와 같은 형식 · 검사
 *     products: [{ coupangProductId, productName }],                           ← 사용자가 체크한 상품만 (검색 결과 안의 상품이어야 함)
 *     registerKeyword?: "검색어" }                                            ← [키워드도 등록] 을 고른 경우만
 *   → register_products_and_ingest (상품 · 키워드 생성 + ingest_batch 한 트랜잭션, 저장 행 하나라도 실패하면 전부 롤백)
 *
 * 자동 등록 없음: 서버는 products 에 온 상품만 만든다.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  const { origin, supabase } = ctx;

  const parsed = parseRegisterRequest(ctx.body);
  if (!parsed.ok) return apiJson(origin, { error: parsed.error }, parsed.status);
  const { batch, products, keyword } = parsed.request;

  try {
    const r = await registerSelected(batch, { products, keyword }, supabase);
    if (!r.ok) {
      return apiJson(
        origin,
        {
          ok: false,
          rolledBack: true,
          error: "저장 중 오류가 나서 이번 작업을 전부 되돌렸습니다 (상품 등록 · 데이터 저장 모두 취소).",
          detail: r.detail ?? r.error,
          jobId: r.failedJob?.id ?? null,
          outcome: "FAILED",
          selected: products.length,
        },
        500,
      );
    }
    return apiJson(origin, {
      ok: true,
      replay: r.replay,
      jobId: r.job.id,
      status: r.job.status,
      outcome: jobOutcome(r.job),
      selected: products.length,
      createdProducts: r.createdProducts,
      existingProducts: r.existingProducts,
      keywordCreated: r.keywordCreated,
      kinds: await jobKindSummary(supabase, r.job.id),
      total: r.job.total_rows,
      inserted: r.job.inserted_rows,
      updated: r.job.updated_rows,
      skipped: r.job.skipped_rows,
      failed: r.job.failed_rows,
      issues: r.issues.slice(0, 50),
      jarvisPath: `/import?job=${r.job.id}`,
      elapsedMs: r.elapsedMs,
    });
  } catch (error) {
    if (error instanceof IngestInputError) return apiJson(origin, { error: error.message }, 400);
    return apiJson(origin, { error: "서버 오류" }, 500);
  }
}
