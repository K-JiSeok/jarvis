/**
 * 단위 경제성 (PHASE 23 · unit-econ-v1) — 순수 함수. "이 판매가로 단품을 팔면 원가를 얼마까지 쓸 수 있나"를 등급으로.
 *
 * 왜 필요한가: 로켓그로스 입출고 · 배송비는 판매가와 거의 상관없이 개당 2,000~2,900원(할인가, 극소형)이 붙는다.
 *   그래서 판매가가 낮을수록 쿠팡 비용 비중이 급격히 커진다 (4,900원 → 남는 돈 38% · 19,900원 → 66%).
 *
 * 계산 (일반과세자 · VAT 별도 기준, 크기 극소형 가정 — 더 크면 더 나쁨)
 *   쓸 수 있는 도착 원가 = 판매가 ÷ 1.1 − 판매 수수료 − 입출고 · 배송비 − 광고비(판매가 × 가정 비율) − 목표 이익(판매가 × 목표 마진)
 *   도착 원가 = 상품 매입가 + 중국 내 · 국제 운송 + 관세 + 통관 + 포장 · 라벨 (보관 · 반품은 빠짐 → 실제는 더 빠듯)
 *
 * 등급 (쓸 수 있는 도착 원가 기준 — 중국 소형 잡화의 운송 포함 도착 원가가 보통 개당 수천 원이라는 점을 반영한 기준)
 *   AVOID   1,500원 미만   단품 판매 비추천 (운송비만으로도 넘기 쉬움) → 묶음(2 · 3개 세트)으로만 검토
 *   CAUTION 1,500 ~ 4,000원 원가가 아주 싸야 가능 — 공급 후보의 실제 도착 원가 확인 필수
 *   OK      4,000원 이상    가격 구조상 여유 있음 (그래도 실제 원가 · 광고 효율 확인 필요)
 * 이 기준값 · 광고 비율 · 목표 마진은 가정이다 (화면에 표시, 상품 판단은 사용자).
 */

import { bandCell, pickCard, salesFeeRate, type RateCard } from "../costs/rate-cards";

export const UNIT_ECON_VERSION = "unit-econ-v1";
export const ECON_ASSUMPTIONS = { targetMargin: 0.3, adRate: 0.1, avoidBelow: 1500, cautionBelow: 4000, bundleDiscount: 0.9 };

export type EconGrade = "OK" | "CAUTION" | "AVOID";
export const ECON_LABELS: Record<EconGrade, string> = { OK: "가격 구조 적정", CAUTION: "원가 매우 저렴해야 함", AVOID: "단품 판매 비추천 (저가)" };

export interface EconInput {
  today: string;
  price: number;
  cards: RateCard[];
  salesScope: string | null;
  feeGroup: string | null;
}

export interface EconScenario {
  units: number;
  /** 묶음 판매가 (단품 × 개수 × 0.9 가정) */
  price: number;
  /** 쿠팡 비용 뒤 남는 돈 (VAT 별도) */
  left: number;
  /** 묶음 1개(판매 단위)로 쓸 수 있는 도착 원가 — 상품 1개당은 ÷ units */
  allowedPerUnit: number;
  grade: EconGrade;
}

export interface UnitEconomics {
  version: typeof UNIT_ECON_VERSION;
  grade: EconGrade;
  single: EconScenario;
  bundles: EconScenario[];
  /** 로켓그로스 할인(프로모션)이 끝난 뒤 기본 비용 기준 단품 */
  afterPromo: EconScenario | null;
  promoUntil: string | null;
  bestBundle: EconScenario | null;
  basis: string;
}

function gradeOf(allowed: number): EconGrade {
  return allowed < ECON_ASSUMPTIONS.avoidBelow ? "AVOID" : allowed < ECON_ASSUMPTIONS.cautionBelow ? "CAUTION" : "OK";
}

export function unitEconomics(i: EconInput): UnitEconomics | null {
  const feeCard = i.salesScope ? pickCard(i.cards, "SALES_FEE", i.salesScope, i.today) : null;
  const feeRate = feeCard ? salesFeeRate(feeCard, null).rate : 0.108;
  const groups = i.feeGroup ? [i.feeGroup] : [...new Set(i.cards.filter((c) => c.kind === "RG_INOUT").map((c) => c.scope))];
  if (groups.length === 0) return null;
  const rgAt = (p: number, onDate: string) => {
    const sums = groups
      .map((g) => {
        const a = pickCard(i.cards, "RG_INOUT", g, onDate);
        const b = pickCard(i.cards, "RG_DELIVERY", g, onDate);
        const ca = a ? bandCell(a, p, "XS", onDate) : null;
        const cb = b ? bandCell(b, p, "XS", onDate) : null;
        return ca && cb ? ca.amount + cb.amount : null;
      })
      .filter((x): x is number => x != null);
    return sums.length ? Math.max(...sums) : null;
  };
  const scen = (units: number, onDate: string): EconScenario | null => {
    const p = units === 1 ? i.price : Math.round((i.price * units * ECON_ASSUMPTIONS.bundleDiscount) / 100) * 100;
    const rg = rgAt(p, onDate);
    if (rg == null) return null;
    const left = p / 1.1 - p * feeRate - rg;
    const allowed = left - p * ECON_ASSUMPTIONS.adRate - p * ECON_ASSUMPTIONS.targetMargin;
    const perUnit = Math.round(allowed / units);
    return { units, price: p, left: Math.round(left), allowedPerUnit: perUnit, grade: gradeOf(perUnit) };
  };
  const single = scen(1, i.today);
  if (!single) return null;
  const bundles = [2, 3].map((n) => scen(n, i.today)).filter((x): x is EconScenario => x != null);
  // 묶음 등급도 상품 1개당 쓸 수 있는 원가로 판단 (묶음 판매 단위의 크기 · 무게가 극소형을 넘으면 더 나빠짐)
  const promoCard = pickCard(i.cards, "RG_INOUT", groups[0], i.today);
  const promoUntil = promoCard?.promoUntil ?? null;
  let afterPromo: EconScenario | null = null;
  if (promoUntil) {
    const d = new Date(Date.parse(promoUntil) + 86_400_000).toISOString().slice(0, 10);
    afterPromo = scen(1, d);
  }
  const bestBundle = bundles.filter((b) => b.allowedPerUnit > single.allowedPerUnit).sort((a, b) => b.allowedPerUnit - a.allowedPerUnit)[0] ?? null;
  return {
    version: UNIT_ECON_VERSION,
    grade: single.grade,
    single,
    bundles,
    afterPromo,
    promoUntil,
    bestBundle,
    basis: `판매가 ÷ 1.1 − 수수료 ${(feeRate * 100).toFixed(1)}% − 로켓그로스 입출고 · 배송(극소형${i.feeGroup ? "" : " · 분류 미확정이라 요율표 중 높은 값"}) − 광고 ${ECON_ASSUMPTIONS.adRate * 100}% − 목표 마진 ${ECON_ASSUMPTIONS.targetMargin * 100}% (가정). 묶음가 = 단품가 × 개수 × ${ECON_ASSUMPTIONS.bundleDiscount}`,
  };
}
