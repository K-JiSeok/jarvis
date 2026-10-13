/**
 * 반복 비용 설정 항목 (PHASE 20). 값은 cost_settings.items · product_cost_inputs.overrides 에 { value, basis, vatIncluded, source, date } 로 저장.
 * 항목이 없으면 미설정(UNKNOWN) — 0 으로 계산하지 않는다. 정말 0 원이면 0 을 입력한다 (예: 구매대행 없이 직접 구매).
 * 기본값은 넣지 않는다 (포워더 단가 · 구매대행 수수료 등 기본 추정값은 [제안 — 승인 필요]).
 */

export type SettingBasis = "QUOTE" | "USER" | "DEFAULT_ESTIMATE";
export const SETTING_BASIS_LABELS: Record<SettingBasis, string> = { QUOTE: "실제 견적", USER: "사용자 기준값", DEFAULT_ESTIMATE: "추정 기본값" };

export interface SettingItem {
  value: number;
  basis: SettingBasis;
  /** 금액이 부가세 포함인지 (국내 용역 · 세금계산서 수취 시 일반과세자는 공제) */
  vatIncluded?: boolean;
  source?: string | null;
  date?: string | null;
}

export type SettingUnit = "PER_KG" | "DIVISOR" | "RATE_OF_GOODS" | "RATE_OF_PRICE" | "PER_SHIPMENT" | "PER_UNIT";

export const SETTING_DEFS = {
  forwarderPerKg: { label: "포워더 국제 운송비 (kg당)", unit: "PER_KG", group: "IMPORT", vatDefault: false, hint: "청구 중량 = max(실중량, 부피중량)" },
  volumetricDivisor: { label: "부피중량 기준 (cm³ ÷ N = kg)", unit: "DIVISOR", group: "IMPORT", vatDefault: false, hint: "항공 6000 · 해운 등 포워더 기준" },
  intlFreightPerUnit: { label: "국제 운송비 (개당 직접 입력)", unit: "PER_UNIT", group: "IMPORT", vatDefault: false, hint: "입력하면 kg 단가 계산보다 우선" },
  chinaDomesticPerShipment: { label: "중국 내 배송비 (주문 1건당)", unit: "PER_SHIPMENT", group: "IMPORT", vatDefault: false, hint: "공급처 → 중국 창고. 원화로 입력" },
  agentFeeRate: { label: "구매대행 수수료율 (상품 매입가 대비)", unit: "RATE_OF_GOODS", group: "IMPORT", vatDefault: false, hint: "직접 구매면 0" },
  paymentFeeRate: { label: "결제 · 송금 수수료율 (상품 매입가 대비)", unit: "RATE_OF_GOODS", group: "IMPORT", vatDefault: false, hint: "카드 해외결제 · 송금 수수료" },
  customsBrokerPerShipment: { label: "통관 · 관세사 수수료 (주문 1건당)", unit: "PER_SHIPMENT", group: "IMPORT", vatDefault: true, hint: "" },
  domesticFreightPerShipment: { label: "국내 운송비 (포워더 → 쿠팡 센터, 1건당)", unit: "PER_SHIPMENT", group: "DOMESTIC", vatDefault: true, hint: "" },
  inboundPrepPerShipment: { label: "쿠팡 입고 준비 비용 (1건당 · 박스 · 팔레트)", unit: "PER_SHIPMENT", group: "DOMESTIC", vatDefault: true, hint: "" },
  inspectionPerUnit: { label: "검품 비용 (개당)", unit: "PER_UNIT", group: "DOMESTIC", vatDefault: true, hint: "" },
  packagingPerUnit: { label: "포장재 비용 (개당)", unit: "PER_UNIT", group: "DOMESTIC", vatDefault: true, hint: "" },
  labelingPerUnit: { label: "바코드 · 라벨링 비용 (개당)", unit: "PER_UNIT", group: "DOMESTIC", vatDefault: true, hint: "쿠팡 바코드 부착 서비스는 극소형 125원(VAT 별도)" },
  adRate: { label: "광고비 (판매가 대비 비율)", unit: "RATE_OF_PRICE", group: "SALES", vatDefault: false, hint: "광고비율 또는 개당 금액 중 하나. 쿠팡 광고비는 VAT 별도" },
  adPerUnit: { label: "광고비 (판매 1개당 금액)", unit: "PER_UNIT", group: "SALES", vatDefault: false, hint: "" },
  otherPerUnit: { label: "기타 부대비용 (개당)", unit: "PER_UNIT", group: "SALES", vatDefault: true, hint: "" },
} as const satisfies Record<string, { label: string; unit: SettingUnit; group: "IMPORT" | "DOMESTIC" | "SALES"; vatDefault: boolean; hint: string }>;

export type SettingKey = keyof typeof SETTING_DEFS;
export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];
export type SettingItems = Partial<Record<SettingKey, SettingItem>>;

export type TaxType = "GENERAL" | "SIMPLIFIED" | "UNKNOWN";
export const TAX_TYPE_LABELS: Record<TaxType, string> = { GENERAL: "일반과세자", SIMPLIFIED: "간이과세자", UNKNOWN: "미확인" };

/** 상품 덮어쓰기 > 기본 설정. 출처(어디서 왔는지)를 함께 */
export function resolveSetting(key: SettingKey, settings: SettingItems, overrides: SettingItems): { item: SettingItem; from: "PRODUCT" | "SETTINGS" } | null {
  const o = overrides[key];
  if (o && Number.isFinite(o.value)) return { item: o, from: "PRODUCT" };
  const s = settings[key];
  if (s && Number.isFinite(s.value)) return { item: s, from: "SETTINGS" };
  return null;
}

/** 저장된 jsonb → 검증된 항목만 */
export function sanitizeItems(raw: unknown): SettingItems {
  const out: SettingItems = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of SETTING_KEYS) {
    const v = (raw as Record<string, unknown>)[k] as Partial<SettingItem> | undefined;
    if (!v || typeof v.value !== "number" || !Number.isFinite(v.value) || v.value < 0) continue;
    const basis: SettingBasis = v.basis === "QUOTE" || v.basis === "DEFAULT_ESTIMATE" ? v.basis : "USER";
    out[k] = { value: v.value, basis, vatIncluded: typeof v.vatIncluded === "boolean" ? v.vatIncluded : SETTING_DEFS[k].vatDefault, source: v.source ?? null, date: v.date ?? null };
  }
  return out;
}
