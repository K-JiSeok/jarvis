import "server-only";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * 로그인한 사용자. JWT 서명을 검증한 claims 기준이다 (getSession 의 쿠키 값은 신뢰하지 않는다).
 * Supabase 미설정이거나 로그인하지 않았으면 null.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  return { id: data.claims.sub, email: data.claims.email ?? null };
}

/** 로그인 후 이동할 경로. 같은 사이트 안의 경로만 허용한다 (//evil.com 같은 외부 이동 방지). */
export function safeRedirectPath(value: unknown, fallback = "/settings"): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : fallback;
}
