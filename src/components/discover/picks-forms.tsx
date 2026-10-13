"use client";

import { useActionState } from "react";

import { respondPickAction } from "@/app/discover/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/forms";

export function PickButtons({ pickId }: { pickId: string }) {
  const [state, action, pending] = useActionState(respondPickAction.bind(null, pickId, null), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" name="op" value="SHORTLIST" size="sm" disabled={pending}>
        후보로 선택
      </Button>
      <Button type="submit" name="op" value="DISMISS" size="sm" variant="outline" disabled={pending}>
        관심 없음
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
