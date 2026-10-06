import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { requireSupabaseEnv } from "./env";

/**
 * service_role 클라이언트 — RLS 를 우회한다.
 *
 * - 서버 전용 (server-only: Client Component 에서 import 하면 빌드가 실패한다).
 * - 브라우저·Chrome Extension 에 키를 넣지 않는다.
 * - auth.uid() 가 없으므로 INSERT 시 owner_id 를 반드시 직접 지정한다.
 * - 배치 작업(import 처리 등)처럼 사용자 세션이 없는 경우에만 쓴다. 일반 조회는 server.ts 를 쓴다.
 */
export function createAdminClient() {
  const { url } = requireSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 가 없습니다 (.env.local, 서버 전용).");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
