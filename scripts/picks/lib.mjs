// 매일 오전 추천 (PHASE 24) 공용: .env.local 읽기 · 서버 전용 Supabase 클라이언트 · 소유자 확인
// 이 PC 에서만 실행하는 로컬 스크립트다. service role 키는 출력 · 로그 · 파일에 남기지 않는다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

export function adminClient() {
  const env = loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(".env.local 에 Supabase 주소 또는 서버 전용 키가 없습니다");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 상품을 가진 사용자가 한 명이면 그 사용자. 여럿이면 --owner 로 지정해야 한다 (다른 사용자 데이터를 섞지 않도록) */
export async function resolveOwner(db, argv) {
  const i = argv.indexOf("--owner");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const { data, error } = await db.from("products").select("owner_id").limit(5000);
  if (error) throw error;
  const owners = [...new Set(data.map((r) => r.owner_id))];
  if (owners.length !== 1) throw new Error(`상품을 가진 사용자가 ${owners.length}명입니다 — --owner <uuid> 로 지정하세요`);
  return owners[0];
}

export const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
