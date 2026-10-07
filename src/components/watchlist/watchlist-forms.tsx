"use client";

import { useActionState } from "react";
import { Star } from "lucide-react";

import { addToWatchlistAction, updateWatchlistMemoAction } from "@/app/watchlist/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";

/** 관심상품 등록 (해제했던 상품이면 같은 행을 다시 "관찰"로) */
export function WatchlistAddForm({
  productId,
  keywords,
  restoring,
}: {
  productId: string;
  keywords: { id: string; keyword: string }[];
  restoring: boolean;
}) {
  const [state, action, pending] = useActionState(addToWatchlistAction.bind(null, productId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {!restoring && keywords.length > 0 && (
        <NativeSelect name="keyword_id" defaultValue="" aria-label="발견 키워드" className="w-48">
          <option value="">발견 키워드 (선택)</option>
          {keywords.map((k) => (
            <option key={k.id} value={k.id}>
              {k.keyword}
            </option>
          ))}
        </NativeSelect>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        <Star />
        {restoring ? "다시 관심상품으로" : "관심상품 등록"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/** 관리 메모 (watchlist.memo). 상태 변경 이력과는 별개 */
export function WatchlistMemoForm({ watchlistId, productId, memo }: { watchlistId: string; productId: string; memo: string | null }) {
  const [state, action, pending] = useActionState(updateWatchlistMemoAction.bind(null, watchlistId, productId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="memo" defaultValue={memo ?? ""} maxLength={1000} placeholder="메모" aria-label="관심상품 메모" className="h-8 min-w-48 flex-1 text-xs" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        저장
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
