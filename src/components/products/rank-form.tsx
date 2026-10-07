"use client";

import { useActionState } from "react";

import { saveRankAction } from "@/app/products/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS } from "@/types/common";

/** 이 상품이 특정 키워드 검색에서 몇 위였는지 기록 (출처 = 직접 입력) */
export function RankForm({
  productId,
  keywords,
  today,
}: {
  productId: string;
  keywords: { id: string; keyword: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState(saveRankAction.bind(null, productId), INITIAL_FORM_STATE);

  if (keywords.length === 0) {
    return <p className="text-muted-foreground text-sm">먼저 키워드 발굴 화면에서 키워드를 등록하세요.</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="rank-keyword">키워드</Label>
          <NativeSelect id="rank-keyword" name="keyword_id" required defaultValue="">
            <option value="" disabled>
              선택
            </option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>
                {k.keyword}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rank-position">순위</Label>
          <Input id="rank-position" name="rank_position" type="number" min={1} step={1} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rank-page">페이지</Label>
          <Input id="rank-page" name="page" type="number" min={1} step={1} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rank-date">수집일</Label>
          <Input id="rank-date" name="captured_on" type="date" defaultValue={today} max={today} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rank-confidence">신뢰도</Label>
          <NativeSelect id="rank-confidence" name="confidence" defaultValue="A">
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {c} · {CONFIDENCE_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_ad" className="size-4" />
          광고 노출
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "저장 중…" : "순위 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
      <p className="text-muted-foreground text-xs">같은 키워드·수집일·광고 여부로 다시 저장하면 순위가 갱신됩니다.</p>
    </form>
  );
}
