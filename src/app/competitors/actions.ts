"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { parseCoupangInput } from "@/lib/coupang";
import { dbErrorMessage, fail, readChoice, readText, type FormState } from "@/lib/forms";
import {
  createCompetitor,
  releaseCompetitor,
  updateCompetitor,
  type CreateResult,
} from "@/lib/repositories/competitors";
import { createProduct, findProductByCoupangId } from "@/lib/repositories/products";
import { RELATION_TYPES } from "@/types/competitor";

function revalidateCompetitors(...productIds: string[]) {
  revalidatePath("/competitors");
  for (const id of productIds) revalidatePath(`/products/${id}`);
}

const RESULT_MESSAGE: Record<CreateResult, string> = {
  ADDED: "경쟁상품으로 등록했습니다.",
  RESTORED: "해제했던 경쟁상품을 다시 활성화했습니다 (등록 이력 유지).",
  ALREADY: "이미 등록된 경쟁상품입니다.",
};

/** 후보 목록에서 등록 (이미 products 에 있는 상품) */
export async function addCandidateAction(
  productId: string,
  competitorProductId: string,
  keywordId: string,
  formData: FormData,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  const relationType = readChoice(formData, "relation_type", RELATION_TYPES) ?? "SIMILAR";
  await createCompetitor({ productId, competitorProductId, relationType, keywordId, memo: null });
  revalidateCompetitors(productId, competitorProductId);
}

/**
 * 쿠팡 URL / 상품 ID 로 직접 등록. 아직 products 에 없는 상품이면
 * 기존 상품 등록과 같은 방식으로 master 를 먼저 만든 뒤 관계를 만든다 (상품명 필요).
 */
export async function addCompetitorByInputAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const ids = parseCoupangInput(String(formData.get("coupang_input") ?? ""));
  if (!ids) return fail("쿠팡 상품 URL 또는 숫자 상품 ID 를 입력하세요.");
  const relationType = readChoice(formData, "relation_type", RELATION_TYPES);
  if (!relationType) return fail("관계 유형을 선택하세요.");
  const keywordId = String(formData.get("keyword_id") ?? "") || null;

  let competitorId: string;
  let created = false;
  let result: CreateResult;
  try {
    const memo = readText(formData, "memo", 500);
    const existing = await findProductByCoupangId(ids.productId);
    if (existing) {
      competitorId = existing.id;
    } else {
      const productName = readText(formData, "product_name", 300);
      if (!productName) {
        return fail("아직 등록되지 않은 상품입니다. 상품명을 함께 입력하면 상품으로 등록한 뒤 경쟁상품으로 연결합니다.");
      }
      competitorId = await createProduct({
        coupangProductId: ids.productId,
        coupangItemId: ids.itemId,
        coupangVendorItemId: ids.vendorItemId,
        productUrl: ids.url,
        productName,
        brand: null,
        categoryId: null,
        sellerType: null,
      });
      created = true;
    }
    if (competitorId === productId) return fail("자기 자신을 경쟁상품으로 등록할 수 없습니다.");
    result = await createCompetitor({ productId, competitorProductId: competitorId, relationType, keywordId, memo });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidateCompetitors(productId, competitorId);
  revalidatePath("/products");
  return {
    ok: result !== "ALREADY",
    message: (created ? "상품을 새로 등록했습니다. " : "") + RESULT_MESSAGE[result],
    link: { href: `/products/${competitorId}`, label: created ? "경쟁상품 지표 입력하기" : "경쟁상품 보기" },
  };
}

/** 관계 유형 · 메모 수정 */
export async function updateCompetitorAction(
  id: string,
  productId: string,
  competitorProductId: string,
  formData: FormData,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  const relationType = readChoice(formData, "relation_type", RELATION_TYPES);
  const memo = String(formData.get("memo") ?? "").trim();
  await updateCompetitor(id, { ...(relationType && { relationType }), memo: memo || null });
  revalidateCompetitors(productId, competitorProductId);
}

/** 해제 (is_active false, 행 보존) */
export async function releaseCompetitorAction(id: string, productId: string, competitorProductId: string): Promise<void> {
  if (!(await getCurrentUser())) return;
  await releaseCompetitor(id);
  revalidateCompetitors(productId, competitorProductId);
}

/** 해제했던 관계 다시 활성화 (같은 행) */
export async function restoreCompetitorAction(
  productId: string,
  competitorProductId: string,
  relationType: string,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  await createCompetitor({
    productId,
    competitorProductId,
    relationType: (RELATION_TYPES as readonly string[]).includes(relationType) ? (relationType as (typeof RELATION_TYPES)[number]) : "SIMILAR",
    keywordId: null,
    memo: null,
  });
  revalidateCompetitors(productId, competitorProductId);
}
