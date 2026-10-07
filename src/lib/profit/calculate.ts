/**
 * 수익성 계산 (profit-v1). 순수 함수 — DB · UI 와 무관하고 서버·브라우저 어디서나 같은 결과를 낸다.
 * 다른 모듈을 import 하지 않는다 (Node 테스트 스크립트에서 직접 실행).
 *
 * 단위: 1개 판매 기준, 원(KRW). 판매가는 쿠팡 노출가(VAT 포함)를 그대로 쓴다. VAT 분리 계산은 하지 않는다.
 *
 *   상품 원가(원화)   = 원가 × 환율
 *   판매가 비례 비용  = 판매가 × (쿠팡 수수료율 + 광고비율)        ← 광고비를 비율로 입력한 경우만
 *   개당 고정 비용    = 상품 원가 + 해외 배송비 + 국내 배송비 + 로켓그로스 물류비 + 기타 비용 (+ 광고비 금액)
 *   총비용            = 개당 고정 비용 + 판매가 비례 비용
 *   순이익            = 판매가 − 총비용
 *   순이익률          = 순이익 ÷ 판매가
 *   투자원가          = 상품 원가 + 해외 배송비 + 국내 배송비   (재고로 묶이는 돈)
 *   ROI               = 순이익 ÷ 투자원가
 *   손익분기 판매가   = 개당 고정 비용 ÷ (1 − 판매가 비례 비율)    → 이 가격에서 순이익 ≥ 0
 *   손익분기 판매량   = 초기 고정비 ÷ 개당 순이익                  (고정비가 있고 순이익 > 0 일 때)
 *   월 순이익         = 개당 순이익 × 월 예상 판매량
 *
 * 필수: 판매가 · 원가 · 수수료율. 하나라도 없으면 결과는 모두 null (추정해서 채우지 않는다).
 * 선택 비용(배송비·물류비·광고비·기타)을 비워 두면 계산에서 제외하고 omitted 에 남긴다.
 */

export const PROFIT_FORMULA_VERSION = "profit-v1";

/** DB numeric(9,4) 로 저장 가능한 ROI 범위 */
const ROI_LIMIT = 99999.9999;

export interface ProfitInput {
  /** 판매가 (원, VAT 포함) */
  salePrice: number | null;
  /** 상품 원가 (원 통화 금액) */
  unitCostAmount: number | null;
  /** 원가 통화 → 원 환율 (KRW 이면 1) */
  exchangeRate: number;
  intlShippingPerUnit: number | null;
  domesticShippingPerUnit: number | null;
  /** 쿠팡 판매 수수료율 0~1 (시나리오 값 또는 카테고리 기본값) */
  feeRate: number | null;
  /** 로켓그로스 입출고·보관·배송비 (개당) */
  logisticsFeePerUnit: number | null;
  /** 광고비: 매출 대비 비율 0~1 또는 개당 금액 (둘 중 하나) */
  adCostRate: number | null;
  adCostPerUnit: number | null;
  /** 포장재 등 기타 상품 원가 · 기타 플랫폼 비용 (개당) */
  otherCostPerUnit: number | null;
  /** 초기 고정비 (샘플·촬영·첫 발주 부대비용 등) */
  fixedCostTotal: number | null;
  expectedMonthlyUnits: number | null;
}

export type OptionalCostField =
  | "intlShippingPerUnit"
  | "domesticShippingPerUnit"
  | "logisticsFeePerUnit"
  | "adCost"
  | "otherCostPerUnit";

export interface ProfitResult {
  formulaVersion: typeof PROFIT_FORMULA_VERSION;
  /** 필수 입력이 모두 있어 계산했는가 */
  complete: boolean;
  missingRequired: ("salePrice" | "unitCostAmount" | "feeRate")[];
  /** 비워 둬서 계산에서 제외한 선택 비용 */
  omitted: OptionalCostField[];
  errors: string[];
  warnings: string[];
  unitCostKrw: number | null;
  feeAmount: number | null;
  adCostAmount: number | null;
  /** 판매가 비례 비율 (수수료율 + 광고비율) */
  variableRate: number | null;
  fixedCostPerUnit: number | null;
  totalCostPerUnit: number | null;
  netProfitPerUnit: number | null;
  netMarginRate: number | null;
  investmentPerUnit: number | null;
  roi: number | null;
  breakEvenPrice: number | null;
  breakEvenUnits: number | null;
  monthlyNetProfit: number | null;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 순이익률 = 순이익 ÷ 판매가. 판매가가 0 이하이면 null */
export function calculateMargin(netProfit: number | null, salePrice: number | null): number | null {
  if (netProfit == null || salePrice == null || salePrice <= 0) return null;
  return round4(netProfit / salePrice);
}

/** ROI = 순이익 ÷ 투자원가. 투자원가가 0 이하이면 null */
export function calculateROI(netProfit: number | null, investment: number | null): number | null {
  if (netProfit == null || investment == null || investment <= 0) return null;
  return round4(netProfit / investment);
}

/** 손익분기 판매가 = 개당 고정 비용 ÷ (1 − 판매가 비례 비율). 비례 비율이 100% 이상이면 도달 불가(null) */
export function calculateBreakEvenPrice(fixedCostPerUnit: number | null, variableRate: number | null): number | null {
  if (fixedCostPerUnit == null || variableRate == null || variableRate >= 1) return null;
  return Math.ceil(fixedCostPerUnit / (1 - variableRate));
}

/** 손익분기 판매량 = 초기 고정비 ÷ 개당 순이익 (올림). 고정비가 없거나 순이익 ≤ 0 이면 null */
export function calculateBreakEvenUnits(fixedCostTotal: number | null, netProfitPerUnit: number | null): number | null {
  if (fixedCostTotal == null || fixedCostTotal <= 0 || netProfitPerUnit == null || netProfitPerUnit <= 0) return null;
  return Math.ceil(fixedCostTotal / netProfitPerUnit);
}

const EMPTY_RESULT = {
  unitCostKrw: null,
  feeAmount: null,
  adCostAmount: null,
  variableRate: null,
  fixedCostPerUnit: null,
  totalCostPerUnit: null,
  netProfitPerUnit: null,
  netMarginRate: null,
  investmentPerUnit: null,
  roi: null,
  breakEvenPrice: null,
  breakEvenUnits: null,
  monthlyNetProfit: null,
} as const;

export function calculateProfit(input: ProfitInput): ProfitResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missingRequired: ProfitResult["missingRequired"] = [];
  if (input.salePrice == null) missingRequired.push("salePrice");
  if (input.unitCostAmount == null) missingRequired.push("unitCostAmount");
  if (input.feeRate == null) missingRequired.push("feeRate");

  if (input.adCostRate != null && input.adCostPerUnit != null) errors.push("광고비는 비율 또는 개당 금액 중 하나만 입력하세요.");
  if (!(input.exchangeRate > 0)) errors.push("환율은 0보다 커야 합니다.");
  if (input.feeRate != null && (input.feeRate < 0 || input.feeRate > 1)) errors.push("수수료율은 0~100% 입니다.");
  if (input.adCostRate != null && (input.adCostRate < 0 || input.adCostRate > 1)) errors.push("광고비율은 0~100% 입니다.");

  const omitted: OptionalCostField[] = [];
  const optional = (field: Exclude<OptionalCostField, "adCost">) => {
    const v = input[field];
    if (v == null) omitted.push(field);
    return v ?? 0;
  };
  const intl = optional("intlShippingPerUnit");
  const domestic = optional("domesticShippingPerUnit");
  const logistics = optional("logisticsFeePerUnit");
  const other = optional("otherCostPerUnit");
  if (input.adCostRate == null && input.adCostPerUnit == null) omitted.push("adCost");

  const base = { formulaVersion: PROFIT_FORMULA_VERSION, missingRequired, omitted, errors, warnings } as const;
  if (missingRequired.length > 0 || errors.length > 0) {
    return { ...base, complete: false, ...EMPTY_RESULT };
  }

  const salePrice = input.salePrice!;
  const feeRate = input.feeRate!;
  const unitCostKrw = Math.round(input.unitCostAmount! * input.exchangeRate);
  const adRate = input.adCostRate ?? 0;
  const adFixed = input.adCostPerUnit ?? 0;

  const variableRate = round4(feeRate + adRate);
  const feeAmount = Math.round(salePrice * feeRate);
  const adCostAmount = input.adCostPerUnit != null ? adFixed : Math.round(salePrice * adRate);
  const fixedCostPerUnit = unitCostKrw + intl + domestic + logistics + other + adFixed;
  const totalCostPerUnit = fixedCostPerUnit + feeAmount + (input.adCostPerUnit != null ? 0 : adCostAmount);
  const netProfitPerUnit = salePrice - totalCostPerUnit;
  const investmentPerUnit = unitCostKrw + intl + domestic;

  let roi = calculateROI(netProfitPerUnit, investmentPerUnit);
  if (roi != null && Math.abs(roi) > ROI_LIMIT) {
    warnings.push("ROI 가 저장 범위를 넘어 표시하지 않습니다 (투자원가가 매우 작음).");
    roi = null;
  }
  if (investmentPerUnit <= 0) warnings.push("투자원가(원가+배송비)가 0 이라 ROI 를 계산하지 않습니다.");
  if (variableRate >= 1) warnings.push("수수료·광고비율 합이 100% 이상이라 손익분기 판매가가 없습니다.");

  return {
    ...base,
    complete: true,
    unitCostKrw,
    feeAmount,
    adCostAmount,
    variableRate,
    fixedCostPerUnit,
    totalCostPerUnit,
    netProfitPerUnit,
    netMarginRate: calculateMargin(netProfitPerUnit, salePrice),
    investmentPerUnit,
    roi,
    breakEvenPrice: calculateBreakEvenPrice(fixedCostPerUnit, variableRate),
    breakEvenUnits: calculateBreakEvenUnits(input.fixedCostTotal, netProfitPerUnit),
    monthlyNetProfit: input.expectedMonthlyUnits != null ? netProfitPerUnit * input.expectedMonthlyUnits : null,
  };
}
