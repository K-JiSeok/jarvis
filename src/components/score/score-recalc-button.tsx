"use client";

import { useActionState } from "react";

import { recalculateScoreAction } from "@/app/products/score-actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/forms";

/** 점수 다시 계산 (선택한 키워드 맥락으로) */
export function ScoreRecalcButton({ productId, keywordId }: { productId: string; keywordId: string | null }) {
  const [state, action, pending] = useActionState(recalculateScoreAction.bind(null, productId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="keyword_id" value={keywordId ?? ""} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "계산 중…" : "점수 다시 계산"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
