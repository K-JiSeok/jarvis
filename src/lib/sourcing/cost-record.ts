/**
 * 선택한 공급 후보의 원가 계산 이력 · 공급 상태 (순수 함수, PHASE 19).
 *
 *   costRecord   계산 결과 → supply_cost_snapshots 1행 (입력 지문 input_hash 포함 — 같은 입력이면 다시 쌓지 않는다)
 *   supplyState  상품의 공급 후보 · 선택 · 원가 상태를 화면 표시용 단계로 (예상 이익이어도 매입 · 판매 추천이 아니다)
 */

import { LANDED_COST_VERSION, type LandedCostResult } from "./landed-cost";
import { MATCH_RULE_VERSION, type MatchLevel } from "./matching";

/** 입력 지문 (FNV-1a 32bit 두 번 — 보안용 해시가 아니라 "같은 입력인가" 판별용) */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  const h = (seed: number) => {
    let x = seed;
    for (let i = 0; i < text.length; i += 1) {
      x ^= text.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, "0");
  };
  return `${h(0x811c9dc5)}${h(0x01000193)}`;
}

export interface CostRecordInput {
  productId: string;
  offerId: string;
  linkId: string;
  matchLevel: MatchLevel;
  salePrice: number | null;
  feeRate: number | null;
  orderQty: number;
  unitsPerListing: number | null;
  unitPrice: { amount: number; currency: string; basis: string; displayConverted: boolean; tierMinQty: number | null };
  landed: LandedCostResult;
  profitFormulaVersion: string;
}

export function costRecord(i: CostRecordInput) {
  const l = i.landed;
  const engine = { landed: LANDED_COST_VERSION, match: MATCH_RULE_VERSION, profit: i.profitFormulaVersion };
  // 지문: 결과를 바꾸는 입력만 (계산 시각 제외) — 공급가 · 구간 · 환율(값 · 기준일) · 운송비 · 판매가 · 수수료 · 묶음 수 · 엔진 버전
  const inputs = {
    unitPrice: i.unitPrice,
    unitsPerListing: i.unitsPerListing,
    orderQty: i.orderQty,
    fx: l.fx ? { c: l.fx.currency, krw: l.fx.krw, d: l.fx.rateDate } : null,
    shipping: l.lines.find((x) => x.key === "shipping")?.min ?? null,
    salePrice: i.salePrice,
    feeRate: i.feeRate,
    match: i.matchLevel,
    engine,
  };
  const pr = (p: { netProfitPerUnit: number | null; netMarginRate: number | null; breakEvenPrice: number | null; complete: boolean } | null) =>
    p ? { complete: p.complete, netProfitPerUnit: p.netProfitPerUnit, netMarginRate: p.netMarginRate, breakEvenPrice: p.breakEvenPrice } : null;
  return {
    product_id: i.productId,
    offer_id: i.offerId,
    link_id: i.linkId,
    input_hash: fingerprint(inputs),
    sale_price: i.salePrice,
    fee_rate: i.feeRate,
    fee_source: (i.feeRate != null ? "CATEGORY" : "ESTIMATED_RANGE") as "CATEGORY" | "ESTIMATED_RANGE",
    order_qty: i.orderQty,
    units_per_listing: i.unitsPerListing,
    unit_price: i.unitPrice,
    fx: l.fx,
    lines: l.lines,
    landed_min: l.landed?.min ?? null,
    landed_max: l.landed?.max ?? null,
    confirmed_only: l.confirmedOnly ? { cost: l.confirmedOnly.cost, excluded: l.confirmedOnly.excluded, profit: pr(l.confirmedOnly.profit) } : { cost: null, excluded: [], profit: null },
    estimated: l.profit ? { low: pr(l.profit.low), high: pr(l.profit.high) } : null,
    insufficient: l.insufficient,
    target_prices: l.targetPrices,
    confidence: l.confidence,
    match_level: i.matchLevel,
    engine,
  };
}

export type SupplyStateKey =
  | "NO_CANDIDATE"
  | "COLLECTED"
  | "MATCH_UNCLEAR"
  | "SELECTED"
  | "COST_COMPUTED"
  | "ESTIMATE_ONLY"
  | "UNKNOWN_COSTS"
  | "NOT_COMPUTABLE"
  | "EXPECTED_LOSS"
  | "EXPECTED_PROFIT";

export const SUPPLY_STATE_LABELS: Record<SupplyStateKey, string> = {
  NO_CANDIDATE: "공급 후보 없음",
  COLLECTED: "공급 후보 수집됨 · 선택 전",
  MATCH_UNCLEAR: "매칭 불명확",
  SELECTED: "공급 후보 선택됨",
  COST_COMPUTED: "원가 계산 완료 (확정)",
  ESTIMATE_ONLY: "추정 원가만 존재",
  UNKNOWN_COSTS: "미확인 비용 존재",
  NOT_COMPUTABLE: "수익성 분석 불가",
  EXPECTED_LOSS: "예상 손실",
  EXPECTED_PROFIT: "예상 이익 (추천 아님)",
};

interface StateLink {
  userStatus: "CANDIDATE" | "SELECTED" | "REJECTED";
  matchLevel: MatchLevel;
  landed: Pick<LandedCostResult, "landed" | "unknownItems" | "confidence" | "profit"> | null;
}

/** 상품 1개의 공급 상태 — 원가 · 수익 상태는 사용자가 [선택]한 후보만 본다 (제외 후보 · 미선택 후보는 원가에 쓰지 않음) */
export function supplyState(links: StateLink[]): SupplyStateKey[] {
  const live = links.filter((l) => l.userStatus !== "REJECTED");
  if (live.length === 0) return ["NO_CANDIDATE"];
  const selected = live.filter((l) => l.userStatus === "SELECTED");
  if (selected.length === 0) return ["COLLECTED", ...(live.every((l) => l.matchLevel === "UNCLEAR") ? (["MATCH_UNCLEAR"] as const) : [])];
  const out: SupplyStateKey[] = ["SELECTED"];
  const s = selected[0];
  if (s.matchLevel === "UNCLEAR") out.push("MATCH_UNCLEAR");
  const lc = s.landed;
  if (!lc?.landed || !lc.profit) return [...out, "NOT_COMPUTABLE"];
  out.push(lc.confidence === "A" ? "COST_COMPUTED" : "ESTIMATE_ONLY");
  if (lc.unknownItems.length) out.push("UNKNOWN_COSTS");
  const hi = lc.profit.high.netProfitPerUnit;
  const lo = lc.profit.low.netProfitPerUnit;
  if (hi != null && hi < 0) out.push("EXPECTED_LOSS");
  else if (lo != null && lo > 0) out.push("EXPECTED_PROFIT");
  return out;
}
