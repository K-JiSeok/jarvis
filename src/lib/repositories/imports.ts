import "server-only";

import { IMPORT_SCHEMA_VERSION, type ColumnMapping, type ImportOptions, type ImportType, type Lookups, type PreparedRow } from "@/lib/import/core";
import { preparedToBatchRows } from "@/lib/ingest/batch-rows";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/db";

import { DuplicateBatchError, ingestBatch } from "./ingest";

/*
 * Import 저장 (로그인 사용자 세션 · RLS). 파일 형식과 무관하게 정규화 레코드(NormalizedRecord)를 받는다.
 *
 *   검증 결과(PreparedRow[]) → BatchRow[] → ingest_batch() 한 번 (한 트랜잭션: 저장 + import_rows + import_jobs 결과)
 *
 * - 상품·키워드 스냅샷: upsert_product_snapshot() / upsert_keyword_snapshot() (NULL 보존, 다른 사용자 행 42501, previous 반환)
 * - 키워드 순위: upsert_keyword_product_rank() 원자적 UPSERT — 같은 값이면 SKIPPED, 바뀌면 이전 행을 previous_values 로 남김
 * - import_rows.target_id / previous_values 는 rollback_import() 가 그대로 쓴다.
 * - 상품·키워드는 만들지 않는다 (등록된 것만).
 */

type JobRow = Tables<"import_jobs">;

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
  channel: string;
  sourceTool: string | null;
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
    channel: j.channel,
    sourceTool: j.source_tool,
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

/**
 * 가져오기 실행 (PHASE 10: ingest_batch 한 번 = 한 트랜잭션).
 * 같은 파일이 이미 성공했으면 DuplicateImportError. 시스템 오류면 데이터는 남지 않고 FAILED 기록만 남는다.
 */
export async function runImport(input: RunImportInput): Promise<JobSummary> {
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

  let outcome;
  try {
    outcome = await ingestBatch(
      {
        channel: "FILE",
        import_type: input.type,
        source_type: input.options.source,
        file_name: input.file.name,
        file_size_bytes: input.file.size,
        file_hash: input.file.hash,
        schema_version: IMPORT_SCHEMA_VERSION,
        column_mapping: columnMapping as Json,
      },
      preparedToBatchRows(input.type, input.rows),
    );
  } catch (error) {
    if (error instanceof DuplicateBatchError) {
      const again = await findCompletedJob(input.file.hash, input.type);
      if (again) throw new DuplicateImportError(again);
    }
    throw error;
  }
  if (!outcome.ok) {
    if (outcome.failedJob) return toSummary(outcome.failedJob);
    throw new Error(outcome.error);
  }
  return toSummary(outcome.job);
}

/** 가져오기 되돌리기 (rollback_import: 충돌이 있으면 아무것도 바꾸지 않고 충돌 목록) */
export async function rollbackImport(jobId: string): Promise<{ ok: boolean; conflicts: { code: string; row_number: number }[]; restored?: number; deleted?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_import", { p_job_id: jobId });
  if (error) throw error;
  const r = data as { ok: boolean; conflicts?: { code: string; row_number: number }[]; restored_rows?: number; deleted_rows?: number };
  return { ok: r.ok, conflicts: r.conflicts ?? [], restored: r.restored_rows, deleted: r.deleted_rows };
}
