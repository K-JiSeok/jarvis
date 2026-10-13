/**
 * 추정 판매 기회 (PHASE 22 · est-opportunity-v1) — 순수 함수. Score V1 과 별개이며 V1 판정 · 점수를 바꾸지 않는다.
 * "이 상품을 이 가격에 팔면 대략 얼마나 팔리고, 원가가 얼마 이하여야 남는가"를 추정값으로 보여 준다. 매입 추천이 아니다.
 *
 *   추정 월 매출      = 판매량 추정(est-sales-v1) × 판매가
 *   추정 월 이익      = 상세 원가(cost-detail-v1)의 추정 시나리오 개당 이익 × 판매량 범위 (공급 후보 · 비용이 있을 때만)
 *   허용 원가 (원가 상한) = 판매가에서 쿠팡 판매 수수료 · 로켓그로스 입출고 · 배송비를 빼고 목표 마진을 남기는 도착 원가 (VAT 별도)
 *       일반과세자 기준: 판매가 ÷ 1.1 − 수수료 − 입출고 · 배송비 − 목표 마진 × 판매가
 *       수수료율: 카테고리 추정 대분류 요율 (모르면 10.8%) · 입출고 · 배송: 비용 분류 추정 · 크기는 극소형 가정 (크면 비용이 늘어 원가 상한이 낮아짐)
 *       보관 · 반품 · 광고는 넣지 않는다 → 실제 허용 원가는 더 낮다
 */

import type { DetailResult } from "../costs/detail";
import { bandCell, pickCard, salesFeeRate, type RateCard } from "../costs/rate-cards";
import type { SalesEstimate } from "./sales";

export const OPPORTUNITY_VERSION = "est-opportunity-v1";
const DEFAULT_FEE = 0.108;

export interface OpportunityInput {
  today: string;
  price: number | null;
  sales: SalesEstimate;
  cards: RateCard[];
  salesScope: string | null;
  feeGroup: string | null;
  detail: DetailResult | null;
  targetMargins?: number[];
}

export interface Opportunity {
  version: typeof OPPORTUNITY_VERSION;
  revenue: SalesEstimate["revenue"];
  monthlyProfit: { min: number; max: number } | null;
  profitBasis: string | null;
  /** 목표 마진별 허용 도착 원가 (판매 1개, VAT 별도) */
  allowedCost: { margin: number; cost: number | null }[];
  allowedCostBasis: string;
  rankKey: number | null;
}

const r = (n: number) => Math.round(n);

export function estimateOpportunity(i: OpportunityInput): Opportunity {
  const margins = i.targetMargins ?? [0, 0.3];
  let feeRate = DEFAULT_FEE;
  let feeTxt = "수수료 10.8% 가정 (카테고리 모름)";
  const feeCard = i.salesScope ? pickCard(i.cards, "SALES_FEE", i.salesScope, i.today) : null;
  if (feeCard) {
    const f = salesFeeRate(feeCard, null);
    feeRate = f.rate;
    feeTxt = `수수료 ${(f.rate * 100).toFixed(1)}% (${i.salesScope} — 카테고리 추정)`;
  }
  let rg: number | null = null;
  let rgTxt = "로켓그로스 비용 분류 모름";
  if (i.price != null) {
    const groups = i.feeGroup ? [i.feeGroup] : [...new Set(i.cards.filter((c) => c.kind === "RG_INOUT").map((c) => c.scope))];
    const sums = groups
      .map((g) => {
        const a = pickCard(i.cards, "RG_INOUT", g, i.today);
        const b = pickCard(i.cards, "RG_DELIVERY", g, i.today);
        const ca = a ? bandCell(a, i.price!, "XS", i.today) : null;
        const cb = b ? bandCell(b, i.price!, "XS", i.today) : null;
        return ca && cb ? ca.amount + cb.amount : null;
      })
      .filter((x): x is number => x != null);
    if (sums.length) {
      // 분류를 모르면 요율표 있는 분류 중 비싼 쪽 (원가 상한을 높게 잡지 않도록)
      rg = Math.max(...sums);
      rgTxt = `입출고 + 배송 ${rg.toLocaleString("ko-KR")}원 (${i.feeGroup ?? "분류 미확정 — 요율표 중 높은 값"} · 극소형 가정)`;
    }
  }
  const allowedCost = margins.map((m) => ({
    margin: m,
    cost: i.price != null && rg != null ? r(i.price / 1.1 - i.price * feeRate - rg - m * i.price) : null,
  }));

  let monthlyProfit: Opportunity["monthlyProfit"] = null;
  let profitBasis: string | null = null;
  const e = i.detail?.estimated;
  if (e?.computable && e.worst && e.best && i.sales.monthly) {
    const cands = [e.worst.profit * i.sales.monthly.min, e.worst.profit * i.sales.monthly.max, e.best.profit * i.sales.monthly.min, e.best.profit * i.sales.monthly.max];
    monthlyProfit = { min: r(Math.min(...cands)), max: r(Math.max(...cands)) };
    profitBasis = `개당 이익 ${r(e.worst.profit).toLocaleString("ko-KR")} ~ ${r(e.best.profit).toLocaleString("ko-KR")}원 (상세 원가 추정 시나리오${e.omitted.length ? ` · 미포함 비용 ${e.omitted.length}개` : ""}) × 월 판매 추정`;
  }
  return {
    version: OPPORTUNITY_VERSION,
    revenue: i.sales.revenue,
    monthlyProfit,
    profitBasis,
    allowedCost,
    allowedCostBasis: `판매가 ÷ 1.1 − ${feeTxt} − ${rgTxt} − 목표 마진. 보관 · 반품 · 광고 · 부가세 처리 차이는 빠짐 → 실제 허용 원가는 더 낮음`,
    rankKey: i.sales.revenue?.mid ?? null,
  };
}
