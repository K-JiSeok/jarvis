import "server-only";

import type { BatchRow } from "@/lib/ingest/batch-rows";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { Json, Tables } from "@/types/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * 대량 저장 (ingest_batch RPC). 로그인 사용자 세션(RLS)으로만 호출한다 — service role 을 쓰지 않는다.
 *
 * 한 번의 호출 = 한 트랜잭션:
 *   - 행 데이터 오류 → 그 행만 FAILED (부분 성공)
 *   - 시스템 오류 → 데이터 · import_rows · job 모두 롤백 → 여기서 실패 기록용 FAILED job 을 따로 남긴다 (데이터 없음)
 * 같은 idempotency_key 재전송 → 처리하지 않고 기존 job (replay)
 * 같은 파일 해시 → DuplicateBatchError
 */

export type JobRow = Tables<"import_jobs">;

export interface BatchJob {
  channel: "FILE" | "EXTENSION" | "API" | "MANUAL";
  import_type: "PRODUCT_SNAPSHOTS" | "KEYWORD_METRICS" | "SEARCH_RANKS" | "MIXED";
  source_type: string;
  source_tool?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  file_hash?: string | null;
  idempotency_key?: string | null;
  schema_version?: string | null;
  column_mapping?: Json | null;
}

export type IngestOutcome =
  | { ok: true; replay: boolean; job: JobRow; elapsedMs: number }
  | { ok: false; error: string; code: string | null; failedJob: JobRow | null; elapsedMs: number };

export class DuplicateBatchError extends Error {
  constructor(public readonly existingJobId: string | null) {
    super("같은 파일을 이미 가져왔습니다.");
  }
}

/**
 * ingest_batch 1회 호출 (행 수 최대 5,000 — DB 함수 한도).
 * client 를 주지 않으면 쿠키의 로그인 세션. /api/ingest 는 Bearer 토큰으로 만든 사용자 클라이언트를 넘긴다 (둘 다 RLS).
 */
export async function ingestBatch(job: BatchJob, rows: BatchRow[], client?: SupabaseClient<Database>): Promise<IngestOutcome> {
  const supabase = client ?? (await createClient());
  const started = performance.now();
  const { data, error } = await supabase.rpc("ingest_batch", { p_job: job as unknown as Json, p_rows: rows as unknown as Json });
  const elapsedMs = Math.round(performance.now() - started);

  if (!error) {
    const r = data as { replay: boolean; job: JobRow };
    return { ok: true, replay: r.replay, job: r.job, elapsedMs };
  }

  if (error.code === "23505") {
    // 같은 idempotency_key 가 동시에 들어왔다: 먼저 끝난 쪽의 결과를 돌려준다
    if (job.idempotency_key) {
      const { data: existing } = await supabase.from("import_jobs").select("*").eq("idempotency_key", job.idempotency_key).maybeSingle();
      if (existing) return { ok: true, replay: true, job: existing, elapsedMs };
    }
    if (job.file_hash) throw new DuplicateBatchError(error.details ?? null);
  }

  // 시스템 오류: 데이터는 롤백됐다. 실패 사실만 기록한다 (idempotency_key 는 넣지 않는다 → 같은 배치를 다시 보낼 수 있다)
  const failedJob = await recordFailedJob(supabase, job, rows.length, elapsedMs, `전체 롤백 (저장된 데이터 없음): ${error.code ?? ""} ${error.message}`);
  return { ok: false, error: error.message, code: error.code ?? null, failedJob, elapsedMs };
}

async function recordFailedJob(supabase: SupabaseClient<Database>, job: BatchJob, total: number, elapsedMs: number, summary: string): Promise<JobRow | null> {
  const { data } = await supabase
    .from("import_jobs")
    .insert({
      channel: job.channel,
      import_type: job.import_type,
      source_type: job.source_type,
      source_tool: job.source_tool ?? null,
      file_name: job.file_name ?? null,
      file_size_bytes: job.file_size_bytes ?? null,
      schema_version: job.schema_version ?? null,
      column_mapping: { ...((job.column_mapping as object | null) ?? {}), attempted_idempotency_key: job.idempotency_key ?? null } as Json,
      status: "FAILED",
      total_rows: total,
      failed_rows: total,
      error_summary: summary.slice(0, 500),
      started_at: new Date(Date.now() - elapsedMs).toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  return data ?? null;
}

export interface RegisterProduct {
  coupang_product_id: string;
  product_name: string | null;
}

export type RegisterOutcome =
  | { ok: true; replay: boolean; job: JobRow; createdProducts: number; existingProducts: number; createdProductIds: string[]; keywordCreated: boolean; elapsedMs: number }
  | { ok: false; error: string; code: string | null; detail: string | null; failedJob: JobRow | null; elapsedMs: number };

/**
 * 검색 결과에서 사용자가 고른 상품(· 키워드) 등록 + 저장 (PHASE 12, register_products_and_ingest RPC — 한 트랜잭션).
 * 저장 행이 하나라도 실패하면 DB 가 전부 롤백한다 → 실패 기록용 FAILED job 만 따로 남긴다 (상품 · 데이터 없음).
 */
export async function registerAndIngest(
  input: { keyword: { keyword: string; memo?: string | null } | null; products: RegisterProduct[] },
  job: BatchJob,
  rows: BatchRow[],
  client: SupabaseClient<Database>,
): Promise<RegisterOutcome> {
  const started = performance.now();
  const { data, error } = await client.rpc("register_products_and_ingest", {
    p_keyword: (input.keyword ?? null) as unknown as Json,
    p_products: input.products as unknown as Json,
    p_job: job as unknown as Json,
    p_rows: rows as unknown as Json,
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (!error) {
    const r = data as { replay: boolean; job: JobRow; created_products: number; existing_products: number; created_product_ids: string[]; keyword_created: boolean };
    return {
      ok: true,
      replay: r.replay,
      job: r.job,
      createdProducts: r.created_products,
      existingProducts: r.existing_products,
      createdProductIds: r.created_product_ids,
      keywordCreated: r.keyword_created,
      elapsedMs,
    };
  }
  if (error.code === "23505" && job.idempotency_key) {
    const { data: existing } = await client.from("import_jobs").select("*").eq("idempotency_key", job.idempotency_key).maybeSingle();
    if (existing) {
      return { ok: true, replay: true, job: existing, createdProducts: 0, existingProducts: input.products.length, createdProductIds: [], keywordCreated: false, elapsedMs };
    }
  }
  const failedJob = await recordFailedJob(
    client,
    job,
    rows.length,
    elapsedMs,
    `선택 상품 등록 전부 롤백 (상품 · 데이터 저장 안 됨): ${error.details || `${error.code ?? ""} ${error.message}`}`,
  );
  return { ok: false, error: error.message, code: error.code ?? null, detail: error.details ?? null, failedJob, elapsedMs };
}

/** 실패 사유별 개수 · 미등록 상품 목록 (확장 프로그램 결과 화면용) */
export async function jobFailureSummary(client: SupabaseClient<Database>, jobId: string) {
  const { data: failedRows } = await client
    .from("import_rows")
    .select("row_number, error_code, payload")
    .eq("import_job_id", jobId)
    .eq("result", "FAILED")
    .order("row_number")
    .limit(500);
  const failures: Record<string, number> = {};
  const notFound: { coupangProductId: string | null; productName: string | null; rank: number | null; isAd: boolean | null }[] = [];
  for (const r of failedRows ?? []) {
    const code = r.error_code ?? "UNKNOWN";
    failures[code] = (failures[code] ?? 0) + 1;
    if (code === "PRODUCT_NOT_FOUND") {
      const c = ((r.payload as Record<string, unknown> | null)?.collected ?? {}) as Record<string, unknown>;
      notFound.push({
        coupangProductId: (c.coupangProductId as string) ?? null,
        productName: (c.productName as string) ?? null,
        rank: (c.rank as number) ?? null,
        isAd: (c.isAd as boolean) ?? null,
      });
    }
  }
  return { failures, notFound };
}

export type KindKey = "rank" | "product" | "keyword";
export type KindSummary = Record<KindKey, { inserted: number; updated: number; skipped: number; failed: number }>;

/** 종류별 결과 개수 (순위 · 상품 스냅샷 · 키워드 스냅샷) — record_key 접두어로 나눈다 */
export async function jobKindSummary(client: SupabaseClient<Database>, jobId: string): Promise<KindSummary> {
  const empty = () => ({ inserted: 0, updated: 0, skipped: 0, failed: 0 });
  const out: KindSummary = { rank: empty(), product: empty(), keyword: empty() };
  const { data } = await client.from("import_rows").select("record_key, result").eq("import_job_id", jobId).limit(5000);
  for (const r of data ?? []) {
    const kind: KindKey | null = r.record_key?.startsWith("keyword_product_rank:")
      ? "rank"
      : r.record_key?.startsWith("product_snapshot:")
        ? "product"
        : r.record_key?.startsWith("keyword_snapshot:")
          ? "keyword"
          : null;
    if (!kind) continue;
    const k = r.result.toLowerCase() as "inserted" | "updated" | "skipped" | "failed";
    if (k in out[kind]) out[kind][k] += 1;
  }
  return out;
}
