import "server-only";

import { createClient } from "@/lib/supabase/server";

/* 매일 오전 추천 (PHASE 24) 조회 · 응답. 추천을 만드는 것은 로컬 예약 작업(scripts/picks) — 화면은 읽기와 사용자 응답만 */

export interface DailyPick {
  id: string;
  pickDate: string;
  rank: number;
  productId: string;
  title: string;
  reason: string;
  risks: string[];
  sourcing: { targetCost?: number | null; searchTerms?: string[]; bundle?: string | null; note?: string | null };
  metrics: Record<string, unknown>;
  pickedBy: string;
  status: "NEW" | "SHORTLISTED" | "DISMISSED";
  createdAt: string;
}

export async function listDailyPicks(days = 7): Promise<DailyPick[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("daily_picks").select("*").gte("pick_date", since).order("pick_date", { ascending: false }).order("rank");
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    pickDate: r.pick_date,
    rank: r.rank,
    productId: r.product_id,
    title: r.title,
    reason: r.reason,
    risks: r.risks,
    sourcing: r.sourcing as DailyPick["sourcing"],
    metrics: r.metrics as Record<string, unknown>,
    pickedBy: r.picked_by,
    status: r.status as DailyPick["status"],
    createdAt: r.created_at,
  }));
}

export async function setPickStatus(id: string, status: DailyPick["status"]): Promise<{ productId: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("daily_picks").update({ status }).eq("id", id).select("product_id").maybeSingle();
  if (error) throw error;
  return data ? { productId: data.product_id } : null;
}
