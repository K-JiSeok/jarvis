/**
 * 쿠팡 검색 결과 어댑터: 화면에서 읽은 목록 → CollectedSearchResult (순수 함수).
 * DOM 을 다루지 않는다 (selector 는 PHASE 11 에서 실제 페이지로 확인).
 *
 * 순위 규칙: 받은 순서대로 1, 2, 3 … (광고와 자연 노출을 같은 순서로 센다) — 화면에 보인 위치 그대로.
 * 광고 여부: 광고 표시 문구를 읽었으면 true, 읽지 못했으면 null → 자연 노출로 저장된다.
 */

import type { CollectedSearchResult } from "../types";

import { productIdFromUrl, type CollectMeta } from "./product";

export interface RawCoupangSearchPage {
  /** 검색 결과 URL (예: https://www.coupang.com/np/search?q=…&page=2) */
  url: string;
  /** URL 에서 못 찾을 때 */
  keyword?: string | null;
  items: { href: string; adLabelText?: string | null }[];
}

export function searchParamsOf(url: string): { keyword: string | null; page: number | null } {
  try {
    const u = new URL(url);
    const q = u.searchParams.get("q");
    const page = Number(u.searchParams.get("page"));
    return { keyword: q?.trim() || null, page: Number.isInteger(page) && page >= 1 ? page : null };
  } catch {
    return { keyword: null, page: null };
  }
}

export function adaptSearchPage(raw: RawCoupangSearchPage, meta: CollectMeta): CollectedSearchResult {
  const { keyword, page } = searchParamsOf(raw.url);
  return {
    ...meta,
    keyword: raw.keyword?.trim() || keyword || "",
    page,
    items: raw.items.map((item, i) => ({
      coupangProductId: productIdFromUrl(item.href),
      productUrl: item.href,
      rank: i + 1,
      isAd: item.adLabelText ? /광고|AD|sponsored/i.test(item.adLabelText) : null,
    })),
  };
}
