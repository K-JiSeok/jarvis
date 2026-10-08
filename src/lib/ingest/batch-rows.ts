/**
 * NormalizedRecord → ingest_batch() 행 (순수 함수). 파일 가져오기와 수집기가 같은 변환을 쓴다.
 *
 *   PreparedRow[] (파일, PHASE 9)  ─┐
 *                                   ├─▶ BatchRow[] ─▶ ingest_batch(p_job, p_rows)  (한 트랜잭션)
 *   NormalizedRecord[] (수집기)   ─┘
 *
 * data 는 DB 컬럼명 그대로다. 상품·키워드 id 를 모르면 쿠팡 상품 ID · 키워드 텍스트를 넣고 DB 가 본인 데이터에서 찾는다.
 * 값이 없는 지표는 넣지 않는다 → 기존 스냅샷 값 보존 (NULL 보존).
 * 타입만 import 한다 (Node 테스트 스크립트에서 직접 실행).
 */

import type {
  NormalizedKeywordSnapshot,
  NormalizedProductSnapshot,
  NormalizedRank,
  NormalizedRecord,
  PreparedRow,
} from "../import/core";

export type BatchRowStatus = "VALID" | "FAILED" | "SKIPPED";

export interface BatchRow {
  row_number: number;
  record_key: string | null;
  kind: NormalizedRecord["kind"];
  status: BatchRowStatus;
  error_code?: string | null;
  error_message?: string | null;
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface Targets {
  productId?: string;
  keywordId?: string;
}

function metricMeta(record: NormalizedProductSnapshot | NormalizedKeywordSnapshot) {
  if (record.calculated.length === 0) return undefined;
  return Object.fromEntries(record.calculated.map((f) => [f, { source: "CALCULATED", confidence: record.confidence }]));
}

/** 정규화 레코드 1건 → 저장 대상 컬럼 */
export function recordData(record: NormalizedRecord, target: Targets = {}): Record<string, unknown> {
  const common = { captured_on: record.capturedOn, captured_at: record.capturedAt, source_type: record.source, confidence: record.confidence };
  if (record.kind === "PRODUCT_SNAPSHOT") {
    const meta = metricMeta(record);
    return {
      ...(target.productId ? { product_id: target.productId } : { coupang_product_id: record.coupangProductId }),
      ...common,
      ...record.metrics,
      ...(meta && { metric_meta: meta }),
    };
  }
  if (record.kind === "KEYWORD_SNAPSHOT") {
    const meta = metricMeta(record);
    return {
      ...(target.keywordId ? { keyword_id: target.keywordId } : { keyword: record.keyword }),
      ...common,
      ...record.metrics,
      ...(meta && { metric_meta: meta }),
    };
  }
  const rank = record as NormalizedRank;
  return {
    ...(target.keywordId ? { keyword_id: target.keywordId } : { keyword: rank.keyword }),
    ...(target.productId ? { product_id: target.productId } : { coupang_product_id: rank.coupangProductId }),
    ...common,
    rank_position: rank.rankPosition,
    is_ad: rank.isAd,
    ...(rank.page != null && { page: rank.page }),
  };
}

export function recordKey(record: NormalizedRecord): string {
  if (record.kind === "PRODUCT_SNAPSHOT") return `product_snapshot:${record.coupangProductId}:${record.capturedOn}:${record.source}`;
  if (record.kind === "KEYWORD_SNAPSHOT") return `keyword_snapshot:${record.keyword.trim().replace(/\s+/g, " ").toLowerCase()}:${record.capturedOn}:${record.source}`;
  return `keyword_product_rank:${record.keyword.trim().replace(/\s+/g, " ").toLowerCase()}:${record.coupangProductId}:${record.capturedOn}:${record.source}:${record.isAd ? "ad" : "organic"}`;
}

const KIND_BY_TYPE = {
  PRODUCT_SNAPSHOTS: "PRODUCT_SNAPSHOT",
  KEYWORD_METRICS: "KEYWORD_SNAPSHOT",
  SEARCH_RANKS: "KEYWORD_PRODUCT_RANK",
} as const;

/** 파일 가져오기 (PHASE 9 검증 결과) → 배치 행. 검증 오류 → FAILED, 파일 내 중복 → SKIPPED */
export function preparedToBatchRows(type: keyof typeof KIND_BY_TYPE, rows: PreparedRow[]): BatchRow[] {
  return rows.map((row) => {
    const payload = { raw: row.raw, converted: row.converted, messages: row.messages, status: row.status };
    const base = { row_number: row.rowNumber, record_key: row.recordKey, kind: KIND_BY_TYPE[type], payload };
    if (row.status === "DUPLICATE") {
      return { ...base, status: "SKIPPED", error_code: "DUPLICATE_IN_FILE", error_message: row.messages.join(" "), data: {} };
    }
    if (row.status === "ERROR" || !row.record) {
      return { ...base, status: "FAILED", error_code: row.errorCode ?? "INVALID", error_message: row.messages.join(" "), data: {} };
    }
    return {
      ...base,
      status: "VALID",
      // 주의 행은 비운 칸의 사유를 남긴다
      error_message: row.status === "WARNING" ? row.messages.join(" ") : null,
      data: recordData(row.record, row.target),
    };
  });
}

/** 수집기 레코드 → 배치 행 (행 번호 1부터). 같은 자연키가 두 번 나오면 뒤의 것은 SKIPPED */
export function normalizedToBatchRows(records: NormalizedRecord[], payloads?: Record<string, unknown>[]): BatchRow[] {
  const seen = new Map<string, number>();
  return records.map((record, i) => {
    const key = recordKey(record);
    const rowNumber = i + 1;
    const base = { row_number: rowNumber, record_key: key, kind: record.kind, payload: payloads?.[i] ?? {} };
    const first = seen.get(key);
    if (first != null) {
      return { ...base, status: "SKIPPED", error_code: "DUPLICATE_IN_BATCH", error_message: `${first}번 레코드와 같은 대상·날짜`, data: {} };
    }
    seen.set(key, rowNumber);
    return { ...base, status: "VALID", data: recordData(record) };
  });
}
