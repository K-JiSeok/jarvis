import { DELIVERY_TYPE_LABELS, SELLER_TYPE_LABELS, type DeliveryType, type SellerType } from "@/types/product";

export function deliveryLabel(value: string): string {
  return DELIVERY_TYPE_LABELS[value as DeliveryType] ?? value;
}

export function sellerLabel(value: string): string {
  return SELLER_TYPE_LABELS[value as SellerType] ?? value;
}

/** 판매량·매출 기간 표시: "120 (28일)" */
export function withPeriod(text: string, periodDays: number | null | undefined): string {
  return periodDays ? `${text} (${periodDays}일)` : text;
}
