/**
 * 쿠팡 상품 페이지 어댑터: 화면에서 읽은 문자열 → CollectedProduct (순수 함수).
 *
 * 이 파일은 DOM 을 다루지 않는다. 어떤 요소(selector)에서 문자열을 읽을지는 확장 프로그램(PHASE 11)에서
 * 실제 페이지로 확인한 뒤 정한다. 여기서는 "읽은 문자열을 값으로 바꾸는 규칙"만 둔다.
 * 확인하지 못한 문자열은 비워 두면 된다 (null = 모름).
 */

import type { CollectedProduct, CollectorConfidence, CollectorSource } from "../types";

/** 확장 프로그램이 상품 페이지에서 읽어 올 문자열 (모두 선택) */
export interface RawCoupangProductPage {
  url: string;
  title?: string | null;
  priceText?: string | null;
  originalPriceText?: string | null;
  discountText?: string | null;
  ratingText?: string | null;
  reviewCountText?: string | null;
  /** 배송 관련 배지 문구들 (예: ["로켓배송", "내일 도착 보장"]) */
  badgeTexts?: string[] | null;
  sellerText?: string | null;
}

export interface CollectMeta {
  source: CollectorSource;
  confidence: CollectorConfidence;
  capturedAt: string;
  tool?: string;
}

/** 문자열 안의 첫 번째 숫자 (콤마 허용). "29,900원" → 29900, "(1,234)" → 1234, "4.5점" → 4.5. 없으면 null */
export function firstNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\s/g, "").match(/-?\d[\d,]*(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 할인 문구 "15%" → 0.15. % 가 없으면 모름 (숫자가 무엇인지 확정할 수 없음) */
export function percentFromText(text: string | null | undefined): number | null {
  if (!text || !text.includes("%")) return null;
  const n = firstNumber(text);
  return n == null ? null : Math.round((n / 100) * 10000) / 10000;
}

/** 배지 문구 → 배송 유형 문구 (core.ts 의 배송 유형 변환이 받는 이름). 모르는 배지는 무시 */
export function deliveryFromBadges(badges: string[] | null | undefined): string | null {
  const text = (badges ?? []).join(" ").replace(/\s/g, "");
  if (!text) return null;
  if (text.includes("로켓그로스")) return "ROCKET_GROWTH";
  if (text.includes("로켓프레시")) return "ROCKET_FRESH";
  if (text.includes("로켓직구")) return "OVERSEAS";
  if (text.includes("로켓배송")) return "ROCKET";
  if (text.includes("판매자배송")) return "SELLER_DELIVERY";
  return null;
}

export function productIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(/\/products\/(\d+)/)?.[1] ?? null;
}

export function adaptProductPage(raw: RawCoupangProductPage, meta: CollectMeta): CollectedProduct {
  return {
    ...meta,
    coupangProductId: productIdFromUrl(raw.url),
    productUrl: raw.url,
    productName: raw.title?.trim() || null,
    price: firstNumber(raw.priceText),
    originalPrice: firstNumber(raw.originalPriceText),
    discountRate: percentFromText(raw.discountText),
    rating: firstNumber(raw.ratingText),
    reviewCount: firstNumber(raw.reviewCountText),
    deliveryType: deliveryFromBadges(raw.badgeTexts),
    // 판매자 문구가 무엇을 뜻하는지는 core.ts 변환표가 정한다 (모르면 비워 두고 주의)
    sellerType: raw.sellerText?.trim() || null,
  };
}
