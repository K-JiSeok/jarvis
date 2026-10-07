"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";

import { addCompetitorByInputAction } from "@/app/competitors/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { parseCoupangInput } from "@/lib/coupang";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS, RELATION_TYPES } from "@/types/competitor";

/**
 * 쿠팡 URL / 상품 ID 로 경쟁상품 직접 등록.
 * 이미 등록된 상품이면 관계만 만들고, 처음 보는 상품이면 상품명을 받아 상품으로 먼저 등록한다.
 */
export function CompetitorAddForm({
  productId,
  keywords,
}: {
  productId: string;
  keywords: { id: string; keyword: string }[];
}) {
  const [state, action, pending] = useActionState(addCompetitorByInputAction.bind(null, productId), INITIAL_FORM_STATE);
  const [raw, setRaw] = useState("");
  const parsed = raw.trim() ? parseCoupangInput(raw) : null;

  return (
    <form action={action} onReset={() => setRaw("")} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="cmp-input">쿠팡 상품 URL 또는 상품 ID</Label>
          <Input
            id="cmp-input"
            name="coupang_input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="https://www.coupang.com/vp/products/… 또는 숫자 ID"
            autoComplete="off"
            required
          />
          <p className={raw.trim() && !parsed ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
            {raw.trim() ? (parsed ? `상품 ID ${parsed.productId}` : "쿠팡 상품 URL 형식이 아닙니다.") : "이미 등록된 상품이면 바로 연결됩니다."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-relation">관계 유형</Label>
          <NativeSelect id="cmp-relation" name="relation_type" defaultValue="SIMILAR">
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t} title={RELATION_TYPE_HINTS[t]}>
                {RELATION_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-keyword">맥락 키워드</Label>
          <NativeSelect id="cmp-keyword" name="keyword_id" defaultValue="">
            <option value="">선택 안 함</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>
                {k.keyword}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cmp-name">상품명 (처음 보는 상품일 때만)</Label>
          <Input id="cmp-name" name="product_name" maxLength={300} placeholder="새 상품으로 등록할 때 필요" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-memo">메모</Label>
          <Input id="cmp-memo" name="memo" maxLength={500} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          <Plus />
          {pending ? "등록 중…" : "경쟁상품 등록"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
