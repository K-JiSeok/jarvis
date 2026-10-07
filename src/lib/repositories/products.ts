import "server-only";

import { toCategoryOption } from "@/lib/mappers/keyword";
import { toProductDetail, toProductSnapshotView, toProductSummary } from "@/lib/mappers/product";
import { createClient } from "@/lib/supabase/server";
import type { Confidence } from "@/types/common";
import type { Json, ProductLatestRow, TablesUpdate } from "@/types/db";
import type { CategoryOption } from "@/types/keyword";
import type { LifecycleStatus, ProductDetail, ProductSummary, SellerType } from "@/types/product";

import { latestKeywordRanks, listRanksForProduct } from "./ranks";

/*
 * 상품 repository. 로그인 사용자 세션(RLS)으로만 접근한다.
 * products = 현재 상태(master), product_snapshots = 관측 시점 데이터.
 * 스냅샷 저장·제외는 반드시 upsert_product_snapshot() 을 거친다.
 * 상품 행은 삭제하지 않는다 (lifecycle_status 로 관리).
 */

async function categoryMap(): Promise<Map<string, CategoryOption>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("id, name, path");
  if (error) throw error;
  return new Map(data.map((c) => [c.id, toCategoryOption(c)]));
}

/** 상품 목록. 기본은 DELETED 제외, status 를 주면 그 상태만 */
export async function listProducts({ status }: { status?: LifecycleStatus | "ALL" } = {}): Promise<ProductSummary[]> {
  const supabase = await createClient();
  let query = supabase.from("v_product_latest").select("*").order("last_seen_at", { ascending: false });
  if (status && status !== "ALL") query = query.eq("lifecycle_status", status);
  else if (!status) query = query.neq("lifecycle_status", "DELETED");

  const [{ data, error }, categories] = await Promise.all([query, categoryMap()]);
  if (error) throw error;

  const ranks = await latestKeywordRanks(data.map((r) => r.product_id!).filter(Boolean));
  return data.map((row) => toProductSummary(row, categories, ranks.get(row.product_id!) ?? null));
}

/** 상품 상세. 본인 상품이 아니면 null */
export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  const supabase = await createClient();
  const [latest, master, snapshots, categories, ranks] = await Promise.all([
    supabase.from("v_product_latest").select("*").eq("product_id", productId).maybeSingle(),
    supabase.from("products").select("*").eq("id", productId).maybeSingle(),
    supabase
      .from("product_snapshots")
      .select("*")
      .eq("product_id", productId)
      .order("captured_on", { ascending: false })
      .order("captured_at", { ascending: false }),
    categoryMap(),
    listRanksForProduct(productId),
  ]);
  if (latest.error) throw latest.error;
  if (master.error) throw master.error;
  if (snapshots.error) throw snapshots.error;
  if (!latest.data || !master.data) return null;

  const summary = toProductSummary(latest.data as ProductLatestRow, categories, null);
  return toProductDetail({ ...summary, topKeywordRank: null }, master.data, snapshots.data, ranks);
}

/** 쿠팡 상품 ID 로 본인 상품 찾기 (중복 등록 방지) */
export async function findProductByCoupangId(coupangProductId: string): Promise<{ id: string; productName: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, product_name")
    .eq("coupang_product_id", coupangProductId)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, productName: data.product_name } : null;
}

/** 상품 선택 목록 (순위 입력 등) */
export async function listProductOptions(): Promise<{ id: string; productName: string; coupangProductId: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, product_name, coupang_product_id")
    .neq("lifecycle_status", "DELETED")
    .order("product_name");
  if (error) throw error;
  return data.map((p) => ({ id: p.id, productName: p.product_name, coupangProductId: p.coupang_product_id }));
}

export interface ProductMasterInput {
  productName: string;
  brand: string | null;
  categoryId: string | null;
  productUrl: string | null;
  coupangItemId: string | null;
  coupangVendorItemId: string | null;
  sellerType: SellerType | null;
}

export async function createProduct(input: ProductMasterInput & { coupangProductId: string }): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      coupang_product_id: input.coupangProductId,
      product_name: input.productName,
      brand: input.brand,
      category_id: input.categoryId,
      product_url: input.productUrl,
      coupang_item_id: input.coupangItemId,
      coupang_vendor_item_id: input.coupangVendorItemId,
      seller_type: input.sellerType,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** master 컬럼만 수정한다. 쿠팡 상품 ID(식별자)는 바꾸지 않는다 */
export async function updateProduct(
  productId: string,
  patch: Partial<ProductMasterInput> & {
    optionCount?: number | null;
    isCoupangPb?: boolean | null;
    isOwnProduct?: boolean;
    lifecycleStatus?: LifecycleStatus;
    lastSeenAt?: string;
  },
): Promise<void> {
  const update: TablesUpdate<"products"> = {};
  if (patch.productName !== undefined) update.product_name = patch.productName;
  if (patch.brand !== undefined) update.brand = patch.brand;
  if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
  if (patch.productUrl !== undefined) update.product_url = patch.productUrl;
  if (patch.coupangItemId !== undefined) update.coupang_item_id = patch.coupangItemId;
  if (patch.coupangVendorItemId !== undefined) update.coupang_vendor_item_id = patch.coupangVendorItemId;
  if (patch.sellerType !== undefined) update.seller_type = patch.sellerType;
  if (patch.optionCount !== undefined) update.option_count = patch.optionCount;
  if (patch.isCoupangPb !== undefined) update.is_coupang_pb = patch.isCoupangPb;
  if (patch.isOwnProduct !== undefined) update.is_own_product = patch.isOwnProduct;
  if (patch.lastSeenAt !== undefined) update.last_seen_at = patch.lastSeenAt;
  if (patch.lifecycleStatus !== undefined) {
    update.lifecycle_status = patch.lifecycleStatus;
    // 삭제·판매 종료를 처음 확인한 시각만 남기고, 다시 판매되면 비운다
    if (patch.lifecycleStatus !== "DELETED") update.deleted_detected_at = null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").update(update).eq("id", productId).select("id, deleted_detected_at");
  if (error) throw error;
  if (data.length === 0) throw new Error("상품을 찾을 수 없습니다.");

  if (patch.lifecycleStatus === "DELETED" && !data[0].deleted_detected_at) {
    const { error: e2 } = await supabase
      .from("products")
      .update({ deleted_detected_at: new Date().toISOString() })
      .eq("id", productId);
    if (e2) throw e2;
  }
}

export type ProductSnapshotMetrics = Partial<{
  product_name_observed: string;
  price: number;
  original_price: number;
  discount_rate: number;
  delivery_type: string;
  seller_type_observed: string;
  review_count: number;
  rating: number;
  category_rank: number;
  option_count: number;
  views_28d: number;
  sales_period_days: number;
  sales_actual: number;
  sales_estimated: number;
  revenue_actual: number;
  revenue_estimated: number;
  conversion_rate: number;
}>;

export type SnapshotAction = "INSERTED" | "UPDATED" | "SKIPPED";

/**
 * 수동 입력 스냅샷 (MANUAL). 같은 날짜의 MANUAL 행이 있으면 UPSERT (빈 항목은 기존 값 유지).
 * 수집일이 기존 last_seen_at 보다 최신이면 products.last_seen_at 을 갱신한다 (과거로 되돌리지 않음).
 */
export async function saveManualProductSnapshot(input: {
  productId: string;
  capturedOn: string;
  confidence: Confidence;
  metrics: ProductSnapshotMetrics;
  calculated: string[];
}): Promise<SnapshotAction> {
  const capturedAt = new Date().toISOString();
  const payload: Record<string, Json> = {
    product_id: input.productId,
    captured_on: input.capturedOn,
    captured_at: capturedAt,
    source_type: "MANUAL",
    confidence: input.confidence,
    ...input.metrics,
  };
  if (input.calculated.length > 0) {
    payload.metric_meta = Object.fromEntries(
      input.calculated.map((field) => [field, { source: "CALCULATED", confidence: input.confidence }]),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_product_snapshot", { p: payload });
  if (error) throw error;
  assertOwnSnapshot(data, "상품");

  // last_seen_at: 오늘 수집이면 지금 시각, 과거 날짜면 그 날짜(KST 00:00). 더 최신일 때만 갱신
  const seenAt = input.capturedOn === kstToday() ? capturedAt : new Date(`${input.capturedOn}T00:00:00+09:00`).toISOString();
  const { data: product, error: e2 } = await supabase.from("products").select("last_seen_at").eq("id", input.productId).single();
  if (e2) throw e2;
  if (new Date(seenAt) > new Date(product.last_seen_at)) {
    await updateProduct(input.productId, { lastSeenAt: seenAt });
  }

  return (data as { action: SnapshotAction }).action;
}

/** 스냅샷 제외 / 복원. 물리 삭제하지 않는다 */
export async function setProductSnapshotExcluded(snapshotId: number, excluded: boolean, reason: string | null): Promise<void> {
  const supabase = await createClient();
  const { data: row, error: findError } = await supabase.from("product_snapshots").select("*").eq("id", snapshotId).maybeSingle();
  if (findError) throw findError;
  if (!row) throw new Error("스냅샷을 찾을 수 없습니다.");

  const view = toProductSnapshotView(row);
  const { data, error } = await supabase.rpc("upsert_product_snapshot", {
    p: {
      product_id: row.product_id,
      captured_on: view.capturedOn,
      captured_at: view.capturedAt,
      source_type: view.source,
      confidence: view.confidence,
      is_excluded: excluded,
      excluded_reason: excluded ? reason : null,
    },
  });
  if (error) throw error;
  assertOwnSnapshot(data, "상품");
}

export function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * upsert_*_snapshot() 은 대상 행이 다른 사용자 것이라 RLS 로 보이지 않을 때 오류 대신
 * 빈 행으로 SKIPPED 를 돌려준다 (ON CONFLICT DO NOTHING 이 FK 검사보다 먼저 걸림, 데이터는 바뀌지 않음).
 * 앱에서는 이를 "찾을 수 없음" 오류로 처리한다. (DB 함수 수정은 별도 결정 사항)
 */
function assertOwnSnapshot(data: unknown, label: string): void {
  const row = (data as { row?: { id?: unknown } | null } | null)?.row;
  if (!row || row.id == null) throw new Error(`${label}을 찾을 수 없습니다 (본인 데이터가 아님).`);
}
