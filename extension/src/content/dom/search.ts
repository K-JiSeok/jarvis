/**
 * 쿠팡 검색 결과 DOM → RawCoupangSearchPage. 2026-10-08 실제 검색 결과(키워드 5개)로 확인한 요소만 읽는다.
 *
 * - 검색 결과 목록: #product-list 의 상품 칸 (class 이름이 "ProductUnit_productUnit" 로 시작 — CSS 모듈 접두어, 뒤의 해시는 바뀔 수 있어 접두어로 찾는다)
 *   목록 중간의 묶음 칸(class "best-seller", "limited-time-offer" 등)은 상품 칸이 아니다 → 제외
 * - 광고: 칸 안의 "광고" 글자 (옆에 aria-label="Ad information" 버튼)
 * - 순위 배지: class "RankMark_rank…" 의 숫자 (자연 1~10위만)
 * - 상품 ID: 칸 안 상품 링크의 /vp/products/{id} (링크의 추적 파라미터는 버린다)
 */

import type { RawCoupangSearchItem, RawCoupangSearchPage } from "../../../../src/lib/collectors/coupang/search";
import { pickPrice } from "../../../../src/lib/collectors/coupang/product";

import { cleanUrl, imageName, priceLeaves, text } from "./helpers";

export function productUnits(): Element[] {
  const list = document.getElementById("product-list");
  if (!list) return [];
  return [...list.children].filter((li) => li.matches('[class*="ProductUnit_productUnit"]') && li.querySelector('a[href*="/vp/products/"]'));
}

function readItem(li: Element): RawCoupangSearchItem {
  const link = li.querySelector('a[href*="/vp/products/"]') as HTMLAnchorElement;
  const leaves = [...li.querySelectorAll("*")].filter((e) => e.children.length === 0);
  const adLabel = leaves.map(text).find((t) => t === "광고") ?? (li.querySelector('[aria-label="Ad information"]') ? "광고" : null);
  const rating = li.querySelector('[class*="ProductRating"] [aria-label]');
  const ratingBox = li.querySelector('[class*="ProductRating"]');
  const reviewText = ratingBox ? [...ratingBox.querySelectorAll("*")].map(text).find((t) => /^\([\d,]+\)$/.test(t)) : null;
  const price = pickPrice(priceLeaves(li.querySelector('[class*="PriceArea"]')));
  return {
    href: cleanUrl(link.href),
    adLabelText: adLabel,
    rankBadgeText: text(li.querySelector('[class*="RankMark_rank"]')) || null,
    productName: text(li.querySelector('[class*="productName"]')) || null,
    priceText: price.priceText,
    reviewCountText: reviewText ?? null,
    ratingText: rating?.getAttribute("aria-label") ?? null,
    badgeImageNames: [...li.querySelectorAll("img")].map(imageName).filter((n) => /^logo_rocket/i.test(n)),
  };
}

export function readSearchPage(): RawCoupangSearchPage {
  const input = document.querySelector('input[name="q"]') as HTMLInputElement | null;
  return { url: location.href, keyword: input?.value?.trim() || null, items: productUnits().map(readItem) };
}
