"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { SALES_SCOPES } from "@/lib/costs/category";
import { parseWingTable, SIZE_ORDER, type RateKind } from "@/lib/costs/rate-cards";
import { SETTING_DEFS, SETTING_KEYS, type SettingBasis, type SettingItems, type TaxType } from "@/lib/costs/settings";
import { dbErrorMessage, fail, readNumber, readText, FormError, type FormState } from "@/lib/forms";
import { addRateCard, deleteRateCard, loadDetail, recordDetail, saveCostInput, saveCostSettings } from "@/lib/repositories/costs";
import type { Json } from "@/types/database";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASES: SettingBasis[] = ["QUOTE", "USER", "DEFAULT_ESTIMATE"];

/** 설정 항목 칸 읽기: `${prefix}${key}_value` · `_basis` · `_vat` · `_source`. 빈 칸 = 미설정 */
function readItems(formData: FormData, prefix: string): { items: SettingItems; errors: string[] } {
  const items: SettingItems = {};
  const errors: string[] = [];
  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFS[key];
    const percent = def.unit === "RATE_OF_GOODS" || def.unit === "RATE_OF_PRICE";
    const v = readNumber(formData, `${prefix}${key}_value`, { label: def.label, min: def.unit === "DIVISOR" ? 1 : 0, max: percent ? 100 : 100_000_000, percent });
    if (typeof v === "string") {
      errors.push(v);
      continue;
    }
    if (v == null) continue;
    const b = String(formData.get(`${prefix}${key}_basis`) ?? "USER") as SettingBasis;
    let source: string | null = null;
    try {
      source = readText(formData, `${prefix}${key}_source`, 200);
    } catch {
      errors.push(`${def.label}: 근거는 200자 이하`);
    }
    items[key] = { value: v, basis: BASES.includes(b) ? b : "USER", vatIncluded: formData.get(`${prefix}${key}_vat`) === "on", source, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()) };
  }
  if (items.adRate && items.adPerUnit) errors.push("광고비는 비율 또는 개당 금액 중 하나만 입력하세요.");
  return { items, errors };
}

function revalidateCosts(productId?: string) {
  revalidatePath("/profit/rates");
  revalidatePath("/profit/cost");
  revalidatePath("/discover");
  if (productId) revalidatePath(`/products/${productId}`);
}

export async function saveCostSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const { items, errors } = readItems(formData, "");
  if (errors.length) return fail(errors.join(" "));
  const tax = String(formData.get("tax_type") ?? "UNKNOWN") as TaxType;
  try {
    await saveCostSettings(items, ["GENERAL", "SIMPLIFIED", "UNKNOWN"].includes(tax) ? tax : "UNKNOWN");
    revalidateCosts();
    return { ok: true, message: `저장했습니다 (설정 ${Object.keys(items).length}개 · 비운 항목은 미설정). 기존 계산 이력은 바뀌지 않고, 다음 계산부터 적용됩니다.` };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

/** 요율 추가 (사용자 입력 행). 판매 수수료 = 요율 % / 로켓그로스 표 = WING 표 붙여 넣기 */
export async function addRateCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    const kind = String(formData.get("kind") ?? "") as RateKind;
    const scope = readText(formData, "scope", 100);
    const validFrom = String(formData.get("valid_from") ?? "");
    const promoUntil = String(formData.get("promo_until") ?? "");
    const checkedOn = String(formData.get("checked_on") ?? "");
    const label = readText(formData, "source_label", 200);
    const url = readText(formData, "source_url", 500);
    if (!scope) return fail("적용 범위(대분류 또는 비용 분류)를 입력하세요.");
    if (!DATE.test(validFrom) || !DATE.test(checkedOn)) return fail("적용 시작일 · 확인일을 입력하세요.");
    if (promoUntil && !DATE.test(promoUntil)) return fail("프로모션 종료일 형식이 잘못됐습니다.");
    if (!label) return fail("출처(어디서 확인했는지)를 입력하세요.");
    if (url && !/^https:\/\//.test(url)) return fail("출처 주소는 https:// 로 시작해야 합니다.");
    let rates: Record<string, unknown>;
    if (kind === "SALES_FEE") {
      if (!(SALES_SCOPES as readonly string[]).includes(scope)) return fail(`판매 수수료 대분류는 ${SALES_SCOPES.join(", ")} 중 하나입니다.`);
      const rate = readNumber(formData, "rate", { label: "수수료율", min: 0, max: 100, percent: true });
      if (typeof rate === "string") return fail(rate);
      if (rate == null) return fail("수수료율을 입력하세요.");
      rates = { rate, exceptions: [] };
    } else if (kind === "RG_INOUT" || kind === "RG_DELIVERY" || kind === "RG_RETURN_PICKUP") {
      const t = parseWingTable(String(formData.get("table") ?? ""));
      if (t.problems.length) return fail(`표를 읽지 못했습니다: ${t.problems.slice(0, 3).join(" / ")}`);
      rates = { bands: t.bands, sizes: SIZE_ORDER, base: t.base, promo: t.promo };
    } else {
      return fail("추가할 수 있는 요율 종류: 판매 수수료 · 입출고비 · 배송비 · 반품 회수비");
    }
    await addRateCard({ kind, scope, rates: rates as Json, vat_basis: "EXCLUDED", valid_from: validFrom, promo_until: promoUntil || null, source_url: url, source_label: label, checked_on: checkedOn, note: readText(formData, "note", 300) });
    revalidateCosts();
    return { ok: true, message: "요율을 추가했습니다 (사용자 입력 — 같은 종류 · 범위의 시스템 요율보다 우선). 과거 계산 이력은 그대로입니다." };
  } catch (error) {
    if (error instanceof FormError) return fail(error.message);
    return fail(dbErrorMessage(error));
  }
}

export async function deleteRateCardAction(id: string): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    const ok = await deleteRateCard(id);
    revalidateCosts();
    return ok ? { ok: true, message: "삭제했습니다." } : fail("시스템 요율은 삭제할 수 없습니다.");
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

const N = (label: string, extra: object = {}) => ({ label, min: 0, ...extra });

export async function saveCostInputAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    const nums = {
      length_cm: readNumber(formData, "length_cm", N("가로", { max: 500 })),
      width_cm: readNumber(formData, "width_cm", N("세로", { max: 500 })),
      height_cm: readNumber(formData, "height_cm", N("높이", { max: 500 })),
      weight_kg: readNumber(formData, "weight_kg", N("무게", { max: 1000 })),
      sale_price: readNumber(formData, "sale_price", N("판매가", { integer: true, min: 1, max: 100_000_000 })),
      seller_discount: readNumber(formData, "seller_discount", N("판매자 할인", { integer: true, max: 100_000_000 })),
      storage_days: readNumber(formData, "storage_days", N("예상 보관일", { integer: true, min: 1, max: 730 })),
      return_rate: readNumber(formData, "return_rate", N("예상 반품률", { max: 100, percent: true })),
      tariff_rate: readNumber(formData, "tariff_rate", N("관세율", { max: 100, percent: true })),
      order_qty: readNumber(formData, "order_qty", N("주문 수량", { integer: true, min: 1, max: 10_000_000 })),
      units_per_listing: readNumber(formData, "units_per_listing", N("판매 1개 = 공급 단위", { min: 0.0001, max: 100000 })),
      unit_cost_krw: readNumber(formData, "unit_cost_krw", N("공급 원가", { integer: true, max: 100_000_000 })),
    };
    const errs = Object.values(nums).filter((v): v is string => typeof v === "string");
    if (errs.length) return fail(errs.join(" "));
    const v = nums as Record<keyof typeof nums, number | null>;
    const dims = [v.length_cm, v.width_cm, v.height_cm, v.weight_kg];
    if (dims.some((x) => x != null) && dims.some((x) => x == null)) return fail("포장 크기는 가로 · 세로 · 높이 · 무게를 모두 입력하거나 모두 비우세요.");
    if (dims.some((x) => x === 0)) return fail("포장 크기 · 무게는 0보다 커야 합니다.");
    if (v.sale_price != null && v.seller_discount != null && v.seller_discount >= v.sale_price) return fail("판매자 할인은 판매가보다 작아야 합니다.");
    const hs = readText(formData, "hs_code", 10);
    if (hs && !/^\d{4,10}$/.test(hs)) return fail("HS 코드는 숫자 4~10자리입니다.");
    const scope = readText(formData, "sales_scope", 50);
    if (scope && !(SALES_SCOPES as readonly string[]).includes(scope)) return fail("판매 수수료 대분류를 목록에서 고르세요.");
    const { items: overrides, errors } = readItems(formData, "ov_");
    if (errors.length) return fail(errors.join(" "));
    const unitBasis = String(formData.get("unit_cost_basis") ?? "");
    await saveCostInput(productId, {
      ...v,
      sales_scope: scope,
      sales_path: readText(formData, "sales_path", 200),
      fee_group: readText(formData, "fee_group", 100),
      category_confirmed: formData.get("category_confirmed") === "on",
      hs_code: hs,
      tariff_basis: readText(formData, "tariff_basis", 200),
      tariff_confirmed: formData.get("tariff_confirmed") === "on",
      unit_cost_basis: v.unit_cost_krw != null ? (unitBasis === "QUOTE" ? "QUOTE" : "USER") : null,
      overrides: overrides as unknown as Json,
      memo: readText(formData, "memo", 500),
    });
    const view = await loadDetail(productId);
    const rec = view ? await recordDetail(view) : "NOT_ANALYZABLE";
    revalidateCosts(productId);
    const recMsg = rec === "CREATED" ? "새 계산 이력 1건을 남겼습니다" : rec === "UNCHANGED" ? "입력이 같아 이력은 그대로입니다" : "공급 원가 또는 판매가가 없어 이력은 남기지 않았습니다";
    return { ok: true, message: `저장했습니다. ${recMsg}.` };
  } catch (error) {
    if (error instanceof FormError) return fail(error.message);
    return fail(dbErrorMessage(error));
  }
}

export async function recordDetailAction(productId: string): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    const view = await loadDetail(productId);
    if (!view) return fail("상품을 찾을 수 없습니다.");
    const rec = await recordDetail(view);
    revalidateCosts(productId);
    return rec === "CREATED" ? { ok: true, message: "계산 이력 1건을 남겼습니다." } : rec === "UNCHANGED" ? { ok: true, message: "같은 입력의 이력이 이미 있습니다 (그대로)." } : fail("공급 원가 또는 판매가가 없어 분석할 수 없습니다.");
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}
