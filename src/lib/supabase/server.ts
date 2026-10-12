import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

import { requireSupabaseEnv } from "./env";

/*
 * 요청 단위 클라이언트 바꾸기 (PHASE 17): 확장 프로그램 Bearer 토큰으로 들어온 자동 실행(/api/automation/run)은 쿠키가 없다.
 * 그 요청 안에서만 사용자 토큰 클라이언트(= 같은 RLS)를 쓰도록 해서, 기존 조회 함수(createClient 를 부르는 것들)를 그대로 재사용한다.
 * service role 이 아니다 — 권한은 그 사용자의 것뿐이다.
 */
const scoped = new AsyncLocalStorage<SupabaseClient<Database>>();

export function withSupabaseClient<T>(client: SupabaseClient<Database>, fn: () => Promise<T>): Promise<T> {
  return scoped.run(client, fn);
}

/**
 * Server Component / Route Handler / Server Function 용 Supabase 클라이언트.
 * 요청마다 새로 만든다. anon 키 + 쿠키의 사용자 세션으로 동작하므로 RLS 가 적용된다.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const override = scoped.getStore();
  if (override) return override;

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
