"use client";

import { useActionState } from "react";

import { dismissCandidateAction, promoteCandidateAction, runDiscoveryAction, setComplianceAction } from "@/app/discover/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/forms";

export function RunDiscoveryButton() {
  const [state, action, pending] = useActionState(runDiscoveryAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={pending} data-testid="run-discovery">
        {pending ? "자동 발굴 실행 중… (네이버 · 등록 · 검토 · 분석)" : "자동 발굴 지금 실행"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function CandidateActions({ id }: { id: string }) {
  const [p, promote, promoting] = useActionState(promoteCandidateAction.bind(null, id), INITIAL_FORM_STATE);
  const [d, dismiss, dismissing] = useActionState(dismissCandidateAction.bind(null, id), INITIAL_FORM_STATE);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <form action={promote}>
        <Button type="submit" size="sm" variant="outline" disabled={promoting || dismissing}>
          추적 키워드로 등록
        </Button>
      </form>
      <form action={dismiss}>
        <Button type="submit" size="sm" variant="ghost" disabled={promoting || dismissing}>
          제외
        </Button>
      </form>
      <FormMessage state={p.message ? p : d} />
    </div>
  );
}

const CHOICES = [
  ["AUTO", "자동 판단으로 되돌리기"],
  ["CLEARED", "확인 완료 (판매 가능 — 근거 필수)"],
  ["REQUIRES_CERTIFICATION", "인증 · 허가 · 신고 필요"],
  ["REQUIRES_BRAND_PROOF", "브랜드 · 정품 증빙 필요"],
  ["MANUAL_REVIEW", "추가 확인 필요"],
  ["BLOCKED", "판매 불가 (근거 필수)"],
] as const;

export function ComplianceForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(setComplianceAction.bind(null, productId), INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 text-xs">
      <label className="space-y-0.5">
        <span className="text-muted-foreground block">내 판단</span>
        <select name="status" className="border-input bg-background rounded-md border px-2 py-1" defaultValue="">
          <option value="" disabled>
            선택
          </option>
          {CHOICES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-48 flex-1 space-y-0.5">
        <span className="text-muted-foreground block">근거 (확인한 문서 · 정책 · 인증 번호)</span>
        <input name="note" maxLength={500} className="border-input bg-background w-full rounded-md border px-2 py-1" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        저장
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
