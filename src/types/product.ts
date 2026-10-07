import type { Confidence, DataPoint, SourceType } from "./common";
import type { CategoryOption } from "./keyword";

/**
 * 상품 화면용 도메인 타입. DB 행과 분리한다 (변환: src/lib/mappers/product.ts).
 * master(products) = 현재 상태, snapshot(product_snapshots) = 관측 시점 데이터.
 * 값이 없으면 null (0 으로 채우지 않는다).
 */

/** products.lifecycle_status (DB CHECK 와 동일) */
export const LIFECYCLE_STATUSES = ["ACTIVE", "UNAVAILABLE", "DELETED"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  ACTIVE: "판매 중",
  UNAVAILABLE: "판매 불가·품절",
  DELETED: "삭제·판매 종료",
};

/** products.seller_type / product_snapshots.seller_type_observed */
export const SELLER_TYPES = ["COUPANG_RETAIL", "ROCKET_GROWTH_SELLER", "WING_SELLER", "UNKNOWN"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
export const SELLER_TYPE_LABELS: Record<SellerType, string> = {
  COUPANG_RETAIL: "쿠팡 직매입",
  ROCKET_GROWTH_SELLER: "로켓그로스 판매자",
  WING_SELLER: "WING 판매자",
  UNKNOWN: "알 수 없음",
};

/** product_snapshots.delivery_type */
export const DELIVERY_TYPES = ["ROCKET", "ROCKET_GROWTH", "ROCKET_FRESH", "SELLER_DELIVERY", "OVERSEAS", "OTHER"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];
export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  ROCKET: "로켓배송",
  ROCKET_GROWTH: "로켓그로스",
  ROCKET_FRESH: "로켓프레시",
  SELLER_DELIVERY: "판매자 배송",
  OVERSEAS: "해외 배송",
  OTHER: "기타",
};

/** 판매량·매출은 집계 기간과 함께 다닌다 (28일 고정이 아님) */
export type PeriodDataPoint = DataPoint & { periodDays: number | null };

/** v_product_latest 의 현재 값 */
export interface ProductMetrics {
  productNameObserved: DataPoint<string> | null;
  price: DataPoint | null;
  originalPrice: DataPoint | null;
  /** 0~1 */
  discountRate: DataPoint | null;
  deliveryType: DataPoint<string> | null;
  sellerTypeObserved: DataPoint<string> | null;
  reviewCount: DataPoint | null;
  rating: DataPoint | null;
  categoryRank: DataPoint | null;
  optionCount: DataPoint | null;
  views28d: DataPoint | null;
  /** 실제 확인된 판매량 */
  salesActual: PeriodDataPoint | null;
  /** 외부 도구·참고 자료의 추정 판매량 */
  salesEstimated: PeriodDataPoint | null;
  revenueActual: PeriodDataPoint | null;
  revenueEstimated: PeriodDataPoint | null;
  /** 0~1 */
  conversionRate: DataPoint | null;
}

/** 키워드 검색 순위 1건 (keyword_product_ranks) */
export interface KeywordRankView {
  id: number;
  keywordId: string;
  keyword: string;
  productId: string;
  productName: string | null;
  coupangProductId: string | null;
  rank: number;
  isAd: boolean;
  page: number | null;
  capturedOn: string;
  source: SourceType;
  confidence: Confidence;
}

export interface ProductSummary {
  id: string;
  coupangProductId: string;
  productName: string;
  brand: string | null;
  category: CategoryOption | null;
  sellerType: SellerType | null;
  lifecycleStatus: LifecycleStatus;
  isOwnProduct: boolean;
  lastSeenAt: string;
  snapshotCount: number;
  latestCapturedOn: string | null;
  metrics: ProductMetrics;
  /** 가장 최근 수집일의 자연 노출 최고 순위 (키워드마다 다르므로 키워드명과 함께) */
  topKeywordRank: KeywordRankView | null;
}

export interface ProductSnapshotView {
  id: number;
  capturedOn: string;
  capturedAt: string;
  source: SourceType;
  confidence: Confidence;
  productNameObserved: string | null;
  price: number | null;
  originalPrice: number | null;
  discountRate: number | null;
  deliveryType: string | null;
  sellerTypeObserved: string | null;
  reviewCount: number | null;
  rating: number | null;
  categoryRank: number | null;
  optionCount: number | null;
  views28d: number | null;
  salesPeriodDays: number | null;
  salesActual: number | null;
  salesEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  conversionRate: number | null;
  calculatedFields: string[];
  isExcluded: boolean;
  excludedReason: string | null;
}

export interface ProductMaster {
  coupangItemId: string | null;
  coupangVendorItemId: string | null;
  productUrl: string | null;
  optionCount: number | null;
  isCoupangPb: boolean | null;
  firstSeenAt: string;
  deletedDetectedAt: string | null;
  createdAt: string;
  /** 수정 폼을 저장 후 새 값으로 다시 그리기 위한 기준 */
  updatedAt: string;
}

export interface ProductDetail extends ProductSummary {
  master: ProductMaster;
  snapshots: ProductSnapshotView[];
  ranks: KeywordRankView[];
}
