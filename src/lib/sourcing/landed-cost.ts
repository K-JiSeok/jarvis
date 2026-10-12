/**
 * 도착 원가 · 예상 수익성 (순수 함수, PHASE 18 · landed-cost-v1). 이익 계산은 기존 Profit Engine(calculateProfit) 그대로.
 *
 * 항목을 세 가지로 나눈다
 *   CONFIRMED  공급 페이지에 보인 값 (상품 가격 · 수량 구간 · 사이트 표시 배송비) · 공식 환율 · 법정 세율(수입 부가세 10%)
 *   ESTIMATED  범위 추정 (관세율 — 품목분류 미확정 · 쿠팡 수수료율 — 카테고리 미확정)
 *   UNKNOWN    값 없음 → 0 으로 넣지 않고 "미포함" 으로 표시 (중국 내 배송비 · 구매대행 · 결제 수수료 · 통관 수수료 · 국내 배송 · 광고비)
 *
 * 세금 기준 (확인한 것)
 *   수입 부가세 = (과세가격 + 관세) × 10%. 판매용 수입은 미화 150달러 이하라도 소액 면세 대상이 아니다 (상업용 신고 대상)
 *   관세: HS 3924.10 (플라스틱 주방용품) 기본세율 8% 확인. 실리콘 제품은 고무 제품(40류)으로 분류될 수도 있고 한중 FTA 세율은 미확인
 *         → 0 ~ 8% 범위로만 표시 (품목분류 확정 전)
 *   과세가격 = 물품 가격 + 해외 운송비(+보험료). 운송비를 모르면 과세가격이 낮게 잡혀 세액도 낮게 나온다 → 경고
 *   수입 부가세는 일반과세자라면 매입세액 공제 대상일 수 있다 — 여기서는 현금으로 나가는 비용으로 보수적으로 포함
 *
 * Profit Engine 연결 (구조 변경 없음): unitCostAmount = 물품 가격(원래 통화) × 묶음 수 · exchangeRate = 환율 ·
 *   intlShippingPerUnit = 사이트 표시 배송비(있을 때) · otherCostPerUnit = 관세 + 수입 부가세 (엔진에 전용 칸이 없어 기타로 — 화면에 내역 표시)
 * 이 미리 보기는 시나리오로 저장하지 않는다 (확정 원가가 아니므로). "확정 수익성 분석 완료"는 미확인 비용이 하나도 없을 때만.
 */

import { calculateProfit, type ProfitResult } from "../profit/calculate";

export const LANDED_COST_VERSION = "landed-cost-v1";

/** 관세율 추정 범위 (품목분류 확정 전) */
export const TARIFF_RANGE = { min: 0, max: 0.08, basis: "HS 3924.10 기본세율 8% (실리콘 품목분류 · 한중 FTA 세율 미확인 → 0~8%)" };
export const IMPORT_VAT_RATE = 0.1;
/** 쿠팡 판매 수수료율 추정 범위 — 공개 안내 기준 카테고리별 약 4~10.8% (상품 카테고리 수수료율 미설정 시) */
export const COUPANG_FEE_RANGE = { min: 0.04, max: 0.108, basis: "공개 자료 기준 카테고리별 약 4~10.8% — 정확한 값은 WING 수수료표" };

export interface FxRate {
  currency: string;
  /** 1 단위 = 원 */
  krw: number;
  source: string;
  rateDate: string;
}

export interface LandedCostInput {
  /** 공급 단가 (원래 통화). 화면 표시(환산) 값만 있으면 currency = KRW · displayConverted = true */
  unitPrice: { amount: number; currency: string; basis: string; displayConverted: boolean };
  /** 쿠팡 1개 상품 = 공급 단위 몇 개 (모르면 1 로 계산하고 경고) */
  unitsPerListing: number | null;
  /** 원가 통화 환율 (KRW 이면 null 가능) */
  fx: FxRate | null;
  /** 사이트 표시 배송비 (원) — N 개당 */
  shipping: { perQty: number; amountKrw: number; text: string } | null;
  orderQty: number;
  salePrice: number | null;
  /** 상품 카테고리 수수료율 (설정돼 있으면 확정값처럼 쓰지 않고 '설정값'으로 표시) */
  feeRate: number | null;
  targetMargins?: number[];
}

export type CostStatus = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
export interface CostLine {
  key: string;
  label: string;
  status: CostStatus;
  min: number | null;
  max: number | null;
  basis: string;
}

export interface LandedCostResult {
  version: string;
  lines: CostLine[];
  /** 쿠팡 1개 상품 기준 도착 원가 범위 (원) — 미확인 비용 제외 */
  landed: { min: number; max: number } | null;
  unknownItems: string[];
  warnings: string[];
  fx: FxRate | null;
  profit: { low: ProfitResult; high: ProfitResult } | null;
  targetPrices: { margin: number; min: number | null; max: number | null }[];
  /** C = 참고용 추정 · B = 신뢰도 높은 추정. A(확정)는 미확인 비용이 없고 추정 범위도 없을 때만 */
  confidence: "A" | "B" | "C";
  confirmedProfitability: boolean;
}

const r = (n: number) => Math.round(n);

export function calculateLandedCost(i: LandedCostInput): LandedCostResult {
  const warnings: string[] = [];
  const lines: CostLine[] = [];
  const units = i.unitsPerListing ?? 1;
  if (i.unitsPerListing == null) warnings.push("구성 수량을 몰라 공급 1단위 = 쿠팡 1개로 계산했습니다");

  const rate = i.unitPrice.currency === "KRW" ? 1 : i.fx && i.fx.currency === i.unitPrice.currency ? i.fx.krw : null;
  if (rate == null) {
    return { version: LANDED_COST_VERSION, lines, landed: null, unknownItems: ["환율"], warnings: [`${i.unitPrice.currency} 환율이 없어 원가를 계산할 수 없습니다`], fx: i.fx, profit: null, targetPrices: [], confidence: "C", confirmedProfitability: false };
  }
  const goods = i.unitPrice.amount * rate * units;
  lines.push({
    key: "goods",
    label: `상품 매입가 (${i.unitPrice.amount} ${i.unitPrice.currency} × ${units}${rate !== 1 ? ` × ${rate}` : ""})`,
    status: "CONFIRMED",
    min: r(goods),
    max: r(goods),
    basis: `${i.unitPrice.basis}${i.unitPrice.displayConverted ? " — 사이트가 원화로 환산해 보여 준 값" : ""}${rate !== 1 && i.fx ? ` · 환율 ${i.fx.source} ${i.fx.rateDate}` : ""}`,
  });
  if (i.unitPrice.displayConverted) warnings.push("사이트 표시 원화 가격을 썼습니다 (사이트 환율 기준 — 실제 결제 금액과 다를 수 있음)");

  let shipping: number | null = null;
  if (i.shipping) {
    shipping = (i.shipping.amountKrw / i.shipping.perQty) * units;
    lines.push({ key: "shipping", label: "해외 운송비 (사이트 표시)", status: "CONFIRMED", min: r(shipping), max: r(shipping), basis: `"${i.shipping.text.slice(0, 60)}" → ${i.shipping.perQty}개당 ${i.shipping.amountKrw.toLocaleString("ko-KR")}원 (접속 주소 · 시점 기준, 확정 운임 아님)` });
  } else {
    lines.push({ key: "shipping", label: "해외 운송비", status: "UNKNOWN", min: null, max: null, basis: "공급 페이지에 배송비 없음 — 포워더 견적 필요" });
  }
  const unknown = ["중국 내 배송비 (사이트 표시 운송비에 포함되는지 미확인)", "구매대행 · 결제 수수료", "통관 수수료 · 기타 부대비용", "국내 배송 · 입고비", "광고비"];
  for (const u of unknown) lines.push({ key: u, label: u, status: "UNKNOWN", min: null, max: null, basis: "값 없음 — 0 으로 넣지 않음" });

  const customsValue = goods + (shipping ?? 0);
  if (shipping == null) warnings.push("해외 운송비를 몰라 과세가격 · 세액이 낮게 잡힙니다");
  const dutyMin = customsValue * TARIFF_RANGE.min;
  const dutyMax = customsValue * TARIFF_RANGE.max;
  lines.push({ key: "duty", label: "관세", status: "ESTIMATED", min: r(dutyMin), max: r(dutyMax), basis: TARIFF_RANGE.basis });
  const vatMin = (customsValue + dutyMin) * IMPORT_VAT_RATE;
  const vatMax = (customsValue + dutyMax) * IMPORT_VAT_RATE;
  lines.push({ key: "vat", label: "수입 부가세 10%", status: "CONFIRMED", min: r(vatMin), max: r(vatMax), basis: "(과세가격 + 관세) × 10% — 세율 확정, 금액은 관세 범위에 따라 · 매입세액 공제 가능성 있음" });
  warnings.push("판매용 수입은 금액과 관계없이 소액 면세(미화 150달러) 대상이 아니라 관세 · 부가세를 포함해 계산했습니다");

  const landed = { min: r(goods + (shipping ?? 0) + dutyMin + vatMin), max: r(goods + (shipping ?? 0) + dutyMax + vatMax) };

  const feeKnown = i.feeRate != null;
  const feeLow = feeKnown ? i.feeRate! : COUPANG_FEE_RANGE.min;
  const feeHigh = feeKnown ? i.feeRate! : COUPANG_FEE_RANGE.max;
  if (!feeKnown) lines.push({ key: "fee", label: "쿠팡 판매 수수료", status: "ESTIMATED", min: feeLow, max: feeHigh, basis: COUPANG_FEE_RANGE.basis });
  else lines.push({ key: "fee", label: "쿠팡 판매 수수료 (카테고리 설정값)", status: "CONFIRMED", min: feeLow, max: feeHigh, basis: "카테고리 수수료율 설정값" });

  const profitOf = (cost: { goods: number; duties: number }, fee: number) =>
    calculateProfit({
      salePrice: i.salePrice,
      unitCostAmount: Math.round(cost.goods),
      exchangeRate: 1,
      intlShippingPerUnit: shipping != null ? r(shipping) : null,
      domesticShippingPerUnit: null,
      feeRate: fee,
      logisticsFeePerUnit: null,
      adCostRate: null,
      adCostPerUnit: null,
      otherCostPerUnit: r(cost.duties),
      fixedCostTotal: null,
      expectedMonthlyUnits: null,
    });
  // 좋은 경우 = 낮은 세금 · 낮은 수수료 / 나쁜 경우 = 높은 세금 · 높은 수수료
  const profit = i.salePrice != null ? { low: profitOf({ goods, duties: dutyMax + vatMax }, feeHigh), high: profitOf({ goods, duties: dutyMin + vatMin }, feeLow) } : null;
  if (i.salePrice == null) warnings.push("판매가가 없어 이익을 계산하지 않았습니다");

  const targetPrices = (i.targetMargins ?? [0.1, 0.2, 0.3]).map((m) => ({
    margin: m,
    min: 1 - feeLow - m > 0 ? r(landed.min / (1 - feeLow - m)) : null,
    max: 1 - feeHigh - m > 0 ? r(landed.max / (1 - feeHigh - m)) : null,
  }));

  const unknownItems = lines.filter((l) => l.status === "UNKNOWN").map((l) => l.label);
  const hasEstimate = lines.some((l) => l.status === "ESTIMATED") || i.unitPrice.displayConverted || i.unitsPerListing == null;
  const confidence = unknownItems.length === 0 && !hasEstimate ? "A" : unknownItems.length <= 1 && !i.unitPrice.displayConverted ? "B" : "C";
  return { version: LANDED_COST_VERSION, lines, landed, unknownItems, warnings, fx: i.fx, profit, targetPrices, confidence, confirmedProfitability: confidence === "A" };
}

/** 공급 후보 → 원가 계산에 쓸 단가 (원래 통화 우선 · MOQ 구간) */
export function pickUnitPrice(offer: { basePrice: { amount: number; currency: string } | null; tiers: { minQty: number; maxQty: number | null; amount: number; currency: string }[]; tiersConverted: boolean; moq: number | null }, orderQty: number) {
  const tier = [...offer.tiers].filter((t) => orderQty >= t.minQty && (t.maxQty == null || orderQty <= t.maxQty)).pop() ?? offer.tiers[0] ?? null;
  // Alibaba JSON-LD 가격은 최저 구간(최대 수량) 가격이라 MOQ 수량의 가격이 아닐 수 있다 → 구간 가격이 있으면 그 구간을 쓴다
  if (tier) return { amount: tier.amount, currency: tier.currency, basis: `${tier.minQty}${tier.maxQty ? `~${tier.maxQty}` : "+"}개 구간 가격`, displayConverted: offer.tiersConverted, tierMinQty: tier.minQty };
  if (offer.basePrice) return { amount: offer.basePrice.amount, currency: offer.basePrice.currency, basis: "구조화 데이터 가격 (최저 구간일 수 있음)", displayConverted: false, tierMinQty: null };
  return null;
}
