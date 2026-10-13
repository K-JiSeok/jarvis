/**
 * 발굴 → 후보 → 소싱 → 공급업체 → 원가 단계 (PHASE 21) — 순수 함수. 새 상태 컬럼 없이 기존 데이터에서 읽는다.
 *
 *   단계 근거 (모두 기존 테이블)
 *     관심상품(watchlist) 없음          → 발굴됨 (미검토)
 *     watchlist WATCHING               → 소싱 검토 후보 (선택됨 — 매입 확정 · 수익성 검증 아님)
 *     watchlist DROPPED                → 검토 제외 (행 · 이력 보존, [제외 취소]로 후보 복귀)
 *     watchlist SOURCING · TESTING · SELLING · PAUSED · SOLD_OUT → 소싱 대상 (사용자가 [소싱 시작]한 상품과 그 이후 단계)
 *     watchlist STOPPED                → 판매 중단 (소싱 대상 아님)
 *     판매 가능성 BLOCKED (사용자 판단)  → 판매 불가 제외 (관심상품 단계와 관계없이 소싱 대상 아님)
 *   소싱 대상 안에서
 *     공급 후보 연결 없음 → 소싱 진행 중 · 제외 아닌 후보 있음 → 공급 후보 확보 (품질 · 가격 검증 아님) · [선택]한 후보 있음 → 공급업체 선택됨
 *
 * 자동화는 이 단계를 바꾸지 않는다 (사용자 선택 · 제외는 사용자만).
 */

export const SOURCING_SCOPE_STATUSES = ["SOURCING", "TESTING", "SELLING", "PAUSED", "SOLD_OUT"] as const;

export type Stage = "DISCOVERED" | "SHORTLISTED" | "REJECTED" | "BLOCKED" | "STOPPED" | "SOURCING" | "SOURCED" | "SUPPLIER_SELECTED";

export const STAGE_LABELS: Record<Stage, string> = {
  DISCOVERED: "발굴됨 (미검토)",
  SHORTLISTED: "소싱 검토 후보",
  REJECTED: "검토 제외",
  BLOCKED: "판매 불가 제외",
  STOPPED: "판매 중단",
  SOURCING: "소싱 진행 중 (공급 후보 없음)",
  SOURCED: "공급 후보 확보 (검증 아님)",
  SUPPLIER_SELECTED: "공급업체 선택됨",
};

export interface StageInput {
  watchStatus: string | null;
  /** 판매 가능성: 사용자가 판매 불가로 정했는가 */
  blockedByUser: boolean;
  /** 공급 후보 연결의 사용자 상태 (CANDIDATE · SELECTED · REJECTED) */
  linkStatuses: string[];
}

export interface StageResult {
  stage: Stage;
  /** 소싱 (검색어 · 공급 후보 연결 · 원가 재계산 · 상세 원가) 대상인가 */
  inScope: boolean;
  /** 지금 단계에서 다음으로 못 가는 이유 */
  blocker: string | null;
}

export function productStage(i: StageInput): StageResult {
  if (i.blockedByUser) return { stage: "BLOCKED", inScope: false, blocker: "판매 불가로 정한 상품 — 판매 가능성 판단을 바꾸기 전에는 소싱하지 않음" };
  const w = i.watchStatus;
  if (w == null) return { stage: "DISCOVERED", inScope: false, blocker: "아직 검토하지 않음 — [후보로 선택]해야 소싱을 시작할 수 있음" };
  if (w === "DROPPED") return { stage: "REJECTED", inScope: false, blocker: "검토 제외 — [제외 취소]로 후보에 되돌릴 수 있음" };
  if (w === "STOPPED") return { stage: "STOPPED", inScope: false, blocker: "판매 중단 상태 — 관심상품에서 단계를 바꾸면 다시 소싱 대상" };
  if (w === "WATCHING") return { stage: "SHORTLISTED", inScope: false, blocker: "후보로 선택됨 — [소싱 시작]을 눌러야 공급 후보 검색 · 원가 계산 대상" };
  if (!(SOURCING_SCOPE_STATUSES as readonly string[]).includes(w)) return { stage: "DISCOVERED", inScope: false, blocker: `알 수 없는 관심상품 단계 ${w}` };
  if (i.linkStatuses.includes("SELECTED")) return { stage: "SUPPLIER_SELECTED", inScope: true, blocker: null };
  if (i.linkStatuses.some((s) => s !== "REJECTED")) return { stage: "SOURCED", inScope: true, blocker: "공급 후보를 비교해 직접 [선택]해야 원가 · 마진 계산" };
  return { stage: "SOURCING", inScope: true, blocker: "공급 후보 없음 — 검색 링크로 공급 페이지를 열고 확장 프로그램으로 저장 (자동 검색 없음)" };
}

export interface StageRow extends StageInput {
  productId: string;
}

/** 소싱 대상 상품 ID (사용자가 명시적으로 [소싱 시작]한 상품만) */
export function sourcingScope(rows: StageRow[]): string[] {
  return rows.filter((r) => productStage(r).inScope).map((r) => r.productId);
}

export type StageCounts = Record<Stage, number> & { total: number; inScope: number };

export function stageCounts(rows: StageRow[]): StageCounts {
  const out = { total: rows.length, inScope: 0, DISCOVERED: 0, SHORTLISTED: 0, REJECTED: 0, BLOCKED: 0, STOPPED: 0, SOURCING: 0, SOURCED: 0, SUPPLIER_SELECTED: 0 } as StageCounts;
  for (const r of rows) {
    const s = productStage(r);
    out[s.stage] += 1;
    if (s.inScope) out.inScope += 1;
  }
  return out;
}
