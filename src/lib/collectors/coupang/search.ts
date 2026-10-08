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

import type { CollectedSearchItem, CollectedSearchResult } from "../types";

import { productIdFromUrl, type CollectMeta } from "./product";

export interface RawCoupangSearchItem {
  href: string;
  adLabelText?: string | null;
  /** 칸 안에 보인 순위 배지 숫자 (자연 상품 1~10 위만 보인다) */
  rankBadgeText?: string | null;
  productName?: string | null;
  priceText?: string | null;
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

export function adaptSearchPage(raw: RawCoupangSearchPage, meta: CollectMeta): CollectedSearchResult {
  const { keyword, page } = searchParamsOf(raw.url);
  let organic = 0;
  let ads = 0;
  const items: CollectedSearchItem[] = raw.items.map((item, i) => {
    const isAd = isAdLabel(item.adLabelText);
    const rank = isAd ? ++ads : ++organic;
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
    };
  });
  // 검색어는 URL 의 q 를 먼저 쓴다 (검색창 글자는 사용자가 고치는 중일 수 있다)
  return { ...meta, keyword: keyword || raw.keyword?.trim() || "", page, items };
}
