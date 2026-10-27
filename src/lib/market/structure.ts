/**
 * 시장 구조 (PHASE 25 · market-structure-v1) — 순수 함수. DB 와 무관하다.
 * 한 키워드의 한 번 수집한 검색 결과(자연 순위 + 광고 칸)로 "이 시장에 들어갈 만한가"의 재료를 만든다.
 *
 * 왜 필요한가 (PHASE 25 점검)
 *   - 기존 검색 집계는 평균만 냈다 → 리뷰 1만 개 상품 하나가 평균을 끌어올린다 → 중앙값 · 상위 10개 기준으로 본다.
 *   - "로켓 비율"이 쿠팡 직매입과 로켓그로스를 합쳤다 → 둘은 진입 난이도에서 반대 신호다.
 *     직매입이 많으면 쿠팡과 경쟁 (어려움), 로켓그로스 · 판매자배송이 많으면 우리 같은 판매자가 이미 팔고 있음 (진입 가능).
 *
 * 판매자 구분 (상품 페이지에서 확인한 판매자 유형 → 배송 배지 순으로)
 *   RETAIL      쿠팡 직매입 (로켓배송)
 *   GROWTH      로켓그로스 판매자 (판매자로켓)
 *   SELLER      판매자배송 (WING). 검색 칸에서 로켓 배지가 없는 상품도 여기로 본다 (추정 — 로켓직구 등 예외 가능)
 *   UNKNOWN     판단 재료 없음
 *   제3자 판매자 = GROWTH + SELLER
 */

export const MARKET_STRUCTURE_VERSION = "market-structure-v1";

/** 판단 기준 (가정 — 화면에 표시하고, 바꾸면 버전을 올린다) */
export const MARKET_RULES = {
  top: 10,
  /** 상위 10개 중 이 리뷰 수 미만이면 "신규도 들어올 수 있는 자리" */
  lowReview: 100,
  /** 위험 표시 기준 */
  retailDominant: 0.7,
  adHeavy: 0.3,
  reviewWall: 1000,
  /** 비율을 낼 최소 표본 (판매자 유형을 아는 자연 상위 상품 수) */
  minKnown: 5,
} as const;

export type SellerKind = "RETAIL" | "GROWTH" | "SELLER" | "UNKNOWN";

export interface MarketItem {
  rankPosition: number;
  isAd: boolean;
  price: number | null;
  reviewCount: number | null;
  /** 상품 페이지에서 확인한 판매자 유형 (COUPANG_RETAIL · ROCKET_GROWTH_SELLER · WING_SELLER · …) */
  sellerType: string | null;
  /** 배송 유형 (ROCKET · ROCKET_GROWTH · SELLER_DELIVERY · …). 검색 칸에서 로켓 배지가 없으면 null */
  deliveryType: string | null;
  /** 이 상품의 배송 정보를 수집한 적이 있는가 (null 이 "배지 없음"인지 "모름"인지 가르는 데 씀) */
  observed: boolean;
}

export interface MarketRisk {
  type: "RETAIL_DOMINANT" | "AD_HEAVY" | "REVIEW_WALL";
  message: string;
}

export interface MarketStructure {
  version: typeof MARKET_STRUCTURE_VERSION;
  capturedOn: string;
  /** 자연 순위 상품 수 · 광고 칸 수 */
  organic: number;
  ads: number;
  /** 광고 칸 ÷ 전체 칸 */
  adRatio: number | null;
  /** 자연 상위 N개 기준 */
  topN: number;
  medianPrice: number | null;
  medianReviews: number | null;
  /** 상위 N개 중 리뷰 MARKET_RULES.lowReview 개 미만 상품 수 · 리뷰 수를 아는 상품 수 */
  lowReviewCount: number;
  reviewKnown: number;
  sellers: Record<SellerKind, number>;
  /** 판매자 유형을 아는 상위 상품 수 (UNKNOWN 제외) */
  sellerKnown: number;
  retailRatio: number | null;
  thirdPartyRatio: number | null;
  risks: MarketRisk[];
}

export function sellerKindOf(i: Pick<MarketItem, "sellerType" | "deliveryType" | "observed">): SellerKind {
  const s = i.sellerType ?? "";
  if (s === "COUPANG_RETAIL") return "RETAIL";
  if (s === "ROCKET_GROWTH_SELLER") return "GROWTH";
  if (s === "WING_SELLER") return "SELLER";
  const d = i.deliveryType ?? "";
  if (d === "ROCKET") return "RETAIL";
  if (d === "ROCKET_GROWTH") return "GROWTH";
  if (d === "SELLER_DELIVERY") return "SELLER";
  // 수집은 했는데 로켓 배지가 없었다 → 판매자배송으로 본다 (추정)
  if (i.observed && !d) return "SELLER";
  return "UNKNOWN";
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);

/** 같은 키워드 · 같은 수집일의 칸들 → 시장 구조. 자연 순위가 하나도 없으면 null */
export function marketStructure(capturedOn: string, items: MarketItem[]): MarketStructure | null {
  const organic = items.filter((i) => !i.isAd).sort((a, b) => a.rankPosition - b.rankPosition);
  if (organic.length === 0) return null;
  const ads = items.length - organic.length;
  const top = organic.slice(0, MARKET_RULES.top);

  const prices = top.map((i) => i.price).filter((v): v is number => v != null && v > 0);
  const reviews = top.map((i) => i.reviewCount).filter((v): v is number => v != null && v >= 0);
  const sellers: Record<SellerKind, number> = { RETAIL: 0, GROWTH: 0, SELLER: 0, UNKNOWN: 0 };
  for (const i of top) sellers[sellerKindOf(i)] += 1;
  const sellerKnown = top.length - sellers.UNKNOWN;
  const enough = sellerKnown >= Math.min(MARKET_RULES.minKnown, top.length);

  const m: MarketStructure = {
    version: MARKET_STRUCTURE_VERSION,
    capturedOn,
    organic: organic.length,
    ads,
    adRatio: ratio(ads, items.length),
    topN: top.length,
    medianPrice: median(prices),
    medianReviews: median(reviews),
    lowReviewCount: reviews.filter((r) => r < MARKET_RULES.lowReview).length,
    reviewKnown: reviews.length,
    sellers,
    sellerKnown,
    retailRatio: enough ? ratio(sellers.RETAIL, sellerKnown) : null,
    thirdPartyRatio: enough ? ratio(sellers.GROWTH + sellers.SELLER, sellerKnown) : null,
    risks: [],
  };

  if (m.retailRatio != null && m.retailRatio >= MARKET_RULES.retailDominant) {
    m.risks.push({ type: "RETAIL_DOMINANT", message: `상위 ${m.topN}개 중 쿠팡 직매입 ${Math.round(m.retailRatio * 100)}% — 쿠팡과 직접 경쟁` });
  }
  if (m.adRatio != null && m.adRatio >= MARKET_RULES.adHeavy) {
    m.risks.push({ type: "AD_HEAVY", message: `검색 결과 칸의 ${Math.round(m.adRatio * 100)}%가 광고 — 광고비 없이 노출 어려움` });
  }
  if (m.medianReviews != null && m.medianReviews >= MARKET_RULES.reviewWall) {
    m.risks.push({ type: "REVIEW_WALL", message: `상위 ${m.topN}개 리뷰 중앙값 ${Math.round(m.medianReviews).toLocaleString("ko-KR")}개 — 신규 상품이 따라잡기 어려움` });
  }
  return m;
}

/** 한 줄 요약 (추천 · 화면 공용) */
export function describeMarket(m: MarketStructure): string {
  const parts = [`자연 상위 ${m.topN}개`];
  if (m.medianReviews != null) parts.push(`리뷰 중앙값 ${Math.round(m.medianReviews).toLocaleString("ko-KR")}개`);
  parts.push(`리뷰 ${MARKET_RULES.lowReview}개 미만 ${m.lowReviewCount}/${m.reviewKnown}개`);
  if (m.retailRatio != null && m.thirdPartyRatio != null) {
    parts.push(`직매입 ${Math.round(m.retailRatio * 100)}% · 제3자 판매자 ${Math.round(m.thirdPartyRatio * 100)}%`);
  } else {
    parts.push(`판매자 유형 확인 ${m.sellerKnown}개 (비율 계산에 부족)`);
  }
  if (m.adRatio != null) parts.push(`광고 칸 ${Math.round(m.adRatio * 100)}%`);
  return parts.join(" · ");
}
