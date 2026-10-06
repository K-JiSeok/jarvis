// 로컬 검증용 PGlite(PostgreSQL WASM) 환경.
// Docker / Supabase CLI 없이 supabase/migrations 를 실제 PostgreSQL 엔진에 적용해 본다.
//
// Supabase 가 기본으로 제공하는 것 중 마이그레이션이 의존하는 부분만 흉내 낸다.
//  - 역할: anon, authenticated, service_role(BYPASSRLS)
//  - auth.users (id, email), auth.uid()  ← request.jwt.claim.sub / request.jwt.claims.sub
//  - extensions 스키마
//  - public 스키마 기본 권한 (Supabase 와 같이 anon/authenticated/service_role 에 ALL)
// 실제 Supabase 와의 차이는 docs/PHASE2_2_REPORT.md "PGlite 검증의 한계" 참고.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

/** Supabase 흉내 환경 + 모든 마이그레이션이 적용된 DB */
export async function createMigratedDb({ log = () => {} } = {}) {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
      log(`  ✓ ${file}`);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
  return db;
}
