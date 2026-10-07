import type { DataPoint } from "@/types/common";
import { isConfidence, isSourceType, type KeywordLatestRow, type Tables } from "@/types/db";
import type {
  CategoryOption,
  KeywordDetail,
  KeywordMetrics,
  KeywordSnapshotView,
  KeywordSummary,
} from "@/types/keyword";

type CategoryRow = Pick<Tables<"categories">, "id" | "name" | "path">;
type KeywordRow = Pick<Tables<"keywords">, "memo" | "updated_at">;
type SnapshotRow = Tables<"keyword_snapshots">;

/** v_keyword_latest 의 지표 컬럼 이름 (값, _source, _confidence, _captured_on 이 한 묶음) */
const METRIC_COLUMNS = {
  searchVolume: "search_volume",
  searchVolumePrevious: "search_volume_previous",
  searchGrowthRate: "search_growth_rate",
  coupangProductCount: "coupang_product_count",
  competitionIntensity: "competition_intensity",
  wingRatio: "wing_ratio",
  rocketRatio: "rocket_ratio",
  averagePrice: "average_price",
  averageReviews: "average_reviews",
  brandConcentration: "brand_concentration",
  sampleSize: "sample_size",
  adBid: "ad_bid",
} as const satisfies Record<keyof KeywordMetrics, string>;

type MetricColumn = (typeof METRIC_COLUMNS)[keyof typeof METRIC_COLUMNS];

/** 뷰의 한 지표 → DataPoint. 값이 없거나 출처 정보가 잘못됐으면 null */
function toDataPoint(row: KeywordLatestRow, column: MetricColumn): DataPoint | null {
  const value = row[column];
  const source = row[`${column}_source`];
  const confidence = row[`${column}_confidence`];
  if (value == null || !isSourceType(source) || !isConfidence(confidence)) return null;
  return { value, source, confidence, collectedAt: row[`${column}_captured_on`] ?? undefined };
}

export function toKeywordSummary(
  row: KeywordLatestRow,
  categories: Map<string, CategoryOption>,
  keyword?: KeywordRow,
): KeywordSummary {
  const metrics = Object.fromEntries(
    Object.entries(METRIC_COLUMNS).map(([key, column]) => [key, toDataPoint(row, column)]),
  ) as unknown as KeywordMetrics;

  return {
    id: row.keyword_id!,
    keyword: row.keyword ?? "",
    normalizedKeyword: row.normalized_keyword ?? "",
    category: row.category_id ? (categories.get(row.category_id) ?? null) : null,
    isTracking: row.is_tracking ?? true,
    memo: keyword?.memo ?? null,
    updatedAt: keyword?.updated_at ?? null,
    snapshotCount: row.snapshot_count ?? 0,
    latestCapturedOn: row.latest_captured_on,
    metrics,
  };
}

export function toKeywordSnapshotView(row: SnapshotRow): KeywordSnapshotView {
  const meta = (row.metric_meta ?? {}) as Record<string, { source?: string } | undefined>;
  return {
    id: row.id,
    capturedOn: row.captured_on,
    capturedAt: row.captured_at,
    source: isSourceType(row.source_type) ? row.source_type : "MANUAL",
    confidence: isConfidence(row.confidence) ? row.confidence : "C",
    searchVolume: row.search_volume,
    searchVolumePrevious: row.search_volume_previous,
    searchGrowthRate: row.search_growth_rate,
    coupangProductCount: row.coupang_product_count,
    competitionIntensity: row.competition_intensity,
    wingRatio: row.wing_ratio,
    rocketRatio: row.rocket_ratio,
    averagePrice: row.average_price,
    averageReviews: row.average_reviews,
    brandConcentration: row.brand_concentration,
    sampleSize: row.sample_size,
    adBid: row.ad_bid,
    calculatedFields: Object.entries(meta)
      .filter(([, v]) => v?.source === "CALCULATED")
      .map(([k]) => k),
    isExcluded: row.is_excluded,
    excludedReason: row.excluded_reason,
  };
}

export function toCategoryOption(row: CategoryRow): CategoryOption {
  return { id: row.id, name: row.name, path: row.path };
}

export function toKeywordDetail(summary: KeywordSummary, snapshots: SnapshotRow[]): KeywordDetail {
  return { ...summary, snapshots: snapshots.map(toKeywordSnapshotView) };
}
