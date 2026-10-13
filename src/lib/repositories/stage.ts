import "server-only";

import { productStage, sourcingScope, type StageRow, type StageResult } from "@/lib/discover/stage";
import { createClient } from "@/lib/supabase/server";

/*
 * 상품 단계 (PHASE 21) — 관심상품 · 판매 가능성(사용자 판단) · 공급 후보 연결에서 읽기만 한다. 사용자 RLS.
 * 쓰기(후보 선택 · 소싱 시작 · 제외)는 기존 관심상품 함수(repositories/watchlist)로 — 상태 이력은 기존 트리거가 기록.
 */

export async function loadStageRows(productIds?: string[]): Promise<StageRow[]> {
  const supabase = await createClient();
  let pq = supabase.from("products").select("id");
  if (productIds) pq = pq.in("id", productIds);
  const [{ data: prods, error }, { data: watch }, { data: comp }, { data: links }] = await Promise.all([
    pq,
    supabase.from("watchlist").select("product_id, status"),
    supabase.from("product_compliance").select("product_id, status, decided_by").eq("decided_by", "USER").eq("status", "BLOCKED"),
    supabase.from("product_supply_links").select("product_id, user_status"),
  ]);
  if (error) throw error;
  const watchOf = new Map((watch ?? []).map((w) => [w.product_id, w.status]));
  const blocked = new Set((comp ?? []).map((c) => c.product_id));
  const linksOf = new Map<string, string[]>();
  for (const l of links ?? []) linksOf.set(l.product_id, [...(linksOf.get(l.product_id) ?? []), l.user_status]);
  return prods.map((p) => ({ productId: p.id, watchStatus: watchOf.get(p.id) ?? null, blockedByUser: blocked.has(p.id), linkStatuses: linksOf.get(p.id) ?? [] }));
}

/** 소싱 대상 상품 ID — 사용자가 [소싱 시작]한 상품만 (판매 불가 · 제외 · 미검토 · 후보 단계는 빠짐) */
export async function listSourcingScope(): Promise<{ scope: string[]; total: number }> {
  const rows = await loadStageRows();
  return { scope: sourcingScope(rows), total: rows.length };
}

export async function stagesFor(productIds: string[]): Promise<Map<string, StageResult & { watchStatus: string | null }>> {
  const rows = await loadStageRows(productIds);
  return new Map(rows.map((r) => [r.productId, { ...productStage(r), watchStatus: r.watchStatus }]));
}
