"use client";

import { useActionState } from "react";

import { saveProductSnapshotAction } from "@/app/products/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS } from "@/types/common";
import { DELIVERY_TYPE_LABELS, DELIVERY_TYPES, SELLER_TYPE_LABELS, SELLER_TYPES } from "@/types/product";

interface Field {
  name: string;
  label: string;
  unit?: string;
  step?: string;
  min?: number;
  max?: number;
  hint?: string;
}

const BASIC: Field[] = [
  { name: "price", label: "판매가", unit: "원", step: "1", min: 0 },
  { name: "original_price", label: "정가", unit: "원", step: "1", min: 0 },
  { name: "discount_rate", label: "할인율", unit: "%", step: "0.01", min: 0, max: 100, hint: "판매가·정가를 함께 입력하고 비우면 계산" },
  { name: "review_count", label: "리뷰 수", step: "1", min: 0 },
  { name: "rating", label: "평점", unit: "0~5", step: "0.01", min: 0, max: 5 },
  { name: "category_rank", label: "카테고리 순위", step: "1", min: 1 },
  { name: "option_count", label: "옵션 수", step: "1", min: 0 },
  { name: "views_28d", label: "28일 조회수", step: "1", min: 0 },
  { name: "conversion_rate", label: "전환율", unit: "%", step: "0.01", min: 0, max: 100 },
];

/** 판매량·매출: 실제(actual)와 추정(estimated)을 절대 섞지 않는다. 예측(predicted)은 여기서 입력하지 않는다 */
const SALES: Field[] = [
  { name: "sales_actual", label: "실제 판매량", step: "1", min: 0, hint: "WING 등에서 실제로 확인한 값" },
  { name: "sales_estimated", label: "추정 판매량", step: "1", min: 0, hint: "외부 도구·참고 자료의 추정값" },
  { name: "revenue_actual", label: "실제 매출", unit: "원", step: "1", min: 0 },
  { name: "revenue_estimated", label: "추정 매출", unit: "원", step: "1", min: 0 },
];

export function ProductSnapshotForm({ productId, today }: { productId: string; today: string }) {
  const [state, action, pending] = useActionState(saveProductSnapshotAction.bind(null, productId), INITIAL_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ps-date">수집일 (KST)</Label>
          <Input id="ps-date" name="captured_on" type="date" defaultValue={today} max={today} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-confidence">신뢰도</Label>
          <NativeSelect id="ps-confidence" name="confidence" defaultValue="B">
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
        <div className="space-y-1.5">
          <Label htmlFor="ps-delivery">배송 유형</Label>
          <NativeSelect id="ps-delivery" name="delivery_type" defaultValue="">
            <option value="">모름</option>
            {DELIVERY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DELIVERY_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-seller">판매자 유형 (관측)</Label>
          <NativeSelect id="ps-seller" name="seller_type_observed" defaultValue="">
            <option value="">모름</option>
            {SELLER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SELLER_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ps-name">관측 상품명</Label>
          <Input id="ps-name" name="product_name_observed" maxLength={300} placeholder="이름이 바뀌었으면 입력 (이력으로 남음)" />
        </div>
        {BASIC.map((f) => (
          <NumberField key={f.name} field={f} />
        ))}
      </div>

      <fieldset className="space-y-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">판매량 · 매출</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="ps-sales_period_days">집계 기간 (일)</Label>
            <Input id="ps-sales_period_days" name="sales_period_days" type="number" min={1} max={365} step={1} defaultValue={28} />
            <p className="text-muted-foreground text-[11px]">판매량·매출과 함께 저장</p>
          </div>
          {SALES.map((f) => (
            <NumberField key={f.name} field={f} />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "지표 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
      <p className="text-muted-foreground text-xs">빈 칸은 &quot;모름&quot;입니다. 같은 날짜에 다시 저장해도 기존 값을 지우지 않습니다. 잘못된 값은 이력에서 제외하세요.</p>
    </form>
  );
}

function NumberField({ field: f }: { field: Field }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`ps-${f.name}`}>
        {f.label}
        {f.unit && <span className="text-muted-foreground font-normal"> ({f.unit})</span>}
      </Label>
      <Input id={`ps-${f.name}`} name={f.name} type="number" inputMode="decimal" step={f.step} min={f.min} max={f.max} />
      {f.hint && <p className="text-muted-foreground text-[11px]">{f.hint}</p>}
    </div>
  );
}
