// node scripts/costs/seed-sql.mjs > out.sql
// 공식 페이지에서 옮겨 적은 요율(fixtures/coupang-rates-*.json) → cost_rate_cards 시스템 행(owner_id NULL) INSERT 문.
// 마이그레이션에 붙여 넣는 용도. 요율이 바뀌면 새 확인일의 JSON 을 만들고 새 마이그레이션으로 새 행을 추가한다 (기존 행 수정 금지).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRows } from "./cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, "fixtures", "coupang-rates-2026-10-13.json");
const d = JSON.parse(readFileSync(file, "utf8"));

const rows = buildRows(d);

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
console.log("insert into public.cost_rate_cards (owner_id, kind, scope, rates, vat_basis, valid_from, promo_until, source_url, source_label, checked_on, verification, note) values");
console.log(
  rows
    .map((r) => `  (null, ${q(r.kind)}, ${q(r.scope)}, ${q(JSON.stringify(r.rates))}::jsonb, ${q(r.vat)}, ${q(r.validFrom)}, ${q(r.promoUntil)}, ${q(r.url)}, ${q(r.label)}, ${q(d.checkedAt)}, 'OFFICIAL_MANUAL', ${q(r.note)})`)
    .join(",\n") + ";",
);
