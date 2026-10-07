"use client";

import { useActionState } from "react";

import { createCategoryAction, updateCategoryFeeAction } from "@/app/profit/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";

const pct = (v: number | null) => (v == null ? "" : String(Math.round(v * 1000000) / 10000));

/** 카테고리 기본 수수료율 수정. 비우면 모름(null) */
export function CategoryFeeForm({ categoryId, feeRate, name }: { categoryId: string; feeRate: number | null; name: string }) {
  const [state, action, pending] = useActionState(updateCategoryFeeAction.bind(null, categoryId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input
        name="fee_rate"
        type="number"
        min={0}
        max={100}
        step="any"
        defaultValue={pct(feeRate)}
        placeholder="모름"
        aria-label={`${name} 수수료율 (%)`}
        className="h-8 w-24"
      />
      <span className="text-muted-foreground text-xs">%</span>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function CategoryCreateForm() {
  const [state, action, pending] = useActionState(createCategoryAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="cat-name" className="block">카테고리 이름</Label>
        <Input id="cat-name" name="name" required maxLength={100} className="w-56" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cat-fee" className="block">수수료율 (%)</Label>
        <Input id="cat-fee" name="fee_rate" type="number" min={0} max={100} step="any" placeholder="모름" className="w-28" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "추가 중…" : "카테고리 추가"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
