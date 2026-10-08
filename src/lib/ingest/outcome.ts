/**
 * 수집 결과 상태 (PHASE 12). import_jobs.status 는 그대로 두고, 화면 · API 에서 의미를 나눠 보여 준다.
 *
 *   import_jobs.status (DB, 변경 없음)   →  결과 상태 (화면)
 *   SUCCEEDED                            →  COMPLETED  저장 대상이 모두 저장됨 (건너뜀 포함)
 *   PARTIAL, 실패가 전부 미등록 사유      →  PARTIAL    일부 저장 · 나머지는 미등록 상품/키워드라 제외 (정상)
 *   PARTIAL, 다른 실패 사유 포함          →  PARTIAL_ERROR  일부 저장 · 값 오류 등 확인 필요
 *   FAILED, 실패가 전부 미등록 사유       →  NO_MATCH   등록된 상품/키워드가 하나도 없어 저장할 것이 없음 (오류 아님)
 *   FAILED, 그 밖                        →  FAILED     실제 실패 (값 오류 · 시스템 오류 · 전체 롤백)
 *
 * DB 상태값(check 제약)에 NO_MATCH 를 넣으려면 migration 이 필요하다 → 하지 않았다 (PHASE 12 보고서).
 * 순수 함수 — Node 테스트에서 직접 실행.
 */

export const NOT_REGISTERED_CODES = ["PRODUCT_NOT_FOUND", "KEYWORD_NOT_FOUND"] as const;

export type JobOutcome = "COMPLETED" | "PARTIAL" | "PARTIAL_ERROR" | "NO_MATCH" | "FAILED" | "PROCESSING" | "ROLLED_BACK";

export const OUTCOME_LABELS: Record<JobOutcome, string> = {
  COMPLETED: "완료",
  PARTIAL: "일부 미등록",
  PARTIAL_ERROR: "부분 성공 (오류 있음)",
  NO_MATCH: "등록 상품 없음",
  FAILED: "실패",
  PROCESSING: "처리 중",
  ROLLED_BACK: "되돌림",
};

/** error_summary "KEYWORD_NOT_FOUND 3, PRODUCT_NOT_FOUND 42" → {코드: 개수}. 읽을 수 없으면 null */
export function parseErrorSummary(summary: string | null | undefined): Record<string, number> | null {
  if (!summary?.trim()) return {};
  const out: Record<string, number> = {};
  for (const part of summary.split(",")) {
    const m = part.trim().match(/^([A-Z0-9_]+) (\d+)$/);
    if (!m) return null;
    out[m[1]] = Number(m[2]);
  }
  return out;
}

export function jobOutcome(job: { status: string; failed_rows?: number | null; error_summary?: string | null }): JobOutcome {
  if (job.status === "SUCCEEDED") return "COMPLETED";
  if (job.status === "ROLLED_BACK") return "ROLLED_BACK";
  if (job.status === "PENDING" || job.status === "PROCESSING") return "PROCESSING";
  const codes = parseErrorSummary(job.error_summary);
  const onlyNotRegistered =
    codes != null && Object.keys(codes).length > 0 && Object.keys(codes).every((c) => (NOT_REGISTERED_CODES as readonly string[]).includes(c));
  if (job.status === "PARTIAL") return onlyNotRegistered ? "PARTIAL" : "PARTIAL_ERROR";
  return onlyNotRegistered ? "NO_MATCH" : "FAILED";
}
