/**
 * Collected* → NormalizedRecord (순수 함수). 값 변환 규칙은 파일 가져오기(src/lib/import/core.ts convertCell)와 같다.
 * DB 를 부르지 않는다. 상품·키워드 id 는 ingest_batch 가 본인 데이터에서 찾는다 (미등록 → PRODUCT/KEYWORD_NOT_FOUND).
 */

import {
  convertCell,
  fieldDef,
  type FieldDef,
  type ImportType,
  type NormalizedKeywordSnapshot,
  type NormalizedProductSnapshot,
  type NormalizedRank,
} from "../import/core";

import {
  COLLECTOR_SOURCES,
  type CollectedBase,
  type CollectedKeyword,
  type CollectedProduct,
  type CollectedSearchResult,
  type NormalizeIssue,
  type Observed,
} from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 시각 → KST 날짜 (YYYY-MM-DD) */
export function kstDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 공통 검사: 출처 · 신뢰도 · 수집 시각 */
function checkBase(c: CollectedBase, issues: NormalizeIssue[]): { capturedOn: string; capturedAt: string } | null {
  if (!(COLLECTOR_SOURCES as readonly string[]).includes(c.source)) issues.push({ field: "source", message: `허용되지 않은 출처 ${c.source}` });
  if (!["A", "B", "C"].includes(c.confidence)) issues.push({ field: "confidence", message: "신뢰도(A/B/C)를 수집기가 명시해야 합니다" });
  const capturedOn = kstDate(c.capturedAt);
  if (!capturedOn) issues.push({ field: "capturedAt", message: `수집 시각 "${c.capturedAt}" 을(를) 읽을 수 없습니다` });
  if (capturedOn && Date.parse(c.capturedAt) > Date.now() + 5 * 60 * 1000) issues.push({ field: "capturedAt", message: "수집 시각이 미래입니다" });
  if (issues.length > 0 || !capturedOn) return null;
  return { capturedOn, capturedAt: new Date(c.capturedAt).toISOString() };
}

/** 관측값 1개 변환. 숫자로 받은 비율은 0~1 소수, 문자열의 % 는 퍼센트 */
function observe(type: ImportType, key: string, value: Observed, issues: NormalizeIssue[]): number | string | null {
  if (value == null || value === "") return null;
  const field = fieldDef(type, key) as FieldDef;
  const r = convertCell(field, typeof value === "number" ? String(value) : value, "DECIMAL");
  if (r.issue) {
    issues.push({ field: key, message: r.issue });
    return null;
  }
  return r.value as number | string | null;
}

function productIdOf(id: string | null | undefined, url: string | null | undefined, issues: NormalizeIssue[], field = "coupangProductId"): string | null {
  // 값을 읽을 수 없으면 사유 하나만 남긴다
  const v = observe("PRODUCT_SNAPSHOTS", "coupang_product_id", id || url || null, []);
  if (!v) issues.push({ field, message: "쿠팡 상품 ID 를 찾을 수 없습니다 (ID 또는 /products/{id} URL 필요)" });
  return (v as string | null) ?? null;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function normalizeProduct(c: CollectedProduct): { record: NormalizedProductSnapshot | null; issues: NormalizeIssue[] } {
  const issues: NormalizeIssue[] = [];
  const base = checkBase(c, issues);
  const coupangProductId = productIdOf(c.coupangProductId, c.productUrl, issues);
  if (!base || !coupangProductId) return { record: null, issues };
  // 페이지 안의 다른 상품 ID 표기와 다르면 어느 상품의 값인지 확정할 수 없다 → 저장하지 않는다
  const others = [...new Set((c.observedProductIds ?? []).filter(Boolean))].filter((id) => id !== coupangProductId);
  if (others.length > 0) {
    issues.push({ field: "coupangProductId", message: `URL 의 상품 ID ${coupangProductId} 와 페이지의 상품 ID ${others.join(", ")} 가 다릅니다 (저장하지 않음)` });
    return { record: null, issues };
  }

  const metrics: Record<string, number | string> = {};
  const put = (key: string, value: Observed) => {
    const v = observe("PRODUCT_SNAPSHOTS", key, value, issues);
    if (v != null) metrics[key] = v;
  };
  if (c.productName) put("product_name_observed", c.productName);
  put("price", c.price);
  put("original_price", c.originalPrice);
  put("discount_rate", c.discountRate);
  put("review_count", c.reviewCount);
  put("rating", c.rating);
  put("delivery_type", c.deliveryType);
  put("seller_type_observed", c.sellerType);
  put("category_rank", c.categoryRank);

  if (c.wing) {
    if (c.source === "WING_SESSION") {
      put("views_28d", c.wing.views28d);
      put("conversion_rate", c.wing.conversionRate);
    } else {
      issues.push({ field: "wing", message: "WING 지표는 출처가 WING_SESSION 일 때만 받습니다 (버림)" });
    }
  }

  const calculated: string[] = [];
  const price = metrics.price as number | undefined;
  const original = metrics.original_price as number | undefined;
  if (metrics.discount_rate == null && price != null && original && price <= original) {
    metrics.discount_rate = round4(1 - price / original);
    calculated.push("discount_rate");
  }
  if (Object.keys(metrics).length === 0) {
    issues.push({ field: "*", message: "저장할 값이 하나도 없습니다" });
    return { record: null, issues };
  }
  return {
    record: { kind: "PRODUCT_SNAPSHOT", source: c.source, confidence: c.confidence, ...base, coupangProductId, metrics, calculated },
    issues,
  };
}

export function normalizeSearch(c: CollectedSearchResult): { records: NormalizedRank[]; issues: NormalizeIssue[] } {
  const issues: NormalizeIssue[] = [];
  const base = checkBase(c, issues);
  const keyword = (c.keyword ?? "").trim().replace(/\s+/g, " ");
  if (!keyword) issues.push({ field: "keyword", message: "키워드가 없습니다" });
  if (!base || !keyword) return { records: [], issues };
  const page = c.page != null && Number.isInteger(c.page) && c.page >= 1 ? c.page : null;
  // 화면 순위 배지(자연 1~10위)와 계산한 순위가 다르면 화면 구조가 바뀐 것 → 이 검색 결과는 저장하지 않는다
  const badgeMismatch = c.items.find((item) => item.rankBadge != null && (item.isAd === true || item.rankBadge !== Number(item.rank)));
  if (badgeMismatch) {
    issues.push({ field: "rank", message: `쿠팡 순위 배지 ${badgeMismatch.rankBadge} 와 계산한 순위 ${badgeMismatch.rank} 가 다릅니다 (화면 구조 변경 가능성, 저장하지 않음)` });
    return { records: [], issues };
  }

  const records: NormalizedRank[] = [];
  c.items.forEach((item, i) => {
    const itemIssues: NormalizeIssue[] = [];
    const coupangProductId = productIdOf(item.coupangProductId, item.productUrl, itemIssues, `items[${i}]`);
    const rank = observe("SEARCH_RANKS", "rank_position", item.rank, itemIssues) as number | null;
    if (rank == null && !itemIssues.some((x) => x.field === "rank_position")) itemIssues.push({ field: `items[${i}].rank`, message: "순위가 없습니다" });
    issues.push(...itemIssues.map((x) => ({ ...x, field: x.field.startsWith("items") ? x.field : `items[${i}].${x.field}` })));
    if (!coupangProductId || rank == null) return;
    records.push({
      kind: "KEYWORD_PRODUCT_RANK",
      source: c.source,
      confidence: c.confidence,
      ...base,
      keyword,
      coupangProductId,
      rankPosition: rank,
      isAd: item.isAd === true,
      page,
    });
  });
  return { records, issues };
}

export function normalizeKeyword(c: CollectedKeyword): { record: NormalizedKeywordSnapshot | null; issues: NormalizeIssue[] } {
  const issues: NormalizeIssue[] = [];
  const base = checkBase(c, issues);
  const keyword = (c.keyword ?? "").trim().replace(/\s+/g, " ");
  if (!keyword) issues.push({ field: "keyword", message: "키워드가 없습니다" });
  if (!base || !keyword) return { record: null, issues };

  const metrics: Record<string, number> = {};
  const put = (key: string, value: Observed) => {
    const v = observe("KEYWORD_METRICS", key, value, issues);
    if (v != null) metrics[key] = v as number;
  };
  put("search_volume", c.searchVolume);
  put("search_volume_previous", c.searchVolumePrevious);
  put("coupang_product_count", c.productCount);
  put("wing_ratio", c.wingRatio);
  put("rocket_ratio", c.rocketRatio);
  put("brand_concentration", c.brandConcentration);
  put("average_price", c.averagePrice);
  put("average_reviews", c.averageReviews);
  put("ad_bid", c.adBid);

  const calculated: string[] = [];
  if (metrics.coupang_product_count != null && metrics.search_volume) {
    metrics.competition_intensity = round4(metrics.coupang_product_count / metrics.search_volume);
    calculated.push("competition_intensity");
  }
  if (metrics.search_volume != null && metrics.search_volume_previous) {
    metrics.search_growth_rate = round4((metrics.search_volume - metrics.search_volume_previous) / metrics.search_volume_previous);
    calculated.push("search_growth_rate");
  }
  if (Object.keys(metrics).length === 0) {
    issues.push({ field: "*", message: "저장할 값이 하나도 없습니다" });
    return { record: null, issues };
  }
  return { record: { kind: "KEYWORD_SNAPSHOT", source: c.source, confidence: c.confidence, ...base, keyword, metrics, calculated }, issues };
}
