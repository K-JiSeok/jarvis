"use client";

import { useActionState } from "react";

import { setSupplyStatusAction } from "@/app/discover/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/forms";

const NEXT: Record<string, [string, string][]> = {
  CANDIDATE: [["SELECTED", "선택"], ["REJECTED", "제외"]],
  SELECTED: [["CANDIDATE", "선택 취소"], ["REJECTED", "제외"]],
  REJECTED: [["CANDIDATE", "되돌리기"]],
};

/** 공급 후보 선택 · 제외 (사용자 판단 — 자동 실행이 바꾸지 않는다) */
export function SupplyStatusForm({ linkId, status }: { linkId: string; status: string }) {
  const [state, action, pending] = useActionState(setSupplyStatusAction.bind(null, linkId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      {NEXT[status]?.map(([v, label]) => (
        <Button key={v} type="submit" name="status" value={v} size="sm" variant={v === "SELECTED" ? "outline" : "ghost"} disabled={pending}>
          {label}
        </Button>
      ))}
      <FormMessage state={state} />
    </form>
  );
}
