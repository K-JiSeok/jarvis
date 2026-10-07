import { isConfidence, isSourceType, type Tables } from "@/types/db";
import { COST_CURRENCIES, type CostCurrency, type FeeRateSource, type ProfitCalculationView, type ProfitScenario } from "@/types/profit";

type ScenarioRow = Tables<"profit_scenarios">;
type CalculationRow = Tables<"profit_calculations">;

function asCurrency(v: string): CostCurrency {
  const c = v.trim();
  return (COST_CURRENCIES as readonly string[]).includes(c) ? (c as CostCurrency) : "KRW";
}

export function toProfitCalculationView(row: CalculationRow): ProfitCalculationView {
  const snap = (row.inputs_snapshot ?? {}) as Record<string, unknown>;
  const feeSource = snap.fee_rate_source;
  return {
    id: row.id,
    formulaVersion: row.formula_version,
    source: "CALCULATED",
    appliedFeeRate: typeof snap.applied_fee_rate === "number" ? snap.applied_fee_rate : null,
    feeRateSource: feeSource === "SCENARIO" || feeSource === "CATEGORY" ? (feeSource as FeeRateSource) : null,
    unitCostKrw: row.unit_cost_krw,
    coupangFeeAmount: row.coupang_fee_amount,
    adCostAmount: row.ad_cost_amount,
    totalCostPerUnit: row.total_cost_per_unit,
    netProfitPerUnit: row.net_profit_per_unit,
    netMarginRate: row.net_margin_rate,
    roi: row.roi,
    breakEvenPrice: row.break_even_price,
    breakEvenUnits: row.break_even_units,
    monthlyNetProfit: row.monthly_net_profit,
    omitted: Array.isArray(snap.omitted) ? snap.omitted.filter((v): v is string => typeof v === "string") : [],
    calculatedAt: row.calculated_at,
  };
}

export function toProfitScenario(row: ScenarioRow, current: CalculationRow | null): ProfitScenario {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    isPrimary: row.is_primary,
    salePrice: row.sale_price,
    unitCostAmount: row.unit_cost_amount,
    unitCostCurrency: asCurrency(row.unit_cost_currency),
    exchangeRate: row.exchange_rate,
    intlShippingPerUnit: row.intl_shipping_per_unit,
    domesticShippingPerUnit: row.domestic_shipping_per_unit,
    coupangFeeRate: row.coupang_fee_rate,
    logisticsFeePerUnit: row.logistics_fee_per_unit,
    adCostRate: row.ad_cost_rate,
    adCostPerUnit: row.ad_cost_per_unit,
    otherCostPerUnit: row.other_cost_per_unit,
    fixedCostTotal: row.fixed_cost_total,
    expectedMonthlyUnits: row.expected_monthly_units,
    memo: row.memo,
    source: isSourceType(row.source_type) ? row.source_type : "MANUAL",
    confidence: isConfidence(row.confidence) ? row.confidence : "B",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    current: current ? toProfitCalculationView(current) : null,
  };
}
