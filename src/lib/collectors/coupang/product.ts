/**
 * 쿠팡 상품 페이지 어댑터: 화면에서 읽은 문자열 → CollectedProduct (순수 함수).
 *
 * 이 파일은 DOM 을 다루지 않는다. 어떤 요소에서 문자열을 읽는지는 확장 프로그램(extension/src/content/coupang-product.ts)이
 * 정한다 (PHASE 11 에서 실제 페이지로 확인). 여기서는 "읽은 문자열을 값으로 바꾸는 규칙"만 둔다.
 * 확인하지 못한 문자열은 비워 두면 된다 (null = 모름).
 *
 * PHASE 11 실제 페이지 확인 결과 (2026-10-08, 상품 5개)
 * - 상품 ID: URL /vp/products/{id} · JSON-LD sku "{id}-{vendorItemId}" · 본문 "쿠팡상품번호: {id} - {vendorItemId}" 세 곳이 같다
 * - 판매가: 가격 영역(.price-layout-container). 와우할인가 · 일반판매가가 함께 보이면 일반판매가를 쓴다 (검색 결과 목록에 보이는 가격과 같다)
 * - 정가: 가격 영역의 취소선 금액 · 할인율: 같은 영역의 "NN%"
 * - 평점: JSON-LD aggregateRating.ratingValue (별 그림은 0.5 단위라 덜 정확) · 리뷰 수: JSON-LD ratingCount / "N 개 상품평" / 탭 "상품평 (N)"
 * - 배송 배지는 글자가 아니라 이미지다 → 파일 이름으로 구분 (아래 BADGE_IMAGES, 화면으로 확인한 것만)
 */

import type { CollectedProduct, CollectorConfidence, CollectorSource } from "../types";

/** 확장 프로그램이 상품 페이지에서 읽어 올 문자열 (모두 선택) */
export interface RawCoupangProductPage {
  url: string;
  title?: string | null;
  /** 페이지 안의 다른 상품 ID 표기 (JSON-LD sku 앞부분, "쿠팡상품번호") — URL 과 교차 검증 */
  pageProductIds?: (string | null | undefined)[] | null;
  priceText?: string | null;
  originalPriceText?: string | null;
  discountText?: string | null;
  ratingText?: string | null;
  reviewCountText?: string | null;
  /** 배송 관련 배지 문구들 (예: ["로켓배송", "내일 도착 보장"]) */
  badgeTexts?: string[] | null;
  /** 배송 배지 이미지 파일 이름들 (예: ["logo_rocket_merchant_medium_v3_r3.png"]) */
  badgeImageNames?: string[] | null;
  sellerText?: string | null;
  /** 판매자 정보 영역(판매자명 · 배송사)이 보였는지 */
  sellerInfoText?: string | null;
  /** 화면에서 확인했지만 JARVIS 모델에 저장하지 않는 값 (import_rows.payload 에만 남는다) */
  observedOnly?: Record<string, string | number | null> | null;
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

/**
 * 배송 배지 이미지 파일 이름 → 화면에 보이는 배지 문구.
 * 2026-10-08 실제 화면에서 이미지와 문구를 대조한 것만 넣는다. 모르는 이미지는 무시한다 (추측하지 않음).
 */
export const BADGE_IMAGES: { pattern: RegExp; label: string }[] = [
  { pattern: /^logo_rocket_merchant/i, label: "판매자로켓" },
  { pattern: /^logo_rocket_filter/i, label: "로켓배송" },
];

export function badgeFromImageName(name: string | null | undefined): string | null {
  if (!name) return null;
  const file = name.split(/[/?#]/).filter(Boolean).find((part) => /\.(png|svg|jpe?g|webp|gif)$/i.test(part)) ?? name;
  return BADGE_IMAGES.find((b) => b.pattern.test(file))?.label ?? null;
}

/** 배지 문구 → 배송 유형 코드. 모르는 배지는 무시. "판매자로켓" 은 쿠팡 화면에서 로켓그로스 상품에 붙는 배지 */
export function deliveryFromBadges(badges: string[] | null | undefined): string | null {
  const text = (badges ?? []).join(" ").replace(/\s/g, "");
  if (!text) return null;
  if (text.includes("로켓그로스") || text.includes("판매자로켓")) return "ROCKET_GROWTH";
  if (text.includes("로켓프레시")) return "ROCKET_FRESH";
  if (text.includes("로켓직구")) return "OVERSEAS";
  if (text.includes("로켓배송")) return "ROCKET";
  if (text.includes("판매자배송")) return "SELLER_DELIVERY";
  return null;
}

export function productIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(/\/products\/(\d+)/)?.[1] ?? null;
}

/**
 * 배송 · 판매자 유형 (화면 근거가 있을 때만).
 *   판매자로켓 배지                      → 로켓그로스 / 로켓그로스 판매자
 *   로켓배송 배지 + 판매자 정보 영역 없음 → 로켓배송 / 쿠팡 직매입
 *   로켓 배지 없음 + 판매자 정보에 배송사 → 판매자배송 / WING 판매자
 * 그 밖의 조합은 모름 (null).
 */
export function deliveryAndSeller(badges: string[], sellerInfoText: string | null | undefined): { delivery: string | null; seller: string | null } {
  const delivery = deliveryFromBadges(badges);
  const sellerInfo = sellerInfoText?.replace(/\s+/g, " ").trim() ?? "";
  if (delivery === "ROCKET_GROWTH") return { delivery, seller: "ROCKET_GROWTH_SELLER" };
  if (delivery === "ROCKET") return { delivery, seller: sellerInfo ? null : "COUPANG_RETAIL" };
  if (delivery) return { delivery, seller: null };
  if (sellerInfo.includes("판매자") && sellerInfo.includes("배송사")) return { delivery: "SELLER_DELIVERY", seller: "WING_SELLER" };
  return { delivery: null, seller: null };
}

/** "판매자: (주)케이씨제이무역 판매자 상품 보러가기 …" → "(주)케이씨제이무역" */
export function sellerNameFromInfo(text: string | null | undefined): string | null {
  const m = text?.replace(/\s+/g, " ").match(/판매자\s*:\s*(.+?)(?:\s*(?:판매자 상품 보러가기|다른 판매자 보기|판매자 평가|배송사)|$)/);
  return m?.[1]?.trim() || null;
}

export interface PriceLeaf {
  text: string;
  /** 취소선(정가) */
  strike?: boolean;
}

const MONEY = /^[\d,]+\s*원?$/;

/**
 * 가격 영역의 글자 조각(화면 순서) → 판매가 · 정가 · 할인율 문구.
 * 두 가격이 함께 보이면 일반 가격 부분만 본다. 실제 화면의 이름표:
 *   "와우할인가" / "일반판매가", "와우 가입 쿠폰할인가" / "일반할인가" (PHASE 11 실사용 중 두 번째 형태 발견)
 * 괄호 안 단가 "(1개당 …)" 와 "쿠폰할인 · 할인" 앞 금액(할인액)은 판매가로 보지 않는다.
 */
const NORMAL_LABEL = /^일반(판매가|할인가)$/;
const WOW_LABEL = /^와우.*가$/;

export function pickPrice(leaves: PriceLeaf[]): { priceText: string | null; originalPriceText: string | null; discountText: string | null; wowPriceText: string | null } {
  const items = leaves.map((l) => ({ text: l.text.trim(), strike: !!l.strike })).filter((l) => l.text);
  const normalAt = items.findIndex((l) => NORMAL_LABEL.test(l.text.replace(/\s/g, "")));
  const wowAt = items.findIndex((l) => WOW_LABEL.test(l.text.replace(/\s/g, "")));
  const scope = normalAt >= 0 ? items.slice(normalAt + 1) : items;
  const isDiscountAmount = (i: number) => /^(쿠폰할인|할인|즉시할인)$/.test(scope[i + 1]?.text.replace(/\s/g, "") ?? "");
  const sale = scope.findIndex((l, i) => !l.strike && MONEY.test(l.text) && !isDiscountAmount(i));
  const original = scope.find((l) => l.strike && MONEY.test(l.text));
  const discount = scope.find((l) => /^\d{1,2}\s*%$/.test(l.text));
  let wowPriceText: string | null = null;
  if (wowAt >= 0 && normalAt > wowAt) {
    wowPriceText = items.slice(wowAt + 1, normalAt).find((l) => !l.strike && MONEY.test(l.text))?.text ?? null;
  }
  return { priceText: sale >= 0 ? scope[sale].text : null, originalPriceText: original?.text ?? null, discountText: discount?.text ?? null, wowPriceText };
}

/** 별 그림 너비 "width:90%" → 4.5 (JSON-LD 평점이 없을 때만 쓴다) */
export function ratingFromStarWidth(style: string | null | undefined): string | null {
  const m = style?.match(/width\s*:\s*([\d.]+)%/);
  if (!m) return null;
  const v = Math.round((Number(m[1]) / 20) * 10) / 10;
  return Number.isFinite(v) && v >= 0 && v <= 5 ? String(v) : null;
}

export function adaptProductPage(raw: RawCoupangProductPage, meta: CollectMeta): CollectedProduct {
  const badges = [...(raw.badgeTexts ?? []), ...(raw.badgeImageNames ?? []).map(badgeFromImageName).filter((b): b is string => !!b)];
  const { delivery, seller } = deliveryAndSeller(badges, raw.sellerInfoText);
  const urlId = productIdFromUrl(raw.url);
  return {
    ...meta,
    coupangProductId: urlId,
    productUrl: raw.url,
    observedProductIds: (raw.pageProductIds ?? []).filter((x): x is string => !!x),
    productName: raw.title?.trim() || null,
    price: firstNumber(raw.priceText),
    originalPrice: firstNumber(raw.originalPriceText),
    discountRate: percentFromText(raw.discountText),
    rating: firstNumber(raw.ratingText),
    reviewCount: firstNumber(raw.reviewCountText),
    deliveryType: delivery,
    // 판매자 문구를 직접 받으면 그대로 (core.ts 변환표가 정한다), 아니면 배지·판매자 정보로 정한 유형
    sellerType: raw.sellerText?.trim() || seller,
    observedOnly: { ...(raw.observedOnly ?? {}), sellerName: sellerNameFromInfo(raw.sellerInfoText), badges: badges.join(",") || null },
  };
}
