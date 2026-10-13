"use client";

import { useActionState } from "react";

import { promoteTopCandidatesAction } from "@/app/discover/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";

export function PromoteTopForm() {
  const [state, action, pending] = useActionState(promoteTopCandidatesAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-testid="promote-top">
      <span>검색량 상위</span>
      <NativeSelect name="n" defaultValue="10" aria-label="개수" className="h-8 w-20">
        <option>5</option>
        <option>10</option>
        <option>20</option>
      </NativeSelect>
      <span>개를 추적 키워드로</span>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "등록 중…" : "등록"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
