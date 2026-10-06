/**
 * Supabase 공개 환경변수 (브라우저에 노출돼도 되는 값만).
 * SUPABASE_SERVICE_ROLE_KEY 는 여기서 읽지 않는다 → admin.ts (서버 전용)
 */
export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

export function getSupabaseEnv(): SupabasePublicEnv | null {
  // NEXT_PUBLIC_* 는 빌드 시 문자열로 치환되므로 반드시 리터럴로 접근한다.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** .env.local 이 설정되지 않았으면 false → 화면은 DEMO 데이터로 동작한다. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export function requireSupabaseEnv(): SupabasePublicEnv {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.example 을 .env.local 로 복사하고 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 입력하세요.",
    );
  }
  return env;
}
