/**
 * 쿠팡 상품 ID / URL 해석 (서버·클라이언트 공용).
 * 지원: 숫자 productId, https://www.coupang.com/vp/products/{productId}?itemId=…&vendorItemId=…,
 *       모바일 m.coupang.com/vm/products/{productId}
 * 추적용 파라미터는 버리고 productId·itemId·vendorItemId 만 남긴 URL 을 만든다.
 */

export interface CoupangIds {
  productId: string;
  itemId: string | null;
  vendorItemId: string | null;
  /** 정리된 상품 URL. 숫자 ID 만 입력했으면 null (URL 을 지어내지 않는다) */
  url: string | null;
}

const ID = /^\d{1,20}$/;

export function isCoupangId(value: string): boolean {
  return ID.test(value);
}

export function parseCoupangInput(input: string): CoupangIds | null {
  const text = input.trim();
  if (!text) return null;
  if (ID.test(text)) return { productId: text, itemId: null, vendorItemId: null, url: null };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)coupang\.com$/i.test(url.hostname)) return null;

  const match = url.pathname.match(/\/v[pm]\/products\/(\d{1,20})(?:\/|$)/);
  if (!match) return null;

  const productId = match[1];
  const itemId = digitsOrNull(url.searchParams.get("itemId"));
  const vendorItemId = digitsOrNull(url.searchParams.get("vendorItemId"));

  const query = new URLSearchParams();
  if (itemId) query.set("itemId", itemId);
  if (vendorItemId) query.set("vendorItemId", vendorItemId);
  const qs = query.toString();

  return {
    productId,
    itemId,
    vendorItemId,
    url: `https://www.coupang.com/vp/products/${productId}${qs ? `?${qs}` : ""}`,
  };
}

function digitsOrNull(value: string | null): string | null {
  return value && ID.test(value) ? value : null;
}
