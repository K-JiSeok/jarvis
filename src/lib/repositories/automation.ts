import "server-only";

import type { ComplianceFinding, ComplianceStatus } from "@/lib/automation/compliance";
import type { StepResult } from "@/lib/automation/pipeline";
import { createClient } from "@/lib/supabase/server";

/* 자동 발굴 결과 조회 (PHASE 17, 읽기 전용) */

export interface AutomationRunView {
  id: string;
  triggeredBy: "MANUAL" | "EXTENSION_ALARM";
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  steps: StepResult[];
  summary: Record<string, unknown>;
  error: string | null;
}

export async function listAutomationRuns(limit = 5): Promise<AutomationRunView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("automation_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    triggeredBy: r.triggered_by as AutomationRunView["triggeredBy"],
    status: r.status as AutomationRunView["status"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    steps: (r.steps as unknown as StepResult[]) ?? [],
    summary: (r.summary as Record<string, unknown>) ?? {},
    error: r.error,
  }));
}

export interface KeywordCandidateView {
  id: string;
  keyword: string;
  seedKeyword: string;
  monthlyPc: number | null;
  monthlyMobile: number | null;
  searchVolume: number | null;
  below10: boolean;
  compIdx: string | null;
  status: "NEW" | "PROMOTED" | "DISMISSED";
  firstSeenAt: string;
  lastSeenOn: string;
  seenCount: number;
}

export async function listKeywordCandidates({ status = "NEW", limit = 30 }: { status?: KeywordCandidateView["status"]; limit?: number } = {}) {
  const supabase = await createClient();
  const [{ data, error }, counts] = await Promise.all([
    supabase.from("keyword_candidates").select("*").eq("status", status).order("search_volume", { ascending: false, nullsFirst: false }).order("keyword").limit(limit),
    Promise.all(
      (["NEW", "PROMOTED", "DISMISSED"] as const).map(async (s) => {
        const { count } = await supabase.from("keyword_candidates").select("id", { count: "exact", head: true }).eq("status", s);
        return [s, count ?? 0] as const;
      }),
    ),
  ]);
  if (error) throw error;
  const { count: below10 } = await supabase.from("keyword_candidates").select("id", { count: "exact", head: true }).eq("status", "NEW").eq("below_10", true);
  return {
    items: data.map(
      (c): KeywordCandidateView => ({
        id: c.id,
        keyword: c.keyword,
        seedKeyword: c.seed_keyword,
        monthlyPc: c.monthly_pc,
        monthlyMobile: c.monthly_mobile,
        searchVolume: c.search_volume,
        below10: c.below_10,
        compIdx: c.comp_idx,
        status: c.status as KeywordCandidateView["status"],
        firstSeenAt: c.first_seen_at,
        lastSeenOn: c.last_seen_on,
        seenCount: c.seen_count,
      }),
    ),
    counts: Object.fromEntries(counts) as Record<KeywordCandidateView["status"], number>,
    newBelow10: below10 ?? 0,
  };
}

export interface ComplianceView {
  productId: string;
  status: ComplianceStatus;
  findings: ComplianceFinding[];
  decidedBy: "AUTO" | "USER";
  ruleVersion: string | null;
  userNote: string | null;
  checkedAt: string;
}

export async function listCompliance(productIds?: string[]): Promise<Map<string, ComplianceView>> {
  const supabase = await createClient();
  let q = supabase.from("product_compliance").select("*");
  if (productIds) q = q.in("product_id", productIds);
  const { data, error } = await q;
  if (error) throw error;
  return new Map(
    data.map((c) => [
      c.product_id,
      {
        productId: c.product_id,
        status: c.status as ComplianceStatus,
        findings: (c.findings as unknown as ComplianceFinding[]) ?? [],
        decidedBy: c.decided_by as "AUTO" | "USER",
        ruleVersion: c.rule_version,
        userNote: c.user_note,
        checkedAt: c.checked_at,
      },
    ]),
  );
}
