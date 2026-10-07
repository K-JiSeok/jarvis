import { toLifecycle, toProductMetrics } from "@/lib/mappers/product";
import { isSourceType, type ProductLatestRow, type Tables } from "@/types/db";
import { RELATION_TYPES, type CompetitorRelation, type ProductRef, type RelationType } from "@/types/competitor";

type ProductRefRow = Pick<Tables<"products">, "id" | "product_name" | "coupang_product_id" | "lifecycle_status">;

export type CompetitorRow = Tables<"competitors"> & {
  base: ProductRefRow | null;
  competitor: ProductRefRow | null;
  keywords: { keyword: string } | null;
};

export function toRelationType(value: string | null | undefined): RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value ?? "") ? (value as RelationType) : "SIMILAR";
}

export function toProductRef(row: ProductRefRow | null, fallbackId: string): ProductRef {
  return {
    id: row?.id ?? fallbackId,
    productName: row?.product_name ?? "",
    coupangProductId: row?.coupang_product_id ?? "",
    lifecycleStatus: toLifecycle(row?.lifecycle_status),
  };
}

export function toCompetitorRelation(row: CompetitorRow, latest: Map<string, ProductLatestRow>): CompetitorRelation {
  const metricsRow = latest.get(row.competitor_product_id);
  return {
    id: row.id,
    base: toProductRef(row.base, row.product_id),
    competitor: toProductRef(row.competitor, row.competitor_product_id),
    relationType: toRelationType(row.relation_type),
    keywordId: row.keyword_id,
    keyword: row.keywords?.keyword ?? null,
    source: isSourceType(row.source_type) ? row.source_type : "MANUAL",
    memo: row.memo,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    competitorMetrics: metricsRow ? toProductMetrics(metricsRow) : null,
    competitorLatestCapturedOn: metricsRow?.latest_captured_on ?? null,
  };
}
