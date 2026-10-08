"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { dbErrorMessage, fail, type FormState } from "@/lib/forms";
import { recalculateScore } from "@/lib/repositories/opportunity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 점수 다시 계산. 9개 요소가 모두 있을 때만 새 현재 점수로 저장한다 */
export async function recalculateScoreAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const raw = String(formData.get("keyword_id") ?? "");
  const keywordId = UUID.test(raw) ? raw : null;
  try {
    const outcome = await recalculateScore(productId, keywordId);
    if (!outcome) return fail("상품을 찾을 수 없습니다.");
    revalidatePath(`/products/${productId}`);
    revalidatePath("/products");
    if (!outcome.saved) {
      const n = outcome.result.missingFactors.length;
      return {
        ok: false,
        message: `분석 데이터 부족 — ${n}개 항목을 계산할 수 없어 점수를 저장하지 않았습니다. 이전 점수는 그대로입니다.`,
      };
    }
    return { ok: true, message: `${outcome.result.total}점으로 저장했습니다.` };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}
