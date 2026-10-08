/**
 * 수집기(확장 프로그램 등)가 만드는 원본 데이터 타입. DB 와 무관하다.
 *
 *   쿠팡 화면 → (수집기) → Collected* → normalize.ts → NormalizedRecord → ingest_batch → DB
 *
 * 원칙
 * - 화면에서 직접 확인한 값만 넣는다. 확인하지 못한 값은 비운다 (null/undefined = 모름).
 * - 일반 쿠팡 페이지에서 판매량 · 매출 · 전환율 · 조회수 · 광고 입찰가를 얻을 수 있다고 가정하지 않는다.
 *   → 공개 상품 페이지 타입(CollectedProduct)에는 그런 필드가 아예 없다.
 *   → 판매자 센터(WING) 화면에서 본 값은 CollectedProduct.wing 에만, source = WING_SESSION 일 때만 받는다.
 * - 신뢰도(confidence)는 수집기가 명시한다. 기본값으로 A 를 주지 않는다.
 * - 숫자는 number 또는 화면 문자열("29,900원", "4.5", "45%") 그대로 둘 다 받는다. 비율을 number 로 줄 때는 0~1 소수.
 */

export const COLLECTOR_SOURCES = ["COUPANG_PAGE", "EXTENSION", "WING_SESSION"] as const;
export type CollectorSource = (typeof COLLECTOR_SOURCES)[number];
export type CollectorConfidence = "A" | "B" | "C";

/** 화면에서 읽은 값 (숫자 또는 화면 문자열). null/undefined = 확인 못 함 */
export type Observed = number | string | null | undefined;

export interface CollectedBase {
  source: CollectorSource;
  confidence: CollectorConfidence;
  /** 화면을 본 시각 (ISO 8601). 수집일(KST)은 여기서 계산한다 */
  capturedAt: string;
  /** 수집기 이름·버전 (import_jobs.source_tool 용, 예: "jarvis-extension/0.1") */
  tool?: string;
}

/** 쿠팡 공개 상품 페이지에서 볼 수 있는 값 */
export interface CollectedProduct extends CollectedBase {
  /** 쿠팡 상품 ID. 없으면 productUrl 의 /products/{id} 에서 찾는다 */
  coupangProductId?: string | null;
  productUrl?: string | null;
  productName?: string | null;
  price?: Observed;
  originalPrice?: Observed;
  discountRate?: Observed;
  reviewCount?: Observed;
  rating?: Observed;
  /** 배송 배지 문구 (예: "로켓배송", "로켓그로스", "판매자배송") 또는 DB 코드 */
  deliveryType?: string | null;
  /** 판매자 유형 문구 (예: "쿠팡 직매입", "WING") 또는 DB 코드 */
  sellerType?: string | null;
  categoryRank?: Observed;
  /** WING(판매자 센터) 화면에서 본 값 — source = WING_SESSION 일 때만 저장 */
  wing?: CollectedWingMetrics | null;
}

/** WING 화면에서만 볼 수 있는 값. 어떤 값이 실제로 보이는지는 확장 프로그램 단계에서 확인한다 */
export interface CollectedWingMetrics {
  views28d?: Observed;
  conversionRate?: Observed;
}

/** 쿠팡 검색 결과 한 페이지 */
export interface CollectedSearchResult extends CollectedBase {
  keyword: string;
  /** 검색 결과 페이지 번호 (모르면 비움) */
  page?: number | null;
  items: CollectedSearchItem[];
}

export interface CollectedSearchItem {
  coupangProductId?: string | null;
  productUrl?: string | null;
  /** 화면에 보인 순서 (1부터). 광고·자연 노출을 같은 순서로 셀지는 수집기가 정해서 넣는다 */
  rank: Observed;
  /** 광고 표시가 있으면 true. 확인 못 하면 false 로 두지 말고 null — null 이면 자연 노출로 저장한다 */
  isAd?: boolean | null;
}

/** 키워드 지표 (키워드 도구·WING 키워드 화면 등에서 본 값) */
export interface CollectedKeyword extends CollectedBase {
  keyword: string;
  searchVolume?: Observed;
  searchVolumePrevious?: Observed;
  productCount?: Observed;
  wingRatio?: Observed;
  rocketRatio?: Observed;
  brandConcentration?: Observed;
  averagePrice?: Observed;
  averageReviews?: Observed;
  adBid?: Observed;
}

export interface NormalizeIssue {
  field: string;
  message: string;
}
