import Link from "next/link";

import { signOut } from "@/app/login/actions";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** 사이드바 하단: 로그인 상태 + 로그인/로그아웃 */
export async function AuthStatus() {
  if (!isSupabaseConfigured()) {
    return <span>DEMO 모드 (DB 미연결)</span>;
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href="/login" className="text-foreground font-medium hover:underline">
        로그인
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate" title={user.email ?? undefined}>
        {user.email}
      </span>
      <form action={signOut}>
        <button type="submit" className="text-foreground shrink-0 font-medium hover:underline">
          로그아웃
        </button>
      </form>
    </div>
  );
}
