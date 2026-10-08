/** DOM 읽기 도우미 (chrome API 없음 — 검사용 번들에서도 그대로 실행된다) */

import type { PriceLeaf } from "../../../../src/lib/collectors/coupang/product";

export const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** 이미지 주소의 파일 이름 (쿼리 제외) */
export function imageName(img: Element): string {
  const el = img as HTMLImageElement;
  try {
    return new URL(el.currentSrc || el.src || el.getAttribute("src") || "", location.href).pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

/** 요소 안의 글자 조각들 (화면 순서) + 취소선 여부 */
export function priceLeaves(root: Element | null | undefined): PriceLeaf[] {
  if (!root) return [];
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0 && text(e))
    .map((e) => ({ text: text(e), strike: e.tagName === "DEL" || getComputedStyle(e).textDecorationLine.includes("line-through") }));
}

/** 추적 파라미터를 빼고 경로만 (상품 ID 는 경로에 있다) */
export function cleanUrl(href: string): string {
  try {
    const u = new URL(href, location.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}
