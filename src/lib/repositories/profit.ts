import "server-only";

import { FormError } from "@/lib/forms";
import { toProfitScenario } from "@/lib/mappers/profit";
import { calculateProfit, type ProfitResult } from "@/lib/profit/calculate";
import { resolveFeeRate, toProfitInput } from "@/lib/profit/inputs";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables, TablesInsert } from "@/types/db";
import type { CategoryFeeRow, ProfitOverviewRow, ProfitProductContext, ProfitScenario, ProfitScenarioInput } from "@/types/profit";

/*
 * 수익성 repository. 로그인 사용자 세션(RLS)으로만 접근한다.
 * profit_scenarios = 입력, profit_calculations = 결과 (formula_version + inputs_snapshot).
 * 재계산하면 새 결과 행을 INSERT 하고 이전 행은 is_current = false 로 내린다 (결과 행은 수정하지 않는다).
 * 수수료율 기본값은 화면에서 넘어온 값을 믿지 않고 서버에서 상품의 카테고리를 다시 읽는다.
 */

type CalculationRow = Tables<"profit_calculations">;

async function currentCalculations(scenarioIds: string[]): Promise<Map<string, CalculationRow>> {
  if (scenarioIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profit_calculations")
    .select("*")
    .in("scenario_id", scenarioIds)
    .eq("is_current", true);
  if (error) throw error;
  return new Map(data.map((c) => [c.scenario_id, c]));
}

/** 수익성 계산용 상품 정보 (판매가 기본값 · 카테고리 수수료율). 본인 상품이 아니면 null */
export async function getProfitProductContext(productId: string): Promise<ProfitProductContext | null> {
  const supabase = await createClient();
  const [product, latest] = await Promise.all([
    supabase
      .from("products")
      .select("id, product_name, coupang_product_id, categories!products_category_fk(id, name, coupang_fee_rate)")
      .eq("id", productId)
      .maybeSingle(),
    supabase.from("v_product_latest").select("price, original_price, discount_rate").eq("product_id", productId).maybeSingle(),
  ]);
  if (product.error) throw product.error;
  if (latest.error) throw latest.error;
  if (!product.data) return null;
  const c = product.data.categories;
  return {
    id: product.data.id,
    productName: product.data.product_name,
    coupangProductId: product.data.coupang_product_id,
    currentPrice: latest.data?.price ?? null,
    originalPrice: latest.data?.original_price ?? null,
    discountRate: latest.data?.discount_rate ?? null,
    category: c ? { id: c.id, name: c.name, feeRate: c.coupang_fee_rate } : null,
  };
}

/** 상품의 시나리오 (대표 → 최근 수정 순) + 현재 계산 결과 */
export async function listScenariosForProduct(productId: string): Promise<ProfitScenario[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profit_scenarios")
    .select("*")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const calcs = await currentCalculations(data.map((s) => s.id));
  return data.map((s) => toProfitScenario(s, calcs.get(s.id) ?? null));
}

/** 전체 시나리오 목록 (/profit) */
export async function listProfitOverview(): Promise<ProfitOverviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profit_scenarios")
    .select("*, products!profit_scenarios_product_fk(id, product_name)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const calcs = await currentCalculations(data.map((s) => s.id));
  return data.map(({ products, ...s }) => ({
    scenario: toProfitScenario(s, calcs.get(s.id) ?? null),
    product: { id: products.id, productName: products.product_name },
  }));
}

function scenarioColumns(input: ProfitScenarioInput) {
  return {
    name: input.name,
    sale_price: input.salePrice,
    unit_cost_amount: input.unitCostAmount,
    unit_cost_currency: input.unitCostCurrency,
    exchange_rate: input.unitCostCurrency === "KRW" ? 1 : input.exchangeRate,
    intl_shipping_per_unit: input.intlShippingPerUnit,
    domestic_shipping_per_unit: input.domesticShippingPerUnit,
    coupang_fee_rate: input.coupangFeeRate,
    logistics_fee_per_unit: input.logisticsFeePerUnit,
    ad_cost_rate: input.adCostRate,
    ad_cost_per_unit: input.adCostPerUnit,
    other_cost_per_unit: input.otherCostPerUnit,
    fixed_cost_total: input.fixedCostTotal,
    expected_monthly_units: input.expectedMonthlyUnits,
    memo: input.memo,
  };
}

export interface SaveScenarioResult {
  scenarioId: string;
  result: ProfitResult;
  /** 필수값이 없어 결과 행을 만들지 않았다 */
  calculated: boolean;
}

/**
 * 시나리오 저장 + 재계산.
 * - scenarioId 가 있으면 수정, 없으면 추가 (상품의 첫 시나리오는 자동으로 대표)
 * - 필수값이 모두 있으면 새 결과 행을 현재로 둔다. 없으면 이전 결과만 현재에서 내린다 (입력과 맞지 않으므로)
 */
export async function saveProfitScenario(params: {
  productId: string;
  scenarioId: string | null;
  input: ProfitScenarioInput;
  makePrimary: boolean;
}): Promise<SaveScenarioResult> {
  const supabase = await createClient();
  const context = await getProfitProductContext(params.productId);
  if (!context) throw Object.assign(new Error("상품을 찾을 수 없습니다."), { code: "23503" });

  const { count, error: countError } = await supabase
    .from("profit_scenarios")
    .select("id", { count: "exact", head: true })
    .eq("product_id", params.productId)
    .eq("is_primary", true);
  if (countError) throw countError;

  let scenarioId = params.scenarioId;
  if (scenarioId) {
    const { data, error } = await supabase
      .from("profit_scenarios")
      .update(scenarioColumns(params.input))
      .eq("id", scenarioId)
      .eq("product_id", params.productId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("시나리오를 찾을 수 없습니다."), { code: "23503" });
  } else {
    const { data, error } = await supabase
      .from("profit_scenarios")
      .insert({ product_id: params.productId, ...scenarioColumns(params.input), source_type: "MANUAL", confidence: "B" })
      .select("id")
      .single();
    if (error) throw error;
    scenarioId = data.id;
  }

  if (params.makePrimary || count === 0) await setPrimaryScenario(params.productId, scenarioId);

  const categoryRate = context.category?.feeRate ?? null;
  const fee = resolveFeeRate(params.input.coupangFeeRate, categoryRate);
  const result = calculateProfit(toProfitInput(params.input, categoryRate));

  // 이전 현재 결과를 내린다 (부분 unique index 때문에 INSERT 전에 내려야 한다)
  const { data: previous, error: downError } = await supabase
    .from("profit_calculations")
    .update({ is_current: false })
    .eq("scenario_id", scenarioId)
    .eq("is_current", true)
    .select("id");
  if (downError) throw downError;

  if (!result.complete) return { scenarioId, result, calculated: false };

  const row: TablesInsert<"profit_calculations"> = {
    scenario_id: scenarioId,
    product_id: params.productId,
    formula_version: result.formulaVersion,
    inputs_snapshot: {
      ...scenarioColumns(params.input),
      category_id: context.category?.id ?? null,
      category_fee_rate: categoryRate,
      applied_fee_rate: fee.feeRate,
      fee_rate_source: fee.source,
      applied_exchange_rate: params.input.unitCostCurrency === "KRW" ? 1 : params.input.exchangeRate,
      vat_handling: "sale_price_as_is",
      result_source_type: "CALCULATED",
      omitted: result.omitted,
      warnings: result.warnings,
      investment_per_unit: result.investmentPerUnit,
      fixed_cost_per_unit: result.fixedCostPerUnit,
      variable_rate: result.variableRate,
    } satisfies Record<string, Json>,
    unit_cost_krw: result.unitCostKrw,
    coupang_fee_amount: result.feeAmount,
    ad_cost_amount: result.adCostAmount,
    total_cost_per_unit: result.totalCostPerUnit,
    net_profit_per_unit: result.netProfitPerUnit,
    net_margin_rate: result.netMarginRate,
    roi: result.roi,
    break_even_price: result.breakEvenPrice,
    break_even_units: result.breakEvenUnits,
    monthly_net_profit: result.monthlyNetProfit,
    is_current: true,
  };
  const { error: insertError } = await supabase.from("profit_calculations").insert(row);
  if (insertError) {
    // 결과 저장 실패: 내렸던 이전 결과를 되돌린다
    if (previous.length > 0) {
      await supabase.from("profit_calculations").update({ is_current: true }).eq("id", previous[0].id);
    }
    throw insertError;
  }
  return { scenarioId, result, calculated: true };
}

/** 상품의 대표 시나리오 지정 (상품당 1개) */
export async function setPrimaryScenario(productId: string, scenarioId: string): Promise<void> {
  const supabase = await createClient();
  const { error: clearError } = await supabase
    .from("profit_scenarios")
    .update({ is_primary: false })
    .eq("product_id", productId)
    .eq("is_primary", true)
    .neq("id", scenarioId);
  if (clearError) throw clearError;
  const { error } = await supabase.from("profit_scenarios").update({ is_primary: true }).eq("id", scenarioId).eq("product_id", productId);
  if (error) throw error;
}

/** 시나리오 삭제 (결과 행은 FK cascade 로 함께 삭제) */
export async function deleteProfitScenario(productId: string, scenarioId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("profit_scenarios").delete().eq("id", scenarioId).eq("product_id", productId);
  if (error) throw error;
}

// 카테고리 수수료율 -----------------------------------------------------------------

export async function listCategoryFees(): Promise<CategoryFeeRow[]> {
  const supabase = await createClient();
  const [categories, products] = await Promise.all([
    supabase.from("categories").select("id, name, path, coupang_fee_rate, updated_at").eq("is_active", true).order("name"),
    supabase.from("products").select("category_id").not("category_id", "is", null).neq("lifecycle_status", "DELETED"),
  ]);
  if (categories.error) throw categories.error;
  if (products.error) throw products.error;
  const counts = new Map<string, number>();
  for (const p of products.data) counts.set(p.category_id!, (counts.get(p.category_id!) ?? 0) + 1);
  return categories.data.map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    feeRate: c.coupang_fee_rate,
    productCount: counts.get(c.id) ?? 0,
    updatedAt: c.updated_at,
  }));
}

export async function updateCategoryFeeRate(categoryId: string, feeRate: number | null): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ coupang_fee_rate: feeRate })
    .eq("id", categoryId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("카테고리를 찾을 수 없습니다."), { code: "23503" });
}

/** 같은 이름이 이미 있으면 FormError */
export async function createCategoryWithFee(name: string, feeRate: number | null): Promise<string> {
  const supabase = await createClient();
  const { data: existing, error: findError } = await supabase.from("categories").select("id").eq("name", name).limit(1).maybeSingle();
  if (findError) throw findError;
  if (existing) throw new FormError(`"${name}" 카테고리가 이미 있습니다. 목록에서 수수료율을 수정하세요.`);
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, path: name, depth: 1, source_type: "MANUAL", coupang_fee_rate: feeRate })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}
