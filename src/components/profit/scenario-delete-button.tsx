"use client";

import { useActionState } from "react";

import { deleteScenarioAction } from "@/app/profit/actions";
import { INITIAL_FORM_STATE } from "@/lib/forms";

export function ScenarioDeleteButton({ productId, scenarioId, name }: { productId: string; scenarioId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteScenarioAction.bind(null, productId, scenarioId), INITIAL_FORM_STATE);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`"${name}" 시나리오와 계산 이력을 삭제할까요?`)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" disabled={pending} className="text-destructive text-xs font-medium hover:underline">
        삭제
      </button>
      {!state.ok && state.message && <span className="text-destructive ml-1 text-xs">{state.message}</span>}
    </form>
  );
}
