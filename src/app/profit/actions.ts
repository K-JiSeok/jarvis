"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { dbErrorMessage, fail, readNumber, readText, type FormState } from "@/lib/forms";
import { parseScenarioForm } from "@/lib/profit/form";
import { REQUIRED_LABELS } from "@/lib/profit/inputs";
import {
  createCategoryWithFee,
  deleteProfitScenario,
  saveProfitScenario,
  setPrimaryScenario,
  updateCategoryFeeRate,
} from "@/lib/repositories/profit";

function revalidateProfit(productId?: string) {
  revalidatePath("/profit");
  if (productId) revalidatePath(`/products/${productId}`);
}

// 시나리오 -----------------------------------------------------------------------

export async function saveScenarioAction(
  productId: string,
  scenarioId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const { input, errors } = parseScenarioForm(formData);
  if (errors.length > 0) return fail(errors.join(" "));

  try {
    const saved = await saveProfitScenario({
      productId,
      scenarioId,
      input,
      makePrimary: formData.get("is_primary") === "on",
    });
    revalidateProfit(productId);
    if (!saved.calculated) {
      const reason =
        saved.result.errors.join(" ") || `${saved.result.missingRequired.map((k) => REQUIRED_LABELS[k]).join("·")} 미입력`;
      return { ok: true, message: `시나리오를 저장했습니다. 계산 결과는 만들지 않았습니다 (${reason}).` };
    }
    return { ok: true, message: scenarioId ? "수정하고 다시 계산했습니다." : "시나리오를 저장했습니다." };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

export async function setPrimaryScenarioAction(productId: string, scenarioId: string): Promise<void> {
  if (!(await getCurrentUser())) return;
  await setPrimaryScenario(productId, scenarioId);
  revalidateProfit(productId);
}

// useActionState 가 넘기는 이전 상태는 쓰지 않는다
export async function deleteScenarioAction(productId: string, scenarioId: string): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    await deleteProfitScenario(productId, scenarioId);
    revalidateProfit(productId);
    return { ok: true, message: "시나리오를 삭제했습니다." };
  } catch (error) {
    // my_listings 가 판매 결정 기준으로 참조 중이면 FK 가 막는다
    return fail(dbErrorMessage(error));
  }
}

// 카테고리 수수료율 -----------------------------------------------------------------

const FEE_RULE = { label: "수수료율", min: 0, max: 100, percent: true } as const;

export async function updateCategoryFeeAction(categoryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const fee = readNumber(formData, "fee_rate", FEE_RULE);
  if (typeof fee === "string") return fail(fee);
  try {
    await updateCategoryFeeRate(categoryId, fee);
    revalidatePath("/categories");
    revalidatePath("/profit");
    revalidatePath("/products", "layout");
    return { ok: true, message: fee == null ? "비웠습니다 (모름)." : "저장했습니다." };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  try {
    const name = readText(formData, "name", 100);
    if (!name) return fail("카테고리 이름을 입력하세요.");
    const fee = readNumber(formData, "fee_rate", FEE_RULE);
    if (typeof fee === "string") return fail(fee);
    await createCategoryWithFee(name, fee);
    revalidatePath("/categories");
    return { ok: true, message: `"${name}" 카테고리를 추가했습니다.` };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}
