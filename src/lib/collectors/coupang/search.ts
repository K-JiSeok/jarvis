/**
 * 쿠팡 검색 결과 어댑터: 화면에서 읽은 목록 → CollectedSearchResult (순수 함수).
 * DOM 을 다루지 않는다 (요소 선택은 extension/src/content/coupang-search.ts).
 *
 * PHASE 11 실제 검색 결과 확인 (2026-10-08, 키워드 5개)
 * - 검색 결과 = #product-list 의 상품 칸들. 광고 상품은 칸 안에 "광고" 글자가 있다.
 *   목록 중간의 묶음 칸("최근 다른 고객이 많이 구매한 상품", "한정 시간 특가 상품")과 목록 밖 "같이 보면 좋은 상품"은 검색 결과가 아니다 → 넣지 않는다.
 * - 쿠팡 화면의 순위 배지(빨간 숫자 1~10)는 광고를 뺀 자연 검색 상품에만 붙고, 자연 상품끼리 1, 2, 3 … 으로 센다.
 *
 * 순위 규칙 (기존 rank_position + is_ad 그대로)
 *   자연 노출: rank_position = 자연 상품끼리의 순서 (쿠팡 순위 배지와 같은 숫자)
 *   광고:      rank_position = 광고 상품끼리의 순서 (광고 1위, 광고 2위 …)
 *   화면 전체 위치(광고 포함)는 displayPosition 으로 import_rows.payload 에만 남긴다.
 * - 같은 상품이 옵션만 달리 여러 번 보이면 각 칸이 순서에 포함된다(화면 배지와 같음). 저장은 가장 앞 순위 하나 (나머지는 건너뜀).
 * - 1페이지만 순위로 저장한다. 2페이지 이상에서 순위가 이어지는지 확인하지 못했다 (PHASE 11 보고서).
 */

import type { CollectedKeyword, CollectedProduct, CollectedSearchItem, CollectedSearchResult } from "../types";

import { badgeFromImageName, deliveryFromBadges, firstNumber, percentFromText, productIdFromUrl, type CollectMeta } from "./product";

export interface RawCoupangSearchItem {
  href: string;
  adLabelText?: string | null;
  /** 칸 안에 보인 순위 배지 숫자 (자연 상품 1~10 위만 보인다) */
  rankBadgeText?: string | null;
  productName?: string | null;
  priceText?: string | null;
  originalPriceText?: string | null;
  discountText?: string | null;
  reviewCountText?: string | null;
  ratingText?: string | null;
  badgeImageNames?: string[] | null;
}

export interface RawCoupangSearchPage {
  /** 검색 결과 URL (예: https://www.coupang.com/np/search?q=…&page=2) */
  url: string;
  /** URL 에서 못 찾을 때 */
  keyword?: string | null;
  items: RawCoupangSearchItem[];
}

export function searchParamsOf(url: string): { keyword: string | null; page: number | null } {
  try {
    const u = new URL(url);
    const q = u.searchParams.get("q");
    const raw = u.searchParams.get("page");
    // 검색 결과 첫 화면은 page 파라미터가 없다 → 1페이지
    if (raw == null) return { keyword: q?.trim() || null, page: u.pathname.startsWith("/np/search") ? 1 : null };
    const page = Number(raw);
    return { keyword: q?.trim() || null, page: Number.isInteger(page) && page >= 1 ? page : null };
  } catch {
    return { keyword: null, page: null };
  }
}

/**
 * 쿠팡이 검색어를 고쳐서 다른 검색어의 결과를 보여 줬는지 (URL 의 correctedQuery, PHASE 11 실사용에서 확인).
 * 예: q=하오스전자 HS-6 → correctedQuery=하우스전자 hs-6. 이 결과를 원래 검색어 순위로 저장하면 틀린 데이터가 된다.
 */
export function correctedQueryOf(url: string): string | null {
  try {
    const u = new URL(url);
    const corrected = u.searchParams.get("correctedQuery")?.trim();
    const q = u.searchParams.get("q")?.trim();
    return corrected && corrected.toLowerCase() !== q?.toLowerCase() ? corrected : null;
  } catch {
    return null;
  }
}

export const isAdLabel = (text: string | null | undefined) => !!text && /^(광고|AD|sponsored)$/i.test(text.trim());

/**
 * 검색 칸의 배송 배지 (이미지 파일 이름, PHASE 11 확인).
 *   로켓배송 · 판매자로켓 배지 → 그 배송 유형
 *   로켓 계열 이미지가 하나도 없음 → NONE (로켓 아님. 실제 화면에서 "모레 도착", "10/21 도착" 같은 판매자 배송 상품)
 *   로켓 계열 이미지인데 모르는 파일 → UNKNOWN (로켓프레시 · 로켓직구 등 미확인 배지 — 비율 계산에서 뺀다)
 */
export type SearchBadge = "ROCKET" | "ROCKET_GROWTH" | "NONE" | "UNKNOWN";

export function searchBadgeOf(imageNames: string[] | null | undefined): SearchBadge {
  const rocketish = (imageNames ?? []).filter((n) => /logo_rocket|rocket/i.test(n));
  if (rocketish.length === 0) return "NONE";
  const delivery = deliveryFromBadges(rocketish.map(badgeFromImageName).filter((b): b is string => !!b));
  return delivery === "ROCKET" || delivery === "ROCKET_GROWTH" ? delivery : "UNKNOWN";
}

export function adaptSearchPage(raw: RawCoupangSearchPage, meta: CollectMeta): CollectedSearchResult {
  const { keyword, page } = searchParamsOf(raw.url);
  let organic = 0;
  let ads = 0;
  const items: CollectedSearchItem[] = raw.items.map((item, i) => {
    const isAd = isAdLabel(item.adLabelText);
    const rank = isAd ? ++ads : ++organic;
    const badge = searchBadgeOf(item.badgeImageNames);
    return {
      coupangProductId: productIdFromUrl(item.href),
      productUrl: item.href,
      rank,
      isAd,
      displayPosition: i + 1,
      rankBadge: item.rankBadgeText?.trim() ? Number(item.rankBadgeText.trim()) : null,
      productName: item.productName?.trim() || null,
      priceText: item.priceText ?? null,
      reviewCountText: item.reviewCountText ?? null,
      ratingText: item.ratingText ?? null,
      price: firstNumber(item.priceText),
      originalPrice: firstNumber(item.originalPriceText),
      discountRate: percentFromText(item.discountText),
      reviewCount: firstNumber(item.reviewCountText),
      rating: firstNumber(item.ratingText),
      badge,
      // 검색 칸에는 판매자 정보가 없다 → 판매자로켓(로켓그로스 판매자)만 배지로 확정, 나머지는 모름
      deliveryType: badge === "ROCKET" || badge === "ROCKET_GROWTH" ? badge : null,
      sellerType: badge === "ROCKET_GROWTH" ? "ROCKET_GROWTH_SELLER" : null,
    };
  });
  // 검색어는 URL 의 q 를 먼저 쓴다 (검색창 글자는 사용자가 고치는 중일 수 있다)
  return { ...meta, keyword: keyword || raw.keyword?.trim() || "", page, items };
}

/** 같은 상품이 여러 칸이면 첫 칸만 (자연 · 광고 각각의 가장 앞 순위도 함께) — 후보 목록 · 상품 데이터 저장용 */
export interface SearchProduct {
  coupangProductId: string;
  item: CollectedSearchItem;
  organicRank: number | null;
  adRank: number | null;
  appearances: number;
}

export function uniqueSearchProducts(result: CollectedSearchResult): SearchProduct[] {
  const map = new Map<string, SearchProduct>();
  for (const item of result.items) {
    const id = item.coupangProductId ?? productIdFromUrl(item.productUrl);
    if (!id) continue;
    const p = map.get(id) ?? { coupangProductId: id, item, organicRank: null, adRank: null, appearances: 0 };
    p.appearances += 1;
    const rank = Number(item.rank);
    if (item.isAd) p.adRank ??= rank;
    else p.organicRank ??= rank;
    // 상품 값은 자연 노출 칸을 우선 (광고 칸과 값이 같지만 자연 노출이 검색 결과 본래 값)
    if (!item.isAd && p.item.isAd) p.item = item;
    map.set(id, p);
  }
  return [...map.values()];
}

/**
 * 검색 1페이지 집계 → 키워드 스냅샷 (average_price · average_reviews · rocket_ratio · sample_size).
 * 기준 (collector 규칙 그대로): 검색 결과 상품 칸만 (묶음 칸 제외는 DOM 단계), 광고 칸 제외, 같은 상품 반복은 첫 칸만.
 *   average_price   = 가격을 읽은 상품의 판매가 평균 (원, 반올림)
 *   average_reviews = 리뷰 수를 읽은 상품의 평균 (소수 1자리)
 *   rocket_ratio    = 배지를 판정한 상품 중 로켓배송 · 판매자로켓 비율 (UNKNOWN 배지는 분모에서 뺀다)
 *   sample_size     = 집계에 쓴 상품 수 (광고 제외 · 중복 제외)
 * 값을 읽은 상품이 없으면 그 항목은 비운다 (NULL = 모름).
 */
export interface SearchAggregate {
  sampleSize: number;
  priceCount: number;
  reviewCount: number;
  badgeCount: number;
  rocketCount: number;
  averagePrice: number | null;
  averageReviews: number | null;
  rocketRatio: number | null;
}

export function aggregateSearch(result: CollectedSearchResult): SearchAggregate {
  const organic = uniqueSearchProducts({ ...result, items: result.items.filter((i) => !i.isAd) }).map((p) => p.item);
  const prices = organic.map((i) => i.price).filter((v): v is number => typeof v === "number" && v > 0);
  const reviews = organic.map((i) => i.reviewCount).filter((v): v is number => typeof v === "number" && v >= 0);
  const judged = organic.filter((i) => i.badge && i.badge !== "UNKNOWN");
  const rocket = judged.filter((i) => i.badge === "ROCKET" || i.badge === "ROCKET_GROWTH").length;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    sampleSize: organic.length,
    priceCount: prices.length,
    reviewCount: reviews.length,
    badgeCount: judged.length,
    rocketCount: rocket,
    averagePrice: prices.length ? Math.round(avg(prices)) : null,
    averageReviews: reviews.length ? Math.round(avg(reviews) * 10) / 10 : null,
    rocketRatio: judged.length ? Math.round((rocket / judged.length) * 10000) / 10000 : null,
  };
}

export function searchToKeywordRecord(result: CollectedSearchResult, agg = aggregateSearch(result)): CollectedKeyword | null {
  if (agg.sampleSize === 0) return null;
  return {
    source: result.source,
    confidence: result.confidence,
    capturedAt: result.capturedAt,
    tool: result.tool,
    keyword: result.keyword,
    averagePrice: agg.averagePrice,
    averageReviews: agg.averageReviews,
    rocketRatio: agg.rocketRatio,
    sampleSize: agg.sampleSize,
  };
}

/** 검색 칸 → 상품 스냅샷 (화면 칸에 보인 값만: 가격 · 정가 · 할인율 · 리뷰 · 평점 · 배송 · 판매자 유형) */
export function searchItemToProduct(result: CollectedSearchResult, p: SearchProduct): CollectedProduct {
  const i = p.item;
  return {
    source: result.source,
    confidence: result.confidence,
    capturedAt: result.capturedAt,
    tool: result.tool,
    coupangProductId: p.coupangProductId,
    productUrl: i.productUrl ?? null,
    productName: i.productName ?? null,
    price: i.price ?? null,
    originalPrice: i.originalPrice ?? null,
    discountRate: i.discountRate ?? null,
    reviewCount: i.reviewCount ?? null,
    // 평점은 넣지 않는다: 검색 칸의 별점(aria-label)은 0.5 단위로 반올림된 값 (예: 상품 페이지 3.8 → 검색 칸 4).
    // 같은 날 상품 페이지에서 읽은 정확한 평점을 덮어쓰지 않도록 수집 기록(observedOnly)에만 남긴다 (PHASE 12 실사용에서 발견)
    deliveryType: i.deliveryType ?? null,
    sellerType: i.sellerType ?? null,
    observedOnly: { from: "search", keyword: result.keyword, organicRank: p.organicRank, adRank: p.adRank, badge: i.badge ?? null, searchStarRating: i.rating ?? null },
  };
}
