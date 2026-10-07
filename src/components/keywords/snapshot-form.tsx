"use client";

import { useActionState } from "react";

import { saveSnapshotAction } from "@/app/keywords/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS } from "@/types/common";

interface Field {
  name: string;
  label: string;
  unit?: string;
  step?: string;
  min?: number;
  max?: number;
  hint?: string;
}

const FIELDS: Field[] = [
  { name: "search_volume", label: "월 검색량", step: "1", min: 0 },
  { name: "search_volume_previous", label: "이전(전월) 검색량", step: "1", min: 0 },
  { name: "search_growth_rate", label: "검색량 증감", unit: "%", step: "0.01", min: -100, hint: "검색량 두 값을 함께 입력하고 비우면 계산" },
  { name: "coupang_product_count", label: "쿠팡 상품 수", step: "1", min: 0 },
  { name: "competition_intensity", label: "경쟁강도", step: "0.0001", min: 0, hint: "상품 수 ÷ 검색량. 두 값을 함께 입력하고 비우면 계산" },
  { name: "wing_ratio", label: "WING 비율", unit: "%", step: "0.01", min: 0, max: 100 },
  { name: "rocket_ratio", label: "로켓 비율", unit: "%", step: "0.01", min: 0, max: 100 },
  { name: "brand_concentration", label: "브랜드 집중도", unit: "%", step: "0.01", min: 0, max: 100, hint: "상위 N개 중 최다 브랜드 점유율" },
  { name: "average_price", label: "평균 가격", unit: "원", step: "1", min: 0 },
  { name: "average_reviews", label: "평균 리뷰 수", step: "0.01", min: 0 },
  { name: "sample_size", label: "표본 수 (상위 N개)", step: "1", min: 1, max: 32767 },
  { name: "ad_bid", label: "광고 입찰가", unit: "원", step: "1", min: 0 },
];

/**
 * 키워드 지표 직접 입력 (source_type = MANUAL).
 * 빈 칸은 "모름"이다. 같은 날짜에 다시 저장하면 입력한 칸만 갱신되고 빈 칸은 기존 값을 유지한다.
 */
export function SnapshotForm({ keywordId, today }: { keywordId: string; today: string }) {
  const [state, action, pending] = useActionState(saveSnapshotAction.bind(null, keywordId), INITIAL_FORM_STATE);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="snap-date">수집일 (KST)</Label>
          <Input id="snap-date" name="captured_on" type="date" defaultValue={today} max={today} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="snap-confidence">신뢰도</Label>
          <NativeSelect id="snap-confidence" name="confidence" defaultValue="B">
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {c} · {CONFIDENCE_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="text-muted-foreground flex items-end text-xs">출처는 &quot;직접 입력(MANUAL)&quot;으로 저장됩니다.</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={`snap-${f.name}`}>
              {f.label}
              {f.unit && <span className="text-muted-foreground font-normal"> ({f.unit})</span>}
            </Label>
            <Input
              id={`snap-${f.name}`}
              name={f.name}
              type="number"
              inputMode="decimal"
              step={f.step}
              min={f.min}
              max={f.max}
            />
            {f.hint && <p className="text-muted-foreground text-[11px]">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "지표 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
