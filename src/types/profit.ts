import type { Confidence, SourceType } from "./common";

/** 원가 통화. 환율은 사용자가 직접 입력한다 (자동 환율 조회 없음) */
export const COST_CURRENCIES = ["KRW", "CNY", "USD"] as const;
export type CostCurrency = (typeof COST_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<CostCurrency, string> = {
  KRW: "원 (KRW)",
  CNY: "위안 (CNY)",
  USD: "달러 (USD)",
};

/** 시나리오 입력값 (profit_scenarios). 금액은 원, 비율은 0~1. null = 미입력 */
export interface ProfitScenarioInput {
  name: string;
  salePrice: number | null;
  unitCostAmount: number | null;
  unitCostCurrency: CostCurrency;
  exchangeRate: number;
  intlShippingPerUnit: number | null;
  domesticShippingPerUnit: number | null;
  /** null 이면 카테고리 기본 수수료율 */
  coupangFeeRate: number | null;
  logisticsFeePerUnit: number | null;
  adCostRate: number | null;
  adCostPerUnit: number | null;
  otherCostPerUnit: number | null;
  fixedCostTotal: number | null;
  expectedMonthlyUnits: number | null;
  memo: string | null;
}

/** 저장된 계산 결과 (profit_calculations 현재 행) */
export interface ProfitCalculationView {
  id: string;
  formulaVersion: string;
  /** 계산 결과는 항상 자체 계산 */
  source: Extract<SourceType, "CALCULATED">;
  appliedFeeRate: number | null;
  feeRateSource: FeeRateSource | null;
  unitCostKrw: number | null;
  coupangFeeAmount: number | null;
  adCostAmount: number | null;
  totalCostPerUnit: number | null;
  netProfitPerUnit: number | null;
  netMarginRate: number | null;
  roi: number | null;
  breakEvenPrice: number | null;
  breakEvenUnits: number | null;
  monthlyNetProfit: number | null;
  omitted: string[];
  calculatedAt: string;
}

export type FeeRateSource = "SCENARIO" | "CATEGORY";

export interface ProfitScenario extends ProfitScenarioInput {
  id: string;
  productId: string;
  isPrimary: boolean;
  source: SourceType;
  confidence: Confidence;
  createdAt: string;
  updatedAt: string;
  current: ProfitCalculationView | null;
}

/** 수익성 계산에 필요한 상품 정보 */
export interface ProfitProductContext {
  id: string;
  productName: string;
  coupangProductId: string;
  /** 현재 지표의 판매가 (없으면 null) */
  currentPrice: number | null;
  /** 현재 지표의 정가 · 할인율 (참고 표시용, 계산에는 쓰지 않음) */
  originalPrice: number | null;
  discountRate: number | null;
  category: { id: string; name: string; feeRate: number | null } | null;
}

/** /profit 목록 한 줄 */
export interface ProfitOverviewRow {
  scenario: ProfitScenario;
  product: { id: string; productName: string };
}

/** 카테고리 + 기본 수수료율 */
export interface CategoryFeeRow {
  id: string;
  name: string;
  path: string | null;
  feeRate: number | null;
  productCount: number;
  updatedAt: string;
}
