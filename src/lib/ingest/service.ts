import "server-only";

import { normalizeKeyword, normalizeProduct, normalizeSearch } from "@/lib/collectors/normalize";
import type { CollectedKeyword, CollectedProduct, CollectedSearchResult, NormalizeIssue } from "@/lib/collectors/types";
import type { NormalizedRecord } from "@/lib/import/core";
import { ingestBatch, type BatchJob, type IngestOutcome } from "@/lib/repositories/ingest";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizedToBatchRows, type BatchRow } from "./batch-rows";

/*
 * 수집 데이터 저장 서비스 (향후 POST /api/ingest 가 부를 진입점).
 *
 *   Collected* → normalize (순수) → NormalizedRecord[] → BatchRow[] → ingest_batch (한 트랜잭션, RLS)
 *
 * 정규화에서 버려진 항목(상품 ID 없음 · 신뢰도 없음 등)도 FAILED 행으로 남겨 import_rows 에서 확인할 수 있게 한다.
 * 수집기는 DB 를 직접 부르지 않는다 — 이 서비스만 부른다.
 */

export const MAX_INGEST_RECORDS = 2000;

export interface CollectedBatch {
  products?: CollectedProduct[];
  searches?: CollectedSearchResult[];
  keywords?: CollectedKeyword[];
  /** 같은 배치 재전송 방지 키 (수집기가 배치마다 UUID 로 만든다) */
  idempotencyKey?: string | null;
  tool?: string | null;
}

export class IngestInputError extends Error {}

/** 수집 데이터 → 배치 행 (정규화 실패도 FAILED 행으로) */
export function collectedToRows(batch: CollectedBatch): { rows: BatchRow[]; records: NormalizedRecord[]; issues: NormalizeIssue[]; sources: Set<string> } {
  const records: NormalizedRecord[] = [];
  const payloads: Record<string, unknown>[] = [];
  const rejected: { kind: NormalizedRecord["kind"]; issues: NormalizeIssue[]; payload: unknown }[] = [];
  const allIssues: NormalizeIssue[] = [];
  const sources = new Set<string>();

  for (const p of batch.products ?? []) {
    sources.add(p.source);
    const r = normalizeProduct(p);
    allIssues.push(...r.issues);
    if (r.record) {
      records.push(r.record);
      payloads.push({ collected: p, issues: r.issues });
    } else rejected.push({ kind: "PRODUCT_SNAPSHOT", issues: r.issues, payload: p });
  }
  for (const s of batch.searches ?? []) {
    sources.add(s.source);
    const r = normalizeSearch(s);
    allIssues.push(...r.issues);
    for (const rec of r.records) {
      records.push(rec);
      // 화면 참고값(전체 위치 · 상품명 · 가격 등)은 순위 테이블에 없으므로 payload 에만 남긴다
      const item = s.items.find((x) => Number(x.rank) === rec.rankPosition && (x.isAd === true) === rec.isAd);
      payloads.push({ collected: { keyword: s.keyword, page: s.page ?? null, ...item, coupangProductId: rec.coupangProductId, rank: rec.rankPosition, isAd: rec.isAd } });
    }
    if (r.records.length === 0) rejected.push({ kind: "KEYWORD_PRODUCT_RANK", issues: r.issues, payload: { keyword: s.keyword, items: s.items.length } });
  }
  for (const k of batch.keywords ?? []) {
    sources.add(k.source);
    const r = normalizeKeyword(k);
    allIssues.push(...r.issues);
    if (r.record) {
      records.push(r.record);
      payloads.push({ collected: k, issues: r.issues });
    } else rejected.push({ kind: "KEYWORD_SNAPSHOT", issues: r.issues, payload: k });
  }

  const rows = normalizedToBatchRows(records, payloads);
  rejected.forEach((x, i) =>
    rows.push({
      row_number: records.length + i + 1,
      record_key: null,
      kind: x.kind,
      status: "FAILED",
      error_code: "INVALID",
      error_message: x.issues.map((iss) => `${iss.field}: ${iss.message}`).join(" / ").slice(0, 1000),
      payload: { collected: x.payload },
      data: {},
    }),
  );
  return { rows, records, issues: allIssues, sources };
}

export async function ingestCollected(
  batch: CollectedBatch,
  options: { client?: SupabaseClient<Database>; channel?: BatchJob["channel"] } = {},
): Promise<IngestOutcome & { issues: NormalizeIssue[] }> {
  const { rows, records, issues, sources } = collectedToRows(batch);
  if (rows.length === 0) throw new IngestInputError("저장할 레코드가 없습니다.");
  if (rows.length > MAX_INGEST_RECORDS) throw new IngestInputError(`한 배치는 최대 ${MAX_INGEST_RECORDS}건입니다 (${rows.length}건).`);

  const kinds = new Set(records.map((r) => r.kind));
  const importType: BatchJob["import_type"] =
    kinds.size !== 1
      ? "MIXED"
      : kinds.has("PRODUCT_SNAPSHOT")
        ? "PRODUCT_SNAPSHOTS"
        : kinds.has("KEYWORD_SNAPSHOT")
          ? "KEYWORD_METRICS"
          : "SEARCH_RANKS";
  const outcome = await ingestBatch(
    {
      channel: options.channel ?? "EXTENSION",
      import_type: importType,
      // 출처가 하나면 그 출처, 섞여 있으면 수집 경로(EXTENSION). 행마다의 출처는 각 스냅샷 source_type 에 남는다
      source_type: sources.size === 1 ? [...sources][0] : "EXTENSION",
      source_tool: batch.tool ?? null,
      idempotency_key: batch.idempotencyKey ?? null,
      schema_version: "ingest-v1",
    },
    rows,
    options.client,
  );
  return { ...outcome, issues };
}
