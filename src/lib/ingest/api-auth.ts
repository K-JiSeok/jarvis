import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import { allowedOrigins, bearerToken, isAllowedOrigin, MAX_BODY_BYTES, RateLimiter } from "./api-request";

/*
 * 확장 프로그램 API 공통 (PHASE 11 /api/ingest 의 검사를 그대로 옮긴 것 — PHASE 12 의 lookup · register 도 같은 검사를 쓴다)
 *   Origin(확장 프로그램만) → Bearer 토큰 서명 검증 → 사용자별 요청 제한(모든 확장 프로그램 API 합산) → 본문 크기
 * service role 을 쓰지 않는다. 사용자 토큰으로 만든 클라이언트 = RLS.
 */

const ORIGINS = allowedOrigins(process.env.JARVIS_EXTENSION_ORIGINS);
// 사용자당 1분 30회 (수집 버튼 · 재시도 기준으로 충분, 반복 호출 차단)
const limiter = new RateLimiter(30, 60_000);

export function cors(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export const apiJson = (origin: string | null, body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...cors(origin), "Cache-Control": "no-store", ...extra } });

export function preflight(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !ORIGINS.includes(origin)) return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export interface ApiContext {
  origin: string | null;
  supabase: SupabaseClient<Database>;
  userId: string;
  body: unknown;
}

/** 인증 · 요청 제한 · 본문 읽기. 실패하면 바로 돌려줄 응답 */
export async function authenticate(request: Request): Promise<ApiContext | NextResponse> {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, ORIGINS)) return apiJson(null, { error: "허용되지 않은 출처입니다." }, 403);

  const env = getSupabaseEnv();
  if (!env) return apiJson(origin, { error: "서버에 Supabase 설정이 없습니다." }, 503);

  // 인증 (본문을 읽기 전에)
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return apiJson(origin, { error: "로그인이 필요합니다 (Authorization: Bearer)." }, 401);
  const supabase = createClient<Database>(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  if (authError || !claims?.claims?.sub || claims.claims.role !== "authenticated") {
    return apiJson(origin, { error: "로그인이 만료됐거나 올바르지 않습니다. 확장 프로그램에서 다시 로그인하세요." }, 401);
  }
  const userId = claims.claims.sub;

  const retryAfter = limiter.take(userId);
  if (retryAfter > 0) return apiJson(origin, { error: `요청이 너무 많습니다. ${retryAfter}초 뒤에 다시 시도하세요.` }, 429, { "Retry-After": String(retryAfter) });

  // 크기 제한
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return apiJson(origin, { error: `요청이 너무 큽니다 (최대 ${MAX_BODY_BYTES / 1024 / 1024}MB).` }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return apiJson(origin, { error: `요청이 너무 큽니다 (최대 ${MAX_BODY_BYTES / 1024 / 1024}MB).` }, 413);
  try {
    return { origin, supabase, userId, body: JSON.parse(text) };
  } catch {
    return apiJson(origin, { error: "JSON 본문이 필요합니다." }, 400);
  }
}
