/**
 * 쿠팡 상품 상세 페이지 DOM → RawCoupangProductPage. 2026-10-08 실제 페이지(상품 5개)로 확인한 요소만 읽는다.
 *
 * 우선순위: URL → 구조화 데이터(JSON-LD schema.org Product · BreadcrumbList) → 의미 있는 class
 *          (.product-title · .price-container · .seller-info · .rating-count-txt · #navigation-tabs) → 글자.
 * 자동 생성 class(twc-…)는 쓰지 않는다.
 */

import { badgeFromImageName, pickPrice, ratingFromStarWidth, type RawCoupangProductPage } from "../../../../src/lib/collectors/coupang/product";

import { cleanUrl, imageName, priceLeaves, text } from "./helpers";

interface LdNode {
  "@type"?: string;
  name?: string;
  sku?: string;
  offers?: { price?: string | number; priceSpecification?: { price?: string | number; priceType?: string } };
  aggregateRating?: { ratingValue?: string | number; ratingCount?: string | number };
  itemListElement?: { name?: string }[];
}

export function jsonLd(type: string): LdNode | null {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent ?? "") as LdNode;
      if (j?.["@type"] === type) return j;
    } catch {
      // 다른 스크립트는 무시
    }
  }
  return null;
}

export const productTitle = () => text(document.querySelector("h1.product-title")) || jsonLd("Product")?.name || "";

/** 가격 아래 배송 배지 1개 (다른 상품 광고 링크 · 옵션 목록 안 배지 제외. 없으면 선택된 옵션의 배지) */
function deliveryBadgeImages(): string[] {
  const atf = document.querySelector(".prod-atf-contents");
  const own = [...(atf?.querySelectorAll("img") ?? [])].filter((img) => !img.closest("a[href]") && !img.closest(".option-table-list")).map(imageName);
  const known = own.filter((n) => badgeFromImageName(n));
  if (known.length > 0) return known.slice(0, 1);
  const selected = [...document.querySelectorAll(".option-table-list__option--selected .option-table-list__option-delivery-badge-v2 img")].map(imageName);
  return selected.filter((n) => badgeFromImageName(n)).slice(0, 1);
}

function reviewCountText(ld: LdNode | null): string | null {
  if (ld?.aggregateRating?.ratingCount != null) return String(ld.aggregateRating.ratingCount);
  const atf = text(document.querySelector(".rating-count-txt"));
  if (atf) return atf;
  // 리뷰가 없으면 위 두 곳이 비고 탭에 "상품평 (0)" 이 보인다 (실제 0)
  return [...document.querySelectorAll("#navigation-tabs a, #navigation-tabs button")].map(text).find((t) => /^상품평\s*\([\d,]+\)$/.test(t)) ?? null;
}

/**
 * 리뷰 목록에 지금 보이는 리뷰의 작성일 (화면 순서 그대로, 최대 20개). 정렬 버튼을 누르지 않는다 — 사용자가 [최신순]을 고른 화면이면
 * 날짜가 최신부터 이어져 판매량 추정(est-sales-v1)에 쓰고, [베스트순]이면 순서가 섞여 서버가 쓰지 않는다.
 * 2026-10-13 실제 페이지: 리뷰 1개 = <article>, 작성일 "2026.10.08" 글자만 있는 요소.
 */
export function reviewDates(): string[] {
  const out: string[] = [];
  for (const a of document.querySelectorAll("article")) {
    const el = [...a.querySelectorAll("div, span")].find((e) => e.children.length === 0 && /^20\d\d\.\d\d?\.\d\d?$/.test((e.textContent ?? "").trim()));
    if (!el) continue;
    const [y, m, d] = el.textContent!.trim().split(".");
    out.push(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    if (out.length >= 20) break;
  }
  return out;
}

export function readProductPage(): RawCoupangProductPage {
  const ld = jsonLd("Product");
  const crumbs = jsonLd("BreadcrumbList");
  const price = pickPrice(priceLeaves(document.querySelector(".price-container")));
  const pageNo = document.body.innerText.match(/쿠팡상품번호\s*:\s*(\d+)/)?.[1] ?? null;
  const atfText = text(document.querySelector(".prod-atf-contents"));
  const spec = ld?.offers?.priceSpecification;
  return {
    url: cleanUrl(location.href),
    title: productTitle() || null,
    pageProductIds: [ld?.sku?.split("-")[0], pageNo],
    priceText: price.priceText,
    originalPriceText: price.originalPriceText ?? (spec?.priceType?.endsWith("StrikethroughPrice") && spec.price != null ? String(spec.price) : null),
    discountText: price.discountText,
    ratingText: ld?.aggregateRating?.ratingValue != null ? String(ld.aggregateRating.ratingValue) : ratingFromStarWidth(document.querySelector(".rating-star-num")?.getAttribute("style")),
    reviewCountText: reviewCountText(ld),
    badgeImageNames: deliveryBadgeImages(),
    // innerText: 요소 사이에 줄바꿈이 들어가 판매자명과 다음 문구가 붙지 않는다 (textContent 는 "제이에스인터판매자 상품…" 처럼 붙음)
    sellerInfoText: (document.querySelector(".seller-info") as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim() || null,
    observedOnly: {
      monthlyBuyers: atfText.match(/한 달간\s*([\d,]+\s*명 이상)\s*구매했어요/)?.[1] ?? null,
      // 판매량 추정용 (PHASE 22): 지금 보이는 리뷰 작성일 "YYYY-MM-DD,…" — 최신순 화면일 때만 서버가 사용
      reviewDates: reviewDates().join(",") || null,
      wowPrice: price.wowPriceText,
      jsonLdPrice: ld?.offers?.price != null ? String(ld.offers.price) : null,
      category:
        crumbs?.itemListElement
          ?.map((c) => c.name)
          .filter((n) => n && n !== "쿠팡 홈")
          .join(" > ") || null,
    },
  };
}
