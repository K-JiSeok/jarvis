import "server-only";

import type { BatchRow } from "@/lib/ingest/batch-rows";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/db";

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

/** ingest_batch 1회 호출 (행 수 최대 5,000 — DB 함수 한도) */
export async function ingestBatch(job: BatchJob, rows: BatchRow[]): Promise<IngestOutcome> {
  const supabase = await createClient();
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
  const { data: failedJob } = await supabase
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
      total_rows: rows.length,
      failed_rows: rows.length,
      error_summary: `전체 롤백 (저장된 데이터 없음): ${error.code ?? ""} ${error.message}`.slice(0, 500),
      started_at: new Date(Date.now() - elapsedMs).toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  return { ok: false, error: error.message, code: error.code ?? null, failedJob: failedJob ?? null, elapsedMs };
}
