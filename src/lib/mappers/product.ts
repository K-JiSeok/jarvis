import type { DataPoint } from "@/types/common";
import { isConfidence, isSourceType, type ProductLatestRow, type Tables } from "@/types/db";
import type { CategoryOption } from "@/types/keyword";
import {
  LIFECYCLE_STATUSES,
  SELLER_TYPES,
  type KeywordRankView,
  type LifecycleStatus,
  type PeriodDataPoint,
  type ProductDetail,
  type ProductMetrics,
  type ProductSnapshotView,
  type ProductSummary,
  type SellerType,
} from "@/types/product";

type ProductRow = Tables<"products">;
type SnapshotRow = Tables<"product_snapshots">;
type RankRow = Tables<"keyword_product_ranks"> & {
  keywords?: { keyword: string } | null;
  products?: { product_name: string; coupang_product_id: string } | null;
};

const NUMBER_METRICS = {
  price: "price",
  originalPrice: "original_price",
  discountRate: "discount_rate",
  reviewCount: "review_count",
  rating: "rating",
  categoryRank: "category_rank",
  optionCount: "option_count",
  views28d: "views_28d",
  conversionRate: "conversion_rate",
} as const;

const TEXT_METRICS = {
  productNameObserved: "product_name_observed",
  deliveryType: "delivery_type",
  sellerTypeObserved: "seller_type_observed",
} as const;

const PERIOD_METRICS = {
  salesActual: "sales_actual",
  salesEstimated: "sales_estimated",
  revenueActual: "revenue_actual",
  revenueEstimated: "revenue_estimated",
} as const;

type Column =
  | (typeof NUMBER_METRICS)[keyof typeof NUMBER_METRICS]
  | (typeof TEXT_METRICS)[keyof typeof TEXT_METRICS]
  | (typeof PERIOD_METRICS)[keyof typeof PERIOD_METRICS];

function toDataPoint<T extends number | string>(row: ProductLatestRow, column: Column): DataPoint<T> | null {
  const value = row[column] as T | null;
  const source = row[`${column}_source`];
  const confidence = row[`${column}_confidence`];
  if (value == null || !isSourceType(source) || !isConfidence(confidence)) return null;
  return { value, source, confidence, collectedAt: row[`${column}_captured_on`] ?? undefined };
}

function toPeriodPoint(row: ProductLatestRow, column: (typeof PERIOD_METRICS)[keyof typeof PERIOD_METRICS]): PeriodDataPoint | null {
  const point = toDataPoint<number>(row, column);
  return point ? { ...point, periodDays: row[`${column}_period_days`] } : null;
}

function mapEntries<K extends string, V>(map: Record<K, string>, fn: (column: string) => V): Record<K, V> {
  return Object.fromEntries(Object.entries(map).map(([key, column]) => [key, fn(column as string)])) as Record<K, V>;
}

export function toLifecycle(value: string | null | undefined): LifecycleStatus {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(value ?? "") ? (value as LifecycleStatus) : "ACTIVE";
}

export function toSellerType(value: string | null | undefined): SellerType | null {
  return (SELLER_TYPES as readonly string[]).includes(value ?? "") ? (value as SellerType) : null;
}

export function toProductSummary(
  row: ProductLatestRow,
  categories: Map<string, CategoryOption>,
  topKeywordRank: KeywordRankView | null,
): ProductSummary {
  const metrics: ProductMetrics = {
    ...mapEntries(NUMBER_METRICS, (c) => toDataPoint<number>(row, c as Column)),
    ...mapEntries(TEXT_METRICS, (c) => toDataPoint<string>(row, c as Column)),
    ...mapEntries(PERIOD_METRICS, (c) => toPeriodPoint(row, c as (typeof PERIOD_METRICS)[keyof typeof PERIOD_METRICS])),
  };

  return {
    id: row.product_id!,
    coupangProductId: row.coupang_product_id ?? "",
    productName: row.product_name ?? "",
    brand: row.brand,
    category: row.category_id ? (categories.get(row.category_id) ?? null) : null,
    sellerType: toSellerType(row.seller_type),
    lifecycleStatus: toLifecycle(row.lifecycle_status),
    isOwnProduct: row.is_own_product ?? false,
    lastSeenAt: row.last_seen_at ?? "",
    snapshotCount: row.snapshot_count ?? 0,
    latestCapturedOn: row.latest_captured_on,
    metrics,
    topKeywordRank,
  };
}

export function toProductSnapshotView(row: SnapshotRow): ProductSnapshotView {
  const meta = (row.metric_meta ?? {}) as Record<string, { source?: string } | undefined>;
  return {
    id: row.id,
    capturedOn: row.captured_on,
    capturedAt: row.captured_at,
    source: isSourceType(row.source_type) ? row.source_type : "MANUAL",
    confidence: isConfidence(row.confidence) ? row.confidence : "C",
    productNameObserved: row.product_name_observed,
    price: row.price,
    originalPrice: row.original_price,
    discountRate: row.discount_rate,
    deliveryType: row.delivery_type,
    sellerTypeObserved: row.seller_type_observed,
    reviewCount: row.review_count,
    rating: row.rating,
    categoryRank: row.category_rank,
    optionCount: row.option_count,
    views28d: row.views_28d,
    salesPeriodDays: row.sales_period_days,
    salesActual: row.sales_actual,
    salesEstimated: row.sales_estimated,
    revenueActual: row.revenue_actual,
    revenueEstimated: row.revenue_estimated,
    conversionRate: row.conversion_rate,
    calculatedFields: Object.entries(meta)
      .filter(([, v]) => v?.source === "CALCULATED")
      .map(([k]) => k),
    isExcluded: row.is_excluded,
    excludedReason: row.excluded_reason,
  };
}

export function toKeywordRankView(row: RankRow): KeywordRankView {
  return {
    id: row.id,
    keywordId: row.keyword_id,
    keyword: row.keywords?.keyword ?? "",
    productId: row.product_id,
    productName: row.products?.product_name ?? null,
    coupangProductId: row.products?.coupang_product_id ?? null,
    rank: row.rank_position,
    isAd: row.is_ad,
    page: row.page,
    capturedOn: row.captured_on,
    source: isSourceType(row.source_type) ? row.source_type : "MANUAL",
    confidence: isConfidence(row.confidence) ? row.confidence : "C",
  };
}

/**
 * 상품별 대표 키워드 순위: 가장 최근 수집일의 자연 노출(is_ad = false) 중 최고 순위.
 * 상품 하나가 여러 키워드에 걸리므로 "어느 키워드에서"를 함께 돌려준다.
 */
export function pickTopKeywordRank(ranks: KeywordRankView[]): KeywordRankView | null {
  const natural = ranks.filter((r) => !r.isAd);
  if (natural.length === 0) return null;
  const latest = natural.reduce((max, r) => (r.capturedOn > max ? r.capturedOn : max), natural[0].capturedOn);
  return natural.filter((r) => r.capturedOn === latest).reduce((best, r) => (r.rank < best.rank ? r : best));
}

export function toProductDetail(
  summary: ProductSummary,
  master: ProductRow,
  snapshots: SnapshotRow[],
  ranks: KeywordRankView[],
): ProductDetail {
  return {
    ...summary,
    master: {
      coupangItemId: master.coupang_item_id,
      coupangVendorItemId: master.coupang_vendor_item_id,
      productUrl: master.product_url,
      optionCount: master.option_count,
      isCoupangPb: master.is_coupang_pb,
      firstSeenAt: master.first_seen_at,
      deletedDetectedAt: master.deleted_detected_at,
      createdAt: master.created_at,
      updatedAt: master.updated_at,
    },
    snapshots: snapshots.map(toProductSnapshotView),
    ranks,
  };
}
