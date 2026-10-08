import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  allowedOrigins,
  bearerToken,
  isAllowedOrigin,
  MAX_BODY_BYTES,
  parseIngestRequest,
  RateLimiter,
} from "@/lib/ingest/api-request";
import { IngestInputError, ingestCollected } from "@/lib/ingest/service";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/*
 * POST /api/ingest — JARVIS 확장 프로그램 수집 데이터 저장 (PHASE 11)
 *
 *   Origin 검사 → Bearer 토큰(Supabase access token) 검증 → 요청 제한 → 본문 크기 · 모양 검사
 *     → ingestCollected() → normalize → ingest_batch (사용자 토큰 클라이언트 = RLS, service role 쓰지 않음)
 *
 * 인증: 확장 프로그램이 JARVIS 계정으로 직접 로그인해 받은 Supabase 세션 토큰. 쿠키 세션은 쓰지 않는다.
 * CORS: 등록된 확장 프로그램 origin 만 (기본 = 고정 확장 프로그램 ID, 추가는 JARVIS_EXTENSION_ORIGINS). "*" 를 쓰지 않는다.
 * POST 외 메서드는 Next 가 405 로 응답한다 (OPTIONS 는 아래 preflight).
 */

const ORIGINS = allowedOrigins(process.env.JARVIS_EXTENSION_ORIGINS);
// 사용자당 1분 30회 (수집 버튼 · 재시도 기준으로 충분, 반복 호출 차단)
const limiter = new RateLimiter(30, 60_000);

function cors(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

const json = (origin: string | null, body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...cors(origin), "Cache-Control": "no-store", ...extra } });

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !ORIGINS.includes(origin)) return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, ORIGINS)) return json(null, { error: "허용되지 않은 출처입니다." }, 403);

  const env = getSupabaseEnv();
  if (!env) return json(origin, { error: "서버에 Supabase 설정이 없습니다." }, 503);

  // 인증 (본문을 읽기 전에)
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return json(origin, { error: "로그인이 필요합니다 (Authorization: Bearer)." }, 401);
  const supabase = createClient<Database>(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  if (authError || !claims?.claims?.sub || claims.claims.role !== "authenticated") {
    return json(origin, { error: "로그인이 만료됐거나 올바르지 않습니다. 확장 프로그램에서 다시 로그인하세요." }, 401);
  }
  const userId = claims.claims.sub;

  const retryAfter = limiter.take(userId);
  if (retryAfter > 0) return json(origin, { error: `요청이 너무 많습니다. ${retryAfter}초 뒤에 다시 시도하세요.` }, 429, { "Retry-After": String(retryAfter) });

  // 크기 제한
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(origin, { error: `요청이 너무 큽니다 (최대 ${MAX_BODY_BYTES / 1024 / 1024}MB).` }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return json(origin, { error: `요청이 너무 큽니다 (최대 ${MAX_BODY_BYTES / 1024 / 1024}MB).` }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(origin, { error: "JSON 본문이 필요합니다." }, 400);
  }

  const parsed = parseIngestRequest(body);
  if (!parsed.ok) return json(origin, { error: parsed.error }, parsed.status);
  const { products, searches, keywords, idempotencyKey, tool } = parsed.batch;

  try {
    const outcome = await ingestCollected({ products, searches, keywords, idempotencyKey, tool }, { client: supabase, channel: "EXTENSION" });
    if (!outcome.ok) {
      return json(origin, { ok: false, error: "저장 중 오류가 나서 전부 취소했습니다 (저장된 데이터 없음).", code: outcome.code, jobId: outcome.failedJob?.id ?? null }, 500);
    }
    const job = outcome.job;
    // 실패 사유별 개수 · 미등록 상품 목록 (확장 프로그램 결과 화면용)
    const { data: failedRows } = await supabase
      .from("import_rows")
      .select("row_number, kind:target_table, error_code, error_message, payload")
      .eq("import_job_id", job.id)
      .eq("result", "FAILED")
      .order("row_number")
      .limit(500);
    const failures: Record<string, number> = {};
    const notFound: { coupangProductId: string | null; productName: string | null; rank: number | null; isAd: boolean | null }[] = [];
    for (const r of failedRows ?? []) {
      const code = r.error_code ?? "UNKNOWN";
      failures[code] = (failures[code] ?? 0) + 1;
      if (code === "PRODUCT_NOT_FOUND") {
        const c = ((r.payload as Record<string, unknown> | null)?.collected ?? {}) as Record<string, unknown>;
        notFound.push({
          coupangProductId: (c.coupangProductId as string) ?? null,
          productName: (c.productName as string) ?? null,
          rank: (c.rank as number) ?? null,
          isAd: (c.isAd as boolean) ?? null,
        });
      }
    }
    return json(origin, {
      ok: true,
      replay: outcome.replay,
      jobId: job.id,
      status: job.status,
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
    if (error instanceof IngestInputError) return json(origin, { error: error.message }, 400);
    return json(origin, { error: "서버 오류" }, 500);
  }
}
