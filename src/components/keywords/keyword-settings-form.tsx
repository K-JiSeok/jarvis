"use client";

import { useActionState } from "react";

import { updateKeywordAction } from "@/app/keywords/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import type { CategoryOption, KeywordSummary } from "@/types/keyword";

import { CategoryField } from "@/components/common/category-field";

/** 추적 여부 · 카테고리 · 메모. 키워드 문자열 자체는 바꾸지 않는다 (중복 판정 키) */
export function KeywordSettingsForm({
  keyword,
  categories,
}: {
  keyword: KeywordSummary;
  categories: CategoryOption[];
}) {
  const [state, action, pending] = useActionState(updateKeywordAction.bind(null, keyword.id), INITIAL_FORM_STATE);

  return (
    <form action={action} className="space-y-4">
      <CategoryField categories={categories} defaultValue={keyword.category?.id ?? ""} idPrefix="edit" />
      <div className="space-y-1.5">
        <Label htmlFor="edit-memo">메모</Label>
        <Input id="edit-memo" name="memo" defaultValue={keyword.memo ?? ""} maxLength={500} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_tracking" defaultChecked={keyword.isTracking} className="size-4" />
        정기 추적 (끄면 목록에서 &quot;중지&quot;로 표시, 데이터는 유지)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "저장 중…" : "설정 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
