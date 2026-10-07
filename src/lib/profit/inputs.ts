import type { FeeRateSource, ProfitScenarioInput } from "@/types/profit";

import type { ProfitInput } from "./calculate";

/**
 * 시나리오 입력 → 계산 입력. 서버(저장)와 브라우저(미리 보기)가 같은 규칙을 쓴다.
 * 수수료율: 시나리오에 입력한 값 → 없으면 카테고리 기본값 → 둘 다 없으면 null (계산 안 함).
 */
export function resolveFeeRate(
  scenarioRate: number | null,
  categoryRate: number | null,
): { feeRate: number | null; source: FeeRateSource | null } {
  if (scenarioRate != null) return { feeRate: scenarioRate, source: "SCENARIO" };
  if (categoryRate != null) return { feeRate: categoryRate, source: "CATEGORY" };
  return { feeRate: null, source: null };
}

export function toProfitInput(s: ProfitScenarioInput, categoryFeeRate: number | null): ProfitInput {
  return {
    salePrice: s.salePrice,
    unitCostAmount: s.unitCostAmount,
    exchangeRate: s.unitCostCurrency === "KRW" ? 1 : s.exchangeRate,
    intlShippingPerUnit: s.intlShippingPerUnit,
    domesticShippingPerUnit: s.domesticShippingPerUnit,
    feeRate: resolveFeeRate(s.coupangFeeRate, categoryFeeRate).feeRate,
    logisticsFeePerUnit: s.logisticsFeePerUnit,
    adCostRate: s.adCostRate,
    adCostPerUnit: s.adCostPerUnit,
    otherCostPerUnit: s.otherCostPerUnit,
    fixedCostTotal: s.fixedCostTotal,
    expectedMonthlyUnits: s.expectedMonthlyUnits,
  };
}

export const OMITTED_LABELS: Record<string, string> = {
  intlShippingPerUnit: "해외 배송비",
  domesticShippingPerUnit: "국내 배송비",
  logisticsFeePerUnit: "로켓그로스 물류비",
  adCost: "광고비",
  otherCostPerUnit: "기타 비용",
};

export const REQUIRED_LABELS: Record<string, string> = {
  salePrice: "판매가",
  unitCostAmount: "원가",
  feeRate: "쿠팡 수수료율",
};
