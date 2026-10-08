// 테스트용 가짜 쿠팡 화면 데이터 (실제 쿠팡 데이터 아님). 상품 ID 는 [TEST] 범위 99000007xx.

export const MOCK_META = { source: "EXTENSION", confidence: "B", capturedAt: "2026-10-07T05:30:00Z", tool: "mock-collector/0" };

export const MOCK_PRODUCT_PAGE = {
  url: "https://www.coupang.com/vp/products/9900000701?itemId=1&vendorItemId=2",
  title: "  [TEST] 실리콘 주방 트레이 3종 세트  ",
  priceText: "29,900원",
  originalPriceText: "35,000원",
  discountText: null,
  ratingText: "4.5",
  reviewCountText: "(1,234)",
  badgeTexts: ["로켓그로스", "내일(목) 도착 보장"],
  sellerText: "로켓그로스 판매자",
};

export const MOCK_SEARCH_PAGE = {
  url: "https://www.coupang.com/np/search?q=%5BTEST%5D+%EC%8B%A4%EB%A6%AC%EC%BD%98+%ED%8A%B8%EB%A0%88%EC%9D%B4&page=1",
  items: [
    { href: "https://www.coupang.com/vp/products/9900000702", adLabelText: "광고" },
    { href: "/vp/products/9900000701?itemId=3" },
    { href: "https://www.coupang.com/vp/products/9900000703", adLabelText: null },
    { href: "https://www.coupang.com/np/campaigns/123" },
  ],
};

export const MOCK_KEYWORD = {
  ...MOCK_META,
  keyword: "[TEST]  실리콘 트레이",
  searchVolume: "12,000",
  searchVolumePrevious: 10000,
  productCount: 30000,
  wingRatio: "45%",
  rocketRatio: 0.5,
  averageReviews: 800,
};

/** n 개 상품 × 날짜 스냅샷 (벤치마크용) */
export function mockProductSeries(productIds, days, startIso = "2025-01-01T03:00:00Z") {
  const out = [];
  for (const id of productIds) {
    for (let d = 0; d < days; d += 1) {
      const at = new Date(Date.parse(startIso) + d * 86400000).toISOString();
      out.push({ ...MOCK_META, capturedAt: at, coupangProductId: id, price: 20000 + d, reviewCount: d, rating: 4.5 });
    }
  }
  return out;
}
