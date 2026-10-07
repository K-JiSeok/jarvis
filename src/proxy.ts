import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/**
 * 매 요청마다 Supabase 세션 쿠키를 갱신한다 (Server Component 는 쿠키를 쓸 수 없으므로 여기서 처리).
 * 접근 제어(리다이렉트)는 하지 않는다. DEMO 화면은 로그인 없이 볼 수 있고,
 * 실제 데이터는 RLS 가 로그인 사용자 본인 것만 돌려준다.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = getSupabaseEnv();
  if (!env) return response;

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // 세션 쿠키가 담긴 응답이 CDN 에 캐시되지 않도록
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // 토큰이 만료됐으면 여기서 갱신되고 setAll 로 새 쿠키가 응답에 실린다.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
