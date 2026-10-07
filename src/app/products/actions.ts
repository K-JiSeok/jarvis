"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { resolveCategoryFromForm } from "@/lib/category-form";
import { isCoupangId, parseCoupangInput } from "@/lib/coupang";
import {
  dbErrorMessage,
  fail,
  FormError,
  isPgError,
  readCapturedOn,
  readChoice,
  readNumber,
  readNumbers,
  readText,
  round4,
  todayKst,
  type FormState,
} from "@/lib/forms";
import {
  createProduct,
  findProductByCoupangId,
  saveManualProductSnapshot,
  setProductSnapshotExcluded,
  updateProduct,
  type ProductSnapshotMetrics,
} from "@/lib/repositories/products";
import { deleteManualRank, saveKeywordProductRank } from "@/lib/repositories/ranks";
import { isConfidence } from "@/types/db";
import { DELIVERY_TYPES, LIFECYCLE_STATUSES, SELLER_TYPES } from "@/types/product";

function revalidateProduct(productId: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
}

// 상품 등록 -----------------------------------------------------------------------

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  let productId: string;
  let snapshotNote = "";
  try {
    const ids = readCoupangIds(formData);
    const productName = readText(formData, "product_name", 300);
    if (!productName) return fail("상품명을 입력하세요.");

    const existing = await findProductByCoupangId(ids.productId);
    if (existing) return duplicate(existing.id);

    productId = await createProduct({
      coupangProductId: ids.productId,
      coupangItemId: ids.itemId,
      coupangVendorItemId: ids.vendorItemId,
      productUrl: ids.url,
      productName,
      brand: readText(formData, "brand", 100),
      categoryId: await resolveCategoryFromForm(formData),
      sellerType: readChoice(formData, "seller_type", SELLER_TYPES),
    });

    // 가격·배송 유형을 입력했을 때만 첫 MANUAL 스냅샷을 만든다 (master 에는 넣지 않는다)
    const price = readNumber(formData, "price", { label: "가격", min: 0, integer: true });
    if (typeof price === "string") throw new FormError(price);
    const deliveryType = readChoice(formData, "delivery_type", DELIVERY_TYPES);
    if (price !== null || deliveryType) {
      const confidence = String(formData.get("confidence") ?? "B");
      try {
        await saveManualProductSnapshot({
          productId,
          capturedOn: todayKst(),
          confidence: isConfidence(confidence) ? confidence : "B",
          metrics: {
            ...(price !== null && { price }),
            ...(deliveryType && { delivery_type: deliveryType }),
            product_name_observed: productName,
          },
          calculated: [],
        });
        snapshotNote = " · 첫 지표 저장";
      } catch (error) {
        snapshotNote = ` · 지표 저장 실패(${dbErrorMessage(error)}) — 상세 화면에서 다시 입력하세요`;
      }
    }
  } catch (error) {
    if (isPgError(error, "23505")) {
      const ids = parseCoupangInput(String(formData.get("coupang_product_id") ?? ""));
      const existing = ids ? await findProductByCoupangId(ids.productId).catch(() => null) : null;
      return duplicate(existing?.id ?? null);
    }
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/products");
  return {
    ok: true,
    message: `등록했습니다${snapshotNote}.`,
    link: { href: `/products/${productId}`, label: "상세 보기" },
  };
}

function duplicate(id: string | null): FormState {
  return fail("이미 등록된 상품입니다.", id ? { href: `/products/${id}`, label: "기존 상품으로 이동" } : undefined);
}

/** 화면에서 URL 을 해석해 채운 값을 서버에서 다시 검증한다 */
function readCoupangIds(formData: FormData) {
  const productId = String(formData.get("coupang_product_id") ?? "").trim();
  if (!isCoupangId(productId)) throw new FormError("쿠팡 상품 ID(숫자)를 확인하세요. URL 을 붙여넣으면 자동으로 채워집니다.");

  const itemId = String(formData.get("coupang_item_id") ?? "").trim() || null;
  const vendorItemId = String(formData.get("coupang_vendor_item_id") ?? "").trim() || null;
  if (itemId && !isCoupangId(itemId)) throw new FormError("itemId 는 숫자여야 합니다.");
  if (vendorItemId && !isCoupangId(vendorItemId)) throw new FormError("vendorItemId 는 숫자여야 합니다.");

  const rawUrl = String(formData.get("product_url") ?? "").trim();
  let url: string | null = null;
  if (rawUrl) {
    const parsed = parseCoupangInput(rawUrl);
    if (!parsed?.url) throw new FormError("쿠팡 상품 URL 형식이 아닙니다.");
    if (parsed.productId !== productId) throw new FormError("URL 의 상품 ID 와 입력한 상품 ID 가 다릅니다.");
    url = parsed.url;
  }
  return { productId, itemId, vendorItemId, url };
}

// 기본 정보 수정 · 상태 -----------------------------------------------------------

export async function updateProductAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  try {
    const productName = readText(formData, "product_name", 300);
    if (!productName) return fail("상품명을 입력하세요.");

    const ids = readCoupangIds(formData);
    const optionCount = readNumber(formData, "option_count", { label: "옵션 수", min: 0, max: 32767, integer: true });
    if (typeof optionCount === "string") return fail(optionCount);
    const pb = String(formData.get("is_coupang_pb") ?? "");
    const lifecycle = readChoice(formData, "lifecycle_status", LIFECYCLE_STATUSES);
    if (!lifecycle) return fail("상태를 선택하세요.");

    await updateProduct(productId, {
      productName,
      brand: readText(formData, "brand", 100),
      categoryId: await resolveCategoryFromForm(formData),
      productUrl: ids.url,
      coupangItemId: ids.itemId,
      coupangVendorItemId: ids.vendorItemId,
      sellerType: readChoice(formData, "seller_type", SELLER_TYPES),
      optionCount,
      isCoupangPb: pb === "true" ? true : pb === "false" ? false : null,
      isOwnProduct: formData.get("is_own_product") === "on",
      lifecycleStatus: lifecycle,
    });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidateProduct(productId);
  return { ok: true, message: "저장했습니다." };
}

// 지표 수동 입력 -------------------------------------------------------------------

export async function saveProductSnapshotAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const capturedOn = readCapturedOn(formData);
  if (typeof capturedOn !== "string") return fail(capturedOn.error);
  const confidence = String(formData.get("confidence") ?? "");
  if (!isConfidence(confidence)) return fail("신뢰도를 선택하세요.");

  const { values, errors } = readNumbers(formData, {
    price: { label: "판매가", min: 0, integer: true },
    original_price: { label: "정가", min: 0, integer: true },
    discount_rate: { label: "할인율", min: 0, max: 100, percent: true },
    review_count: { label: "리뷰 수", min: 0, integer: true },
    rating: { label: "평점", min: 0, max: 5 },
    category_rank: { label: "카테고리 순위", min: 1, integer: true },
    option_count: { label: "옵션 수", min: 0, max: 32767, integer: true },
    views_28d: { label: "28일 조회수", min: 0, integer: true },
    sales_period_days: { label: "판매 집계 기간", min: 1, max: 365, integer: true },
    sales_actual: { label: "실제 판매량", min: 0, integer: true },
    sales_estimated: { label: "추정 판매량", min: 0, integer: true },
    revenue_actual: { label: "실제 매출", min: 0, integer: true },
    revenue_estimated: { label: "추정 매출", min: 0, integer: true },
    conversion_rate: { label: "전환율", min: 0, max: 100, percent: true },
  });
  if (errors.length > 0) return fail(errors.join(" "));

  const metrics: ProductSnapshotMetrics = { ...values };
  const deliveryType = readChoice(formData, "delivery_type", DELIVERY_TYPES);
  const sellerType = readChoice(formData, "seller_type_observed", SELLER_TYPES);
  if (deliveryType) metrics.delivery_type = deliveryType;
  if (sellerType) metrics.seller_type_observed = sellerType;
  try {
    const name = readText(formData, "product_name_observed", 300);
    if (name) metrics.product_name_observed = name;
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  // 판매량·매출이 하나도 없으면 집계 기간만 따로 저장하지 않는다
  const hasPeriodValue = ["sales_actual", "sales_estimated", "revenue_actual", "revenue_estimated"].some((k) => k in metrics);
  if (!hasPeriodValue) delete metrics.sales_period_days;
  else if (metrics.sales_period_days === undefined) return fail("판매량·매출의 집계 기간(일)을 입력하세요.");

  const calculated: string[] = [];
  // 할인율을 비워 두고 판매가·정가가 있으면 계산 (CALCULATED)
  if (metrics.discount_rate === undefined && metrics.price !== undefined && metrics.original_price) {
    if (metrics.price > metrics.original_price) return fail("판매가가 정가보다 큽니다.");
    metrics.discount_rate = round4(1 - metrics.price / metrics.original_price);
    calculated.push("discount_rate");
  }

  if (Object.keys(metrics).length === 0) return fail("지표를 하나 이상 입력하세요.");

  let action;
  try {
    action = await saveManualProductSnapshot({ productId, capturedOn, confidence, metrics, calculated });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidateProduct(productId);
  const label = { INSERTED: "새로 저장했습니다", UPDATED: "같은 날짜의 직접 입력 값을 갱신했습니다", SKIPPED: "바뀐 값이 없습니다" }[action];
  return { ok: true, message: `${capturedOn} · ${label}.` };
}

export async function setProductSnapshotExcludedAction(
  productId: string,
  snapshotId: number,
  excluded: boolean,
  formData: FormData,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  const reason = String(formData.get("reason") ?? "").trim() || "직접 제외";
  await setProductSnapshotExcluded(snapshotId, excluded, excluded ? reason : null);
  revalidateProduct(productId);
}

// 키워드 순위 ---------------------------------------------------------------------

export async function saveRankAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const keywordId = String(formData.get("keyword_id") ?? "");
  if (!keywordId) return fail("키워드를 선택하세요.");
  const capturedOn = readCapturedOn(formData);
  if (typeof capturedOn !== "string") return fail(capturedOn.error);
  const confidence = String(formData.get("confidence") ?? "");
  if (!isConfidence(confidence)) return fail("신뢰도를 선택하세요.");

  const rank = readNumber(formData, "rank_position", { label: "순위", min: 1, max: 100000, integer: true });
  const page = readNumber(formData, "page", { label: "페이지", min: 1, max: 1000, integer: true });
  if (typeof rank === "string") return fail(rank);
  if (rank === null) return fail("순위를 입력하세요.");
  if (typeof page === "string") return fail(page);

  try {
    await saveKeywordProductRank({
      keywordId,
      productId,
      capturedOn,
      confidence,
      rank,
      isAd: formData.get("is_ad") === "on",
      page,
    });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidateProduct(productId);
  revalidatePath(`/keywords/${keywordId}`);
  return { ok: true, message: `${capturedOn} · ${rank}위 저장 (같은 날짜·광고 여부면 갱신).` };
}

export async function deleteRankAction(productId: string, keywordId: string, rankId: number): Promise<void> {
  if (!(await getCurrentUser())) return;
  await deleteManualRank(rankId);
  revalidateProduct(productId);
  revalidatePath(`/keywords/${keywordId}`);
}
