import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

import { requireSupabaseEnv } from "./env";

/**
 * Client Component 용 Supabase 클라이언트 (anon 키 + 로그인 사용자 세션, RLS 적용).
 * 호출 전에 isSupabaseConfigured() 로 확인한다.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
