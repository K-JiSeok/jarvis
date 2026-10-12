import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";
import { runDiscoveryPipeline } from "@/lib/automation/pipeline";
import { withSupabaseClient } from "@/lib/supabase/server";

/*
 * POST /api/automation/run — 확장 프로그램 예약 실행 (chrome.alarms, PHASE 17)
 *
 *   확장 프로그램 Origin · Bearer 토큰 · 사용자별 요청 제한 (기존 확장 프로그램 API 와 같은 검사)
 *   → 이 요청 안에서만 사용자 토큰 클라이언트로 기존 함수 재사용 (RLS 그대로, service role 없음)
 *   → 자동 발굴 파이프라인. 마지막 실행 뒤 20시간 안이면 건너뜀 · 실행 중이면 거부 (중복 실행 방지)
 */

export const OPTIONS = preflight;

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  try {
    const r = await withSupabaseClient(ctx.supabase, () => runDiscoveryPipeline(ctx.userId, "EXTENSION_ALARM"));
    if (!r.ok) return apiJson(ctx.origin, { ok: false, skipped: true, reason: r.reason, message: r.message, runId: r.runId }, 200);
    return apiJson(ctx.origin, {
      ok: r.status !== "FAILED",
      runId: r.runId,
      status: r.status,
      steps: r.steps.map((s) => ({ name: s.name, status: s.status, error: s.error ?? null })),
      summary: r.summary,
    });
  } catch {
    return apiJson(ctx.origin, { ok: false, error: "서버 오류" }, 500);
  }
}
