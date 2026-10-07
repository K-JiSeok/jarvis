import "server-only";

import { FormError } from "@/lib/forms";
import { findOrCreateCategory } from "@/lib/repositories/keywords";

export const NEW_CATEGORY = "__new__";

/** CategoryField 의 값 → category_id (새 카테고리면 MANUAL 로 생성). 미지정이면 null */
export async function resolveCategoryFromForm(formData: FormData): Promise<string | null> {
  const selected = String(formData.get("category_id") ?? "");
  if (selected === NEW_CATEGORY) {
    const name = String(formData.get("new_category") ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new FormError("새 카테고리 이름을 입력하세요.");
    return findOrCreateCategory(name);
  }
  return selected || null;
}
