import "server-only";

import {
  IMPORT_SCHEMA_VERSION,
  type ColumnMapping,
  type ImportOptions,
  type ImportType,
  type Lookups,
  type NormalizedKeywordSnapshot,
  type NormalizedProductSnapshot,
  type NormalizedRank,
  type NormalizedRecord,
  type PreparedRow,
} from "@/lib/import/core";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables, TablesInsert } from "@/types/db";

/*
 * Import 저장 (로그인 사용자 세션 · RLS). 파일 형식과 무관하게 정규화 레코드(NormalizedRecord)를 받는다.
 *
 *   import_jobs (PROCESSING) → 행마다 기존 저장 경로 → import_rows 기록 → import_jobs 결과 (SUCCEEDED / PARTIAL / FAILED)
 *
 * - 상품·키워드 스냅샷: upsert_product_snapshot() / upsert_keyword_snapshot() (NULL 보존, 다른 사용자 행 42501, previous 반환)
 * - 키워드 순위: 자연키 (키워드, 상품, 수집일, 출처, 광고 여부) UPSERT — 같은 값이면 SKIPPED, 바뀌면 이전 행을 previous_values 로 남김
 * - import_rows.target_id / previous_values 는 rollback_import() 가 그대로 쓴다.
 * - 상품·키워드는 만들지 않는다 (등록된 것만).
 */

type JobRow = Tables<"import_jobs">;
type RowResult = "INSERTED" | "UPDATED" | "SKIPPED" | "FAILED";

/** 등록된 상품(쿠팡 상품 ID)·키워드(정규화 키워드) → id */
export async function loadLookups(): Promise<Lookups> {
  const supabase = await createClient();
  const [products, keywords] = await Promise.all([
    supabase.from("products").select("id, coupang_product_id"),
    supabase.from("keywords").select("id, normalized_keyword"),
  ]);
  if (products.error) throw products.error;
  if (keywords.error) throw keywords.error;
  return {
    products: new Map(products.data.map((p) => [p.coupang_product_id, p.id])),
    keywords: new Map(keywords.data.map((k) => [k.normalized_keyword, k.id])),
  };
}

export interface JobSummary {
  id: string;
  fileName: string | null;
  importType: string;
  sourceType: string;
  status: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  errorSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
  confidence: string | null;
}

function toSummary(j: JobRow): JobSummary {
  const options = ((j.column_mapping ?? {}) as { options?: { confidence?: string } }).options;
  return {
    id: j.id,
    fileName: j.file_name,
    importType: j.import_type,
    sourceType: j.source_type,
    status: j.status,
    totalRows: j.total_rows,
    insertedRows: j.inserted_rows,
    updatedRows: j.updated_rows,
    skippedRows: j.skipped_rows,
    failedRows: j.failed_rows,
    errorSummary: j.error_summary,
    createdAt: j.created_at,
    finishedAt: j.finished_at,
    confidence: options?.confidence ?? null,
  };
}

/**
 * 같은 파일(해시)·유형으로 이미 성공(부분 성공 포함)했거나 지금 처리 중인 가져오기.
 * 처리 중은 최근 15분만 본다 (중단된 작업이 영원히 막지 않도록). 성공 건은 DB 부분 UNIQUE 도 막는다.
 */
export async function findCompletedJob(fileHash: string, importType: ImportType): Promise<JobSummary | null> {
  const supabase = await createClient();
  const recent = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .eq("file_hash", fileHash)
    .eq("import_type", importType)
    .eq("dry_run", false)
    .or(`status.in.(SUCCEEDED,PARTIAL),and(status.eq.PROCESSING,created_at.gt.${recent})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data) : null;
}

export async function listImportJobs({ limit = 30 } = {}): Promise<JobSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map(toSummary);
}

export interface ImportRowView {
  rowNumber: number;
  result: string;
  recordKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  raw: Record<string, string>;
}

/** 가져오기 1건 + 행 결과 (실패 → 건너뜀 → 나머지 순, 최대 limit) */
export async function getImportJob(jobId: string, { limit = 500 } = {}): Promise<{ job: JobSummary; rows: ImportRowView[] } | null> {
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("import_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const { data: rows, error: rowsError } = await supabase
    .from("import_rows")
    .select("row_number, result, record_key, error_code, error_message, payload")
    .eq("import_job_id", jobId)
    .order("row_number")
    .limit(5000);
  if (rowsError) throw rowsError;
  const order: Record<string, number> = { FAILED: 0, SKIPPED: 1, UPDATED: 2, INSERTED: 3 };
  return {
    job: toSummary(job),
    rows: rows
      .sort((a, b) => (order[a.result] ?? 9) - (order[b.result] ?? 9) || a.row_number - b.row_number)
      .slice(0, limit)
      .map((r) => ({
        rowNumber: r.row_number,
        result: r.result,
        recordKey: r.record_key,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        raw: ((r.payload as { raw?: Record<string, string> })?.raw ?? {}) as Record<string, string>,
      })),
  };
}

// 저장 ----------------------------------------------------------------------------------

interface RowOutcome {
  result: RowResult;
  targetTable: string | null;
  targetId: string | null;
  previous: Json | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const failed = (code: string, message: string): RowOutcome => ({
  result: "FAILED",
  targetTable: null,
  targetId: null,
  previous: null,
  errorCode: code,
  errorMessage: message,
});

function pgFailure(error: unknown): RowOutcome {
  const e = error as { code?: string; message?: string };
  if (e?.code === "42501") return failed("FORBIDDEN", "권한이 없습니다 (다른 사용자의 데이터).");
  if (e?.code === "23503") return failed("NOT_FOUND", "연결 대상(상품·키워드)을 찾을 수 없습니다.");
  if (e?.code === "23514") return failed("OUT_OF_RANGE", "허용 범위를 벗어난 값이 있습니다.");
  return failed(e?.code ?? "ERROR", e?.message ?? "저장 실패");
}

async function saveSnapshot(
  rpc: "upsert_product_snapshot" | "upsert_keyword_snapshot",
  table: "product_snapshots" | "keyword_snapshots",
  payload: Record<string, Json>,
): Promise<RowOutcome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpc, { p: payload });
  if (error) return pgFailure(error);
  const res = data as { action: "INSERTED" | "UPDATED" | "SKIPPED"; row: { id?: number } | null; previous: Json | null };
  if (!res?.row?.id) return failed("FORBIDDEN", "저장 대상 행에 접근할 수 없습니다.");
  return {
    result: res.action,
    targetTable: table,
    targetId: String(res.row.id),
    previous: res.action === "UPDATED" ? res.previous : null,
    errorCode: null,
    errorMessage: null,
  };
}

function metricMeta(record: NormalizedProductSnapshot | NormalizedKeywordSnapshot): Json | undefined {
  if (record.calculated.length === 0) return undefined;
  return Object.fromEntries(record.calculated.map((f) => [f, { source: "CALCULATED", confidence: record.confidence }]));
}

async function saveRank(record: NormalizedRank, row: PreparedRow, jobId: string): Promise<RowOutcome> {
  const supabase = await createClient();
  const key = {
    keyword_id: row.target.keywordId!,
    product_id: row.target.productId!,
    captured_on: record.capturedOn,
    source_type: record.source,
    is_ad: record.isAd,
  };
  const { data: existing, error: findError } = await supabase.from("keyword_product_ranks").select("*").match(key).maybeSingle();
  if (findError) return pgFailure(findError);

  if (existing) {
    if (existing.rank_position === record.rankPosition && existing.page === record.page && existing.confidence === record.confidence) {
      return { result: "SKIPPED", targetTable: "keyword_product_ranks", targetId: String(existing.id), previous: null, errorCode: null, errorMessage: null };
    }
    const { error } = await supabase
      .from("keyword_product_ranks")
      .update({ rank_position: record.rankPosition, page: record.page, confidence: record.confidence, captured_at: record.capturedAt, import_job_id: jobId })
      .eq("id", existing.id);
    if (error) return pgFailure(error);
    return { result: "UPDATED", targetTable: "keyword_product_ranks", targetId: String(existing.id), previous: existing as unknown as Json, errorCode: null, errorMessage: null };
  }

  const { data, error } = await supabase
    .from("keyword_product_ranks")
    .insert({ ...key, captured_at: record.capturedAt, confidence: record.confidence, rank_position: record.rankPosition, page: record.page, import_job_id: jobId })
    .select("id")
    .single();
  if (error) return pgFailure(error);
  return { result: "INSERTED", targetTable: "keyword_product_ranks", targetId: String(data.id), previous: null, errorCode: null, errorMessage: null };
}

async function saveRecord(record: NormalizedRecord, row: PreparedRow, jobId: string): Promise<RowOutcome> {
  try {
    if (record.kind === "PRODUCT_SNAPSHOT") {
      const meta = metricMeta(record);
      return await saveSnapshot("upsert_product_snapshot", "product_snapshots", {
        product_id: row.target.productId!,
        captured_on: record.capturedOn,
        captured_at: record.capturedAt,
        source_type: record.source,
        confidence: record.confidence,
        import_job_id: jobId,
        ...record.metrics,
        ...(meta && { metric_meta: meta }),
      });
    }
    if (record.kind === "KEYWORD_SNAPSHOT") {
      const meta = metricMeta(record);
      return await saveSnapshot("upsert_keyword_snapshot", "keyword_snapshots", {
        keyword_id: row.target.keywordId!,
        captured_on: record.capturedOn,
        captured_at: record.capturedAt,
        source_type: record.source,
        confidence: record.confidence,
        import_job_id: jobId,
        ...record.metrics,
        ...(meta && { metric_meta: meta }),
      });
    }
    return await saveRank(record, row, jobId);
  } catch (error) {
    return pgFailure(error);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class DuplicateImportError extends Error {
  constructor(public readonly existing: JobSummary) {
    super("같은 파일을 이미 가져왔습니다.");
  }
}

export interface RunImportInput {
  type: ImportType;
  file: { name: string; size: number; hash: string; format: string; encoding: string | null };
  headers: string[];
  mapping: ColumnMapping;
  options: ImportOptions;
  rows: PreparedRow[];
}

/** 가져오기 실행. 같은 파일이 이미 성공했으면 DuplicateImportError */
export async function runImport(input: RunImportInput): Promise<JobSummary> {
  const supabase = await createClient();

  const existing = await findCompletedJob(input.file.hash, input.type);
  if (existing) throw new DuplicateImportError(existing);

  const columnMapping = {
    columns: Object.fromEntries(
      Object.entries(input.mapping)
        .filter(([, k]) => k)
        .map(([i, k]) => [input.headers[Number(i)] ?? `열${Number(i) + 1}`, k]),
    ),
    options: {
      confidence: input.options.confidence,
      sales_period_days: input.options.salesPeriodDays,
      ratio_units: input.options.ratioUnits,
    },
    file: { format: input.file.format, encoding: input.file.encoding },
  };
  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      channel: "FILE",
      import_type: input.type,
      source_type: input.options.source,
      file_name: input.file.name,
      file_size_bytes: input.file.size,
      file_hash: input.file.hash,
      schema_version: IMPORT_SCHEMA_VERSION,
      column_mapping: columnMapping as Json,
      status: "PROCESSING",
      total_rows: input.rows.length,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (jobError) throw jobError;

  const outcomes = await mapLimit(input.rows, 5, async (row): Promise<RowOutcome> => {
    if (row.status === "ERROR" || !row.record) {
      if (row.status === "DUPLICATE") {
        return { result: "SKIPPED", targetTable: null, targetId: null, previous: null, errorCode: "DUPLICATE_IN_FILE", errorMessage: row.messages.join(" ") };
      }
      return failed(row.errorCode ?? "INVALID", row.messages.join(" "));
    }
    return saveRecord(row.record, row, job.id);
  });

  // import_rows 기록 (500행씩)
  const records: TablesInsert<"import_rows">[] = input.rows.map((row, i) => {
    const o = outcomes[i];
    return {
      import_job_id: job.id,
      row_number: row.rowNumber,
      record_key: row.recordKey,
      payload: { raw: row.raw, converted: row.converted, messages: row.messages, status: row.status } as Json,
      result: o.result,
      target_table: o.targetTable,
      target_id: o.targetId,
      previous_values: o.previous,
      error_code: o.errorCode,
      error_message: o.errorMessage ?? (row.status === "WARNING" ? row.messages.join(" ") : null),
    };
  });
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await supabase.from("import_rows").insert(records.slice(i, i + 500));
    if (error) {
      await supabase
        .from("import_jobs")
        .update({ status: "FAILED", error_summary: `행 기록 실패: ${error.message}`, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      throw error;
    }
  }

  // 상품 최근 관측 시각: 가져온 스냅샷 중 더 최신이면 갱신 (과거로 되돌리지 않음)
  if (input.type === "PRODUCT_SNAPSHOTS") {
    const latest = new Map<string, string>();
    input.rows.forEach((row, i) => {
      const r = row.record;
      if (!r || !row.target.productId || outcomes[i].result === "FAILED") return;
      const prev = latest.get(row.target.productId);
      if (!prev || r.capturedAt > prev) latest.set(row.target.productId, r.capturedAt);
    });
    if (latest.size > 0) {
      const { data: products } = await supabase.from("products").select("id, last_seen_at").in("id", [...latest.keys()]);
      for (const p of products ?? []) {
        const seen = latest.get(p.id)!;
        if (new Date(seen) > new Date(p.last_seen_at)) await supabase.from("products").update({ last_seen_at: new Date(seen).toISOString() }).eq("id", p.id);
      }
    }
  }

  const count = (r: RowResult) => outcomes.filter((o) => o.result === r).length;
  const inserted = count("INSERTED");
  const updated = count("UPDATED");
  const skipped = count("SKIPPED");
  const failedN = count("FAILED");
  const succeeded = inserted + updated;
  // 실패 없음 = 성공 / 일부 저장 + 일부 실패 = 부분 성공 / 저장된 행 없이 실패 = 실패
  const status = failedN === 0 ? "SUCCEEDED" : succeeded > 0 ? "PARTIAL" : "FAILED";
  const codes = new Map<string, number>();
  for (const o of outcomes) if (o.result === "FAILED" && o.errorCode) codes.set(o.errorCode, (codes.get(o.errorCode) ?? 0) + 1);
  const summary = [...codes.entries()].map(([c, n]) => `${c} ${n}`).join(", ") || null;

  const { data: done, error: doneError } = await supabase
    .from("import_jobs")
    .update({
      status,
      inserted_rows: inserted,
      updated_rows: updated,
      skipped_rows: skipped,
      failed_rows: failedN,
      error_summary: summary,
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select("*")
    .single();
  if (doneError) throw doneError;
  return toSummary(done);
}

/** 가져오기 되돌리기 (rollback_import: 충돌이 있으면 아무것도 바꾸지 않고 충돌 목록) */
export async function rollbackImport(jobId: string): Promise<{ ok: boolean; conflicts: { code: string; row_number: number }[]; restored?: number; deleted?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_import", { p_job_id: jobId });
  if (error) throw error;
  const r = data as { ok: boolean; conflicts?: { code: string; row_number: number }[]; restored_rows?: number; deleted_rows?: number };
  return { ok: r.ok, conflicts: r.conflicts ?? [], restored: r.restored_rows, deleted: r.deleted_rows };
}
