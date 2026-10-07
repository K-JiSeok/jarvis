import "server-only";

import { normalizeKeyword } from "@/lib/keywords";
import {
  toCategoryOption,
  toKeywordDetail,
  toKeywordSnapshotView,
  toKeywordSummary,
} from "@/lib/mappers/keyword";
import { createClient } from "@/lib/supabase/server";
import type { Confidence } from "@/types/common";
import type { Json, KeywordLatestRow } from "@/types/db";
import type { CategoryOption, KeywordDetail, KeywordSummary } from "@/types/keyword";

export { normalizeKeyword };

/*
 * 키워드 repository. 모든 조회·저장은 로그인 사용자 세션(server.ts)으로 한다 → RLS 가 본인 행만 허용.
 * 스냅샷 저장·제외는 반드시 upsert_keyword_snapshot() 을 거친다 (NULL 유지 규칙, import 충돌 검사와 일관).
 */

// 조회 ---------------------------------------------------------------------------

export async function listCategories(): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, path")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data.map(toCategoryOption);
}

async function categoryMap(): Promise<Map<string, CategoryOption>> {
  return new Map((await listCategories()).map((c) => [c.id, c]));
}

/** 키워드 목록 (현재 값 포함). 추적 중인 키워드 먼저 */
export async function listKeywords(): Promise<KeywordSummary[]> {
  const supabase = await createClient();
  const [{ data, error }, categories] = await Promise.all([
    supabase
      .from("v_keyword_latest")
      .select("*")
      .order("is_tracking", { ascending: false })
      .order("keyword"),
    categoryMap(),
  ]);
  if (error) throw error;
  return data.map((row) => toKeywordSummary(row, categories));
}

/** 키워드 상세: 현재 값 + 스냅샷 이력(제외된 행 포함). 본인 키워드가 아니면 null */
export async function getKeywordDetail(keywordId: string): Promise<KeywordDetail | null> {
  const supabase = await createClient();
  const [latest, keyword, snapshots, categories] = await Promise.all([
    supabase.from("v_keyword_latest").select("*").eq("keyword_id", keywordId).maybeSingle(),
    supabase.from("keywords").select("memo, updated_at").eq("id", keywordId).maybeSingle(),
    supabase
      .from("keyword_snapshots")
      .select("*")
      .eq("keyword_id", keywordId)
      .order("captured_on", { ascending: false })
      .order("captured_at", { ascending: false }),
    categoryMap(),
  ]);
  if (latest.error) throw latest.error;
  if (keyword.error) throw keyword.error;
  if (snapshots.error) throw snapshots.error;
  if (!latest.data || !keyword.data) return null;

  return toKeywordDetail(toKeywordSummary(latest.data as KeywordLatestRow, categories, keyword.data), snapshots.data);
}

/** 키워드 선택 목록 (상품 순위 입력·관심상품 발견 키워드). 추적 중인 것 먼저 */
export async function listKeywordOptions(): Promise<{ id: string; keyword: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keywords")
    .select("id, keyword")
    .order("is_tracking", { ascending: false })
    .order("keyword");
  if (error) throw error;
  return data;
}

/** 같은 normalized_keyword 의 기존 키워드 id (중복 안내용) */
export async function findKeywordIdByText(keyword: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keywords")
    .select("id")
    .eq("normalized_keyword", normalizeKeyword(keyword))
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// 저장 ---------------------------------------------------------------------------

/** 이름으로 카테고리를 찾고, 없으면 MANUAL 카테고리로 만든다 (쿠팡 카테고리 코드는 비워 둠) */
export async function findOrCreateCategory(name: string): Promise<string> {
  const supabase = await createClient();
  const { data: existing, error: findError } = await supabase
    .from("categories")
    .select("id")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("categories")
    .insert({ name, path: name, depth: 1, source_type: "MANUAL" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function createKeyword(input: {
  keyword: string;
  categoryId: string | null;
  isTracking: boolean;
}): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keywords")
    .insert({
      keyword: input.keyword,
      normalized_keyword: normalizeKeyword(input.keyword),
      category_id: input.categoryId,
      is_tracking: input.isTracking,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** 키워드 설정 변경. 삭제는 하지 않는다 (추적 중지 = is_tracking false) */
export async function updateKeyword(
  keywordId: string,
  patch: { isTracking?: boolean; categoryId?: string | null; memo?: string | null },
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("keywords")
    .update({
      ...(patch.isTracking !== undefined && { is_tracking: patch.isTracking }),
      ...(patch.categoryId !== undefined && { category_id: patch.categoryId }),
      ...(patch.memo !== undefined && { memo: patch.memo }),
    })
    .eq("id", keywordId)
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("키워드를 찾을 수 없습니다.");
}

export interface ManualKeywordSnapshot {
  keywordId: string;
  capturedOn: string;
  confidence: Confidence;
  metrics: Partial<Record<
    | "search_volume"
    | "search_volume_previous"
    | "search_growth_rate"
    | "coupang_product_count"
    | "competition_intensity"
    | "wing_ratio"
    | "rocket_ratio"
    | "average_price"
    | "average_reviews"
    | "brand_concentration"
    | "sample_size"
    | "ad_bid",
    number
  >>;
  /** 자동 계산한 항목 → metric_meta 에 CALCULATED 로 기록 */
  calculated: string[];
}

export type SnapshotAction = "INSERTED" | "UPDATED" | "SKIPPED";

/** 수동 입력 스냅샷 (source_type = MANUAL). 같은 날짜의 MANUAL 행이 있으면 UPSERT (빈 항목은 기존 값 유지) */
export async function saveManualKeywordSnapshot(input: ManualKeywordSnapshot): Promise<SnapshotAction> {
  const metricMeta = Object.fromEntries(
    input.calculated.map((field) => [field, { source: "CALCULATED", confidence: input.confidence }]),
  );
  const payload: Record<string, Json> = {
    keyword_id: input.keywordId,
    captured_on: input.capturedOn,
    captured_at: new Date().toISOString(),
    source_type: "MANUAL",
    confidence: input.confidence,
    ...input.metrics,
  };
  if (input.calculated.length > 0) payload.metric_meta = metricMeta;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_keyword_snapshot", { p: payload });
  if (error) throw error;
  assertOwnSnapshot(data, "키워드");
  return (data as { action: SnapshotAction }).action;
}

/** 스냅샷 제외 / 복원. 물리 삭제하지 않는다 */
export async function setKeywordSnapshotExcluded(
  snapshotId: number,
  excluded: boolean,
  reason: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { data: row, error: findError } = await supabase
    .from("keyword_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();
  if (findError) throw findError;
  if (!row) throw new Error("스냅샷을 찾을 수 없습니다.");

  const view = toKeywordSnapshotView(row);
  const { data, error } = await supabase.rpc("upsert_keyword_snapshot", {
    p: {
      keyword_id: row.keyword_id,
      captured_on: view.capturedOn,
      captured_at: view.capturedAt,
      source_type: view.source,
      confidence: view.confidence,
      is_excluded: excluded,
      excluded_reason: excluded ? reason : null,
    },
  });
  if (error) throw error;
  assertOwnSnapshot(data, "키워드");
}

// 이전 PHASE 에서 만든 조회 (설정 화면 등에서 사용 가능) ----------------------------

/** 정기 수집 대상 키워드 목록 */
export async function listTrackedKeywords({ limit = 100 } = {}): Promise<KeywordLatestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_keyword_latest")
    .select("*")
    .eq("is_tracking", true)
    .order("latest_captured_on", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * upsert_*_snapshot() 은 대상 행이 다른 사용자 것이라 RLS 로 보이지 않을 때 오류 대신
 * 빈 행으로 SKIPPED 를 돌려준다 (ON CONFLICT DO NOTHING 이 FK 검사보다 먼저 걸림, 데이터는 바뀌지 않음).
 * 앱에서는 이를 "찾을 수 없음" 오류로 처리한다. (DB 함수 수정은 별도 결정 사항)
 */
function assertOwnSnapshot(data: unknown, label: string): void {
  const row = (data as { row?: { id?: unknown } | null } | null)?.row;
  if (!row || row.id == null) throw new Error(`${label}을 찾을 수 없습니다 (본인 데이터가 아님).`);
}
