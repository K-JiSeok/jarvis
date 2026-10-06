import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

import { requireSupabaseEnv } from "./env";

/**
 * Server Component / Route Handler / Server Function 용 Supabase 클라이언트.
 * 요청마다 새로 만든다. anon 키 + 쿠키의 사용자 세션으로 동작하므로 RLS 가 적용된다.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 에서는 쿠키를 쓸 수 없다.
          // 세션 갱신은 로그인 기능을 붙일 때 proxy 에서 처리한다.
        }
      },
    },
  });
}
