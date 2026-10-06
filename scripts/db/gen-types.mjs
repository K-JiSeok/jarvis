// npm run db:types:local
// supabase/migrations 를 PGlite 에 적용한 뒤 카탈로그를 읽어 src/types/database.ts 를 만든다.
// `supabase gen types typescript` 와 같은 모양(Tables / Views / Functions, Row / Insert / Update / Relationships)이다.
// Supabase 프로젝트를 연결한 뒤에는 공식 명령(npm run db:types)으로 덮어쓴다.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, createMigratedDb } from "./pglite.mjs";

const OUT = join(ROOT, "src", "types", "database.ts");

const STRING = new Set(["uuid", "text", "bpchar", "varchar", "date", "timestamptz", "timestamp", "time", "timetz", "interval"]);
const NUMBER = new Set(["int2", "int4", "int8", "float4", "float8", "numeric"]);

function tsType({ base, is_array }) {
  let t = "unknown";
  if (STRING.has(base)) t = "string";
  else if (NUMBER.has(base)) t = "number";
  else if (base === "bool") t = "boolean";
  else if (base === "json" || base === "jsonb") t = "Json";
  return is_array ? `${t}[]` : t;
}

const key = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name));

const db = await createMigratedDb();

// 컬럼: DOMAIN 은 기반 타입, 배열은 원소 타입으로 푼다
const { rows: columns } = await db.query(`
  select c.relname as relation, c.relkind as kind, a.attname as name, a.attnum,
         a.attnotnull as not_null, a.atthasdef as has_default, a.attidentity as identity, a.attgenerated as generated,
         coalesce(bt.typname, t.typname) as type_name,
         t.typcategory = 'A' as is_array,
         coalesce(ebt.typname, et.typname) as elem_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_type bt on t.typtype = 'd' and bt.oid = t.typbasetype
  left join pg_type et on t.typcategory = 'A' and et.oid = t.typelem
  left join pg_type ebt on et.typtype = 'd' and ebt.oid = et.typbasetype
  where c.relkind in ('r', 'v')
  order by c.relname, a.attnum`);

// FK 관계 (public 안에서만, supabase gen types 와 동일)
const { rows: fks } = await db.query(`
  select c.conname, child.relname as relation, parent.relname as referenced,
         array(select a.attname from unnest(c.conkey) with ordinality k(n, i)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i)::text[] as columns,
         array(select a.attname from unnest(c.confkey) with ordinality k(n, i)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i)::text[] as referenced_columns,
         exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisunique and i.indpred is null
                 and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x)
                   = (select array_agg(x order by x) from unnest(c.conkey) x)) as one_to_one
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace pn on pn.oid = parent.relnamespace and pn.nspname = 'public'
  where c.contype = 'f'
  order by child.relname, c.conname`);

// RPC 로 부를 수 있는 함수 (트리거 함수 제외)
const { rows: fns } = await db.query(`
  select p.proname as name,
         coalesce(p.proargnames, '{}') as arg_names,
         array(select coalesce(bt.typname, t.typname) from unnest(p.proargtypes) with ordinality a(oid, i)
               join pg_type t on t.oid = a.oid left join pg_type bt on t.typtype = 'd' and bt.oid = t.typbasetype
               order by a.i)::text[] as arg_types,
         coalesce(rbt.typname, rt.typname) as return_type
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_type rt on rt.oid = p.prorettype
  left join pg_type rbt on rt.typtype = 'd' and rbt.oid = rt.typbasetype
  where rt.typname <> 'trigger'
  order by p.proname`);

await db.close();

const relations = new Map();
for (const col of columns) {
  if (!relations.has(col.relation)) relations.set(col.relation, { kind: col.kind, columns: [] });
  relations.get(col.relation).columns.push({
    ...col,
    base: col.is_array ? col.elem_name : col.type_name,
  });
}

const I = (n) => "  ".repeat(n);

function relationshipsBlock(relation, depth) {
  const list = fks.filter((f) => f.relation === relation);
  if (!list.length) return `${I(depth)}Relationships: []`;
  const items = list.map(
    (f) =>
      `${I(depth + 1)}{\n` +
      `${I(depth + 2)}foreignKeyName: ${JSON.stringify(f.conname)}\n` +
      `${I(depth + 2)}columns: ${JSON.stringify(f.columns)}\n` +
      `${I(depth + 2)}isOneToOne: ${f.one_to_one}\n` +
      `${I(depth + 2)}referencedRelation: ${JSON.stringify(f.referenced)}\n` +
      `${I(depth + 2)}referencedColumns: ${JSON.stringify(f.referenced_columns)}\n` +
      `${I(depth + 1)}},`,
  );
  return `${I(depth)}Relationships: [\n${items.join("\n")}\n${I(depth)}]`;
}

function tableBlock(name, rel) {
  const d = 4;
  const row = rel.columns.map((c) => `${I(d + 1)}${key(c.name)}: ${tsType(c)}${c.not_null ? "" : " | null"}`);
  const insert = rel.columns.map((c) => {
    if (c.generated || c.identity === "a") return `${I(d + 1)}${key(c.name)}?: never`;
    const optional = !c.not_null || c.has_default || c.identity;
    return `${I(d + 1)}${key(c.name)}${optional ? "?" : ""}: ${tsType(c)}${c.not_null ? "" : " | null"}`;
  });
  const update = rel.columns.map((c) => {
    if (c.generated || c.identity === "a") return `${I(d + 1)}${key(c.name)}?: never`;
    return `${I(d + 1)}${key(c.name)}?: ${tsType(c)}${c.not_null ? "" : " | null"}`;
  });
  return [
    `${I(3)}${name}: {`,
    `${I(d)}Row: {`,
    ...row,
    `${I(d)}}`,
    `${I(d)}Insert: {`,
    ...insert,
    `${I(d)}}`,
    `${I(d)}Update: {`,
    ...update,
    `${I(d)}}`,
    relationshipsBlock(name, d),
    `${I(3)}}`,
  ].join("\n");
}

function viewBlock(name, rel) {
  const d = 4;
  // supabase gen types 와 같이 뷰 컬럼은 모두 nullable
  const row = rel.columns.map((c) => `${I(d + 1)}${key(c.name)}: ${tsType(c)} | null`);
  return [`${I(3)}${name}: {`, `${I(d)}Row: {`, ...row, `${I(d)}}`, relationshipsBlock(name, d), `${I(3)}}`].join("\n");
}

function functionBlock(fn) {
  const d = 4;
  const args = fn.arg_names.length
    ? `{\n${fn.arg_names.map((a, i) => `${I(d + 1)}${key(a)}: ${tsType({ base: fn.arg_types[i] })}`).join("\n")}\n${I(d)}}`
    : "never";
  const returns = fn.return_type === "void" ? "undefined" : tsType({ base: fn.return_type });
  return `${I(3)}${fn.name}: {\n${I(d)}Args: ${args}\n${I(d)}Returns: ${returns}\n${I(3)}}`;
}

const tables = [...relations].filter(([, r]) => r.kind === "r");
const views = [...relations].filter(([, r]) => r.kind === "v");

const out = `// ⚠️ 자동 생성 파일 — 직접 수정하지 않는다.
// 생성: npm run db:types:local (scripts/db/gen-types.mjs, supabase/migrations 기준)
// Supabase 프로젝트 연결 후에는 npm run db:types (supabase gen types) 결과로 교체한다. 모양은 동일하다.
//
// DB 레벨 원시 타입이다. DOMAIN(source_type_t 등)은 string 으로 나온다.
// 앱에서 쓰는 좁은 타입(SourceType, Confidence …)은 src/types/common.ts, 연결은 src/types/db.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
${tables.map(([n, r]) => tableBlock(n, r)).join("\n")}
    }
    Views: {
${views.map(([n, r]) => viewBlock(n, r)).join("\n")}
    }
    Functions: {
${fns.map(functionBlock).join("\n")}
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> = (PublicSchema["Tables"] &
  PublicSchema["Views"])[T]["Row"]

export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
`;

writeFileSync(OUT, out);
console.log(`${OUT} — 테이블 ${tables.length}개, 뷰 ${views.length}개, 함수 ${fns.length}개`);
