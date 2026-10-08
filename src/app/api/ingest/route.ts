import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";
import { parseIngestRequest } from "@/lib/ingest/api-request";
import { jobOutcome } from "@/lib/ingest/outcome";
import { IngestInputError, ingestCollected } from "@/lib/ingest/service";
import { jobFailureSummary } from "@/lib/repositories/ingest";

/*
 * POST /api/ingest — JARVIS 확장 프로그램 수집 데이터 저장 (PHASE 11)
 *
 *   Origin 검사 → Bearer 토큰(Supabase access token) 검증 → 요청 제한 → 본문 크기 · 모양 검사
 *     → ingestCollected() → normalize → ingest_batch (사용자 토큰 클라이언트 = RLS, service role 쓰지 않음)
 *
 * 인증: 확장 프로그램이 JARVIS 계정으로 직접 로그인해 받은 Supabase 세션 토큰. 쿠키 세션은 쓰지 않는다.
 * CORS: 등록된 확장 프로그램 origin 만 (기본 = 고정 확장 프로그램 ID, 추가는 JARVIS_EXTENSION_ORIGINS). "*" 를 쓰지 않는다.
 * POST 외 메서드는 Next 가 405 로 응답한다 (OPTIONS 는 preflight).
 * 공통 검사는 src/lib/ingest/api-auth.ts (PHASE 12 에서 옮김, 동작 같음). 응답에 outcome(결과 상태)이 더해졌다.
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  const { origin, supabase } = ctx;

  const parsed = parseIngestRequest(ctx.body);
  if (!parsed.ok) return apiJson(origin, { error: parsed.error }, parsed.status);
  const { products, searches, keywords, idempotencyKey, tool } = parsed.batch;

  try {
    const outcome = await ingestCollected({ products, searches, keywords, idempotencyKey, tool }, { client: supabase, channel: "EXTENSION" });
    if (!outcome.ok) {
      return apiJson(origin, { ok: false, error: "저장 중 오류가 나서 전부 취소했습니다 (저장된 데이터 없음).", code: outcome.code, jobId: outcome.failedJob?.id ?? null, outcome: "FAILED" }, 500);
    }
    const job = outcome.job;
    const { failures, notFound } = await jobFailureSummary(supabase, job.id);
    return apiJson(origin, {
      ok: true,
      replay: outcome.replay,
      jobId: job.id,
      status: job.status,
      outcome: jobOutcome(job),
      total: job.total_rows,
      inserted: job.inserted_rows,
      updated: job.updated_rows,
      skipped: job.skipped_rows,
      failed: job.failed_rows,
      failures,
      notFound: notFound.slice(0, 100),
      issues: outcome.issues.slice(0, 50),
      jarvisPath: `/import?job=${job.id}`,
      elapsedMs: outcome.elapsedMs,
    });
  } catch (error) {
    if (error instanceof IngestInputError) return apiJson(origin, { error: error.message }, 400);
    return apiJson(origin, { error: "서버 오류" }, 500);
  }
}
