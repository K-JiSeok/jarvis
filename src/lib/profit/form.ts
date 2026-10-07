import { readNumbers, type NumberRule } from "@/lib/forms";
import { COST_CURRENCIES, type CostCurrency, type ProfitScenarioInput } from "@/types/profit";

/**
 * 수익성 입력 폼 → ProfitScenarioInput. 브라우저(미리 보기)와 서버(저장)가 같은 함수를 쓴다.
 * 빈 칸 = 미입력(null), 0 = 실제 0.
 */

const won = (label: string): NumberRule => ({ label, min: 0, max: 1_000_000_000, integer: true });

const RULES = {
  sale_price: won("판매가"),
  unit_cost_amount: { label: "원가", min: 0, max: 1_000_000_000 },
  exchange_rate: { label: "환율", min: 0.0001, max: 100_000 },
  intl_shipping_per_unit: won("해외 배송비"),
  domestic_shipping_per_unit: won("국내 배송비"),
  coupang_fee_rate: { label: "쿠팡 수수료율", min: 0, max: 100, percent: true },
  logistics_fee_per_unit: won("로켓그로스 물류비"),
  other_cost_per_unit: won("기타 비용"),
  fixed_cost_total: won("초기 고정비"),
  expected_monthly_units: { label: "월 예상 판매량", min: 0, max: 10_000_000, integer: true },
} satisfies Record<string, NumberRule>;

export const AD_MODES = ["rate", "amount"] as const;
export type AdMode = (typeof AD_MODES)[number];

export function parseScenarioForm(formData: FormData): { input: ProfitScenarioInput; errors: string[] } {
  const { values: v, errors } = readNumbers(formData, RULES);

  const adMode: AdMode = formData.get("ad_mode") === "amount" ? "amount" : "rate";
  const ad = readNumbers(
    formData,
    adMode === "rate"
      ? { ad_value: { label: "광고비율", min: 0, max: 100, percent: true } }
      : { ad_value: won("광고비") },
  );
  errors.push(...ad.errors);
  const adValue = ad.values.ad_value ?? null;

  const currencyRaw = String(formData.get("unit_cost_currency") ?? "KRW");
  const currency: CostCurrency = (COST_CURRENCIES as readonly string[]).includes(currencyRaw) ? (currencyRaw as CostCurrency) : "KRW";
  if (currency !== "KRW" && v.exchange_rate == null) errors.push("환율: 원화가 아닌 원가는 환율을 입력하세요.");

  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ") || "기본";
  if (name.length > 50) errors.push("시나리오 이름은 50자 이하로 입력하세요.");
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (memo && memo.length > 1000) errors.push("메모는 1000자 이하로 입력하세요.");

  return {
    errors,
    input: {
      name,
      salePrice: v.sale_price ?? null,
      unitCostAmount: v.unit_cost_amount ?? null,
      unitCostCurrency: currency,
      exchangeRate: currency === "KRW" ? 1 : (v.exchange_rate ?? 1),
      intlShippingPerUnit: v.intl_shipping_per_unit ?? null,
      domesticShippingPerUnit: v.domestic_shipping_per_unit ?? null,
      coupangFeeRate: v.coupang_fee_rate ?? null,
      logisticsFeePerUnit: v.logistics_fee_per_unit ?? null,
      adCostRate: adMode === "rate" ? adValue : null,
      adCostPerUnit: adMode === "amount" ? adValue : null,
      otherCostPerUnit: v.other_cost_per_unit ?? null,
      fixedCostTotal: v.fixed_cost_total ?? null,
      expectedMonthlyUnits: v.expected_monthly_units ?? null,
      memo,
    },
  };
}
