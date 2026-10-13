"use client";

import { useActionState } from "react";

import { bulkStartSourcingAction, setStageAction, type StageOp } from "@/app/discover/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import type { Stage } from "@/lib/discover/stage";
import { INITIAL_FORM_STATE } from "@/lib/forms";

const OPS: Record<Stage, { op: StageOp; label: string; primary?: boolean }[]> = {
  DISCOVERED: [
    { op: "SHORTLIST", label: "후보로 선택", primary: true },
    { op: "REJECT", label: "검토 제외" },
  ],
  SHORTLISTED: [
    { op: "START_SOURCING", label: "소싱 시작", primary: true },
    { op: "REJECT", label: "선택 해제 · 제외" },
  ],
  REJECTED: [{ op: "UNREJECT", label: "제외 취소 (후보로)" }],
  SOURCING: [
    { op: "PAUSE_SOURCING", label: "소싱 보류 (후보로)" },
    { op: "REJECT", label: "검토 제외" },
  ],
  SOURCED: [
    { op: "PAUSE_SOURCING", label: "소싱 보류 (후보로)" },
    { op: "REJECT", label: "검토 제외" },
  ],
  SUPPLIER_SELECTED: [{ op: "PAUSE_SOURCING", label: "소싱 보류 (후보로)" }],
  BLOCKED: [],
  STOPPED: [],
};

/** 상품 카드의 단계 버튼 — 누를 때만 바뀐다 (자동 실행은 바꾸지 않음) */
export function StageButtons({ productId, keywordId, stage, watchStatus }: { productId: string; keywordId: string | null; stage: Stage; watchStatus: string | null }) {
  const [state, action, pending] = useActionState(setStageAction.bind(null, productId, keywordId), INITIAL_FORM_STATE);
  // SOURCING 이후 단계(TESTING · SELLING …)는 관심상품 화면에서 바꾼다
  const ops = watchStatus && !["WATCHING", "SOURCING", "DROPPED"].includes(watchStatus) ? [] : OPS[stage];
  if (ops.length === 0) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-testid="stage-buttons">
      {ops.map((o) => (
        <Button key={o.op} type="submit" name="op" value={o.op} size="sm" variant={o.primary ? "default" : "outline"} disabled={pending} data-op={o.op}>
          {o.label}
        </Button>
      ))}
      <FormMessage state={state} />
    </form>
  );
}

/** 후보 여러 개를 골라 한 번에 소싱 시작 (체크한 후보만) */
export function BulkStartSourcingForm({ items }: { items: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(bulkStartSourcingAction, INITIAL_FORM_STATE);
  if (items.length === 0) return <p className="text-muted-foreground text-xs">소싱 검토 후보가 없습니다 — 아래 상품 카드에서 [후보로 선택]하세요.</p>;
  return (
    <form action={action} className="space-y-2 text-xs" data-testid="bulk-sourcing">
      <ul className="grid gap-1 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.id}>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="product_id" value={it.id} className="mt-0.5" /> <span>{it.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "시작 중…" : "체크한 후보만 소싱 시작"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
