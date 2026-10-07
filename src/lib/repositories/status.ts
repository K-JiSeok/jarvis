import "server-only";

import { createClient } from "@/lib/supabase/server";

const COUNTED_TABLES = ["keywords", "products", "product_snapshots", "watchlist", "import_jobs"] as const;
export type CountedTable = (typeof COUNTED_TABLES)[number];

/** 로그인 사용자 본인 데이터 행 수 (RLS 가 owner_id = 본인 행만 센다) */
export async function countMyRows(): Promise<Record<CountedTable, number>> {
  const supabase = await createClient();
  const entries = await Promise.all(
    COUNTED_TABLES.map(async (table) => {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) throw error;
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CountedTable, number>;
}
