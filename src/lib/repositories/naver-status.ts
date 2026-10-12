import "server-only";

import { NAVER_FAILURE_LABELS, type NaverFailureCode } from "@/lib/collectors/naver/plan";
import { createClient } from "@/lib/supabase/server";
import type { Confidence } from "@/types/common";

/*
 * 네이버 검색광고 수집 상태 (PHASE 14, 읽기 전용).
 *   값: keyword_snapshots (source_type = OFFICIAL_API) — 합계 검색량 · 이전 값 · 증감률 · 수집 시각 · 신뢰도
 *   PC · 모바일: 그 스냅샷을 만든 import_rows.payload.collected.observedOnly (컬럼이 없어 수집 기록에만 있음)
 *   마지막 시도: 네이버 수집 job(schema_version = naver-v1)의 키워드 행 — 실패도 사유 코드와 함께 남는다
 */

export interface NaverKeywordStatus {
  keywordId: string;
  latest: {
    capturedOn: string;
    capturedAt: string;
    total: number | null;
    pc: number | null;
    mobile: number | null;
    previous: number | null;
    growthRate: number | null;
    confidence: Confidence;
  } | null;
  lastAttempt: { at: string; ok: boolean; code: string | null; label: string | null; jobId: string } | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** record_key "keyword_snapshot:{정규화 키워드}:{날짜}:OFFICIAL_API" → 정규화 키워드 */
export function keywordOfRecordKey(key: string | null): string | null {
  const m = key?.match(/^keyword_snapshot:(.*):\d{4}-\d{2}-\d{2}:OFFICIAL_API$/);
  return m?.[1] ?? null;
}

export async function listNaverStatus(keywordIds?: string[]): Promise<Map<string, NaverKeywordStatus>> {
  const supabase = await createClient();
  let kq = supabase.from("keywords").select("id, normalized_keyword");
  if (keywordIds) kq = kq.in("id", keywordIds);
  const { data: keywords } = await kq;
  const out = new Map<string, NaverKeywordStatus>();
  if (!keywords?.length) return out;
  for (const k of keywords) out.set(k.id, { keywordId: k.id, latest: null, lastAttempt: null });
  const idOfNorm = new Map(keywords.map((k) => [k.normalized_keyword, k.id]));

  const [{ data: snaps }, { data: attempts }] = await Promise.all([
    supabase
      .from("keyword_snapshots")
      .select("keyword_id, captured_on, captured_at, search_volume, search_volume_previous, search_growth_rate, confidence, import_job_id")
      .in("keyword_id", keywords.map((k) => k.id))
      .eq("source_type", "OFFICIAL_API")
      .eq("is_excluded", false)
      .order("captured_on", { ascending: false })
      .limit(1000),
    supabase
      .from("import_rows")
      .select("import_job_id, record_key, result, error_code, payload, created_at, import_jobs!inner(schema_version)")
      .eq("import_jobs.schema_version", "naver-v1")
      .like("record_key", "keyword\\_snapshot:%")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const rowsByJobKey = new Map<string, Record<string, unknown>>();
  for (const a of attempts ?? []) {
    const norm = keywordOfRecordKey(a.record_key);
    const id = norm ? idOfNorm.get(norm) : undefined;
    if (!id) continue;
    if (a.result !== "FAILED") rowsByJobKey.set(`${a.import_job_id}:${id}`, ((a.payload as { collected?: { observedOnly?: Record<string, unknown> } })?.collected?.observedOnly ?? {}) as Record<string, unknown>);
    const s = out.get(id)!;
    if (!s.lastAttempt) {
      const code = a.result === "FAILED" ? a.error_code : null;
      s.lastAttempt = {
        at: a.created_at,
        ok: a.result !== "FAILED",
        code,
        label: code ? (NAVER_FAILURE_LABELS[code as NaverFailureCode] ?? code) : null,
        jobId: a.import_job_id,
      };
    }
  }
  for (const r of snaps ?? []) {
    const s = out.get(r.keyword_id);
    if (!s || s.latest) continue;
    const oo = r.import_job_id ? rowsByJobKey.get(`${r.import_job_id}:${r.keyword_id}`) : undefined;
    s.latest = {
      capturedOn: r.captured_on,
      capturedAt: r.captured_at,
      total: r.search_volume,
      pc: num(oo?.pcQueries),
      mobile: num(oo?.mobileQueries),
      previous: r.search_volume_previous,
      growthRate: r.search_growth_rate != null ? Number(r.search_growth_rate) : null,
      confidence: r.confidence as Confidence,
    };
  }
  return out;
}
