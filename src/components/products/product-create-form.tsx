"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";

import { createProductAction } from "@/app/products/actions";
import { CategoryField } from "@/components/common/category-field";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { parseCoupangInput } from "@/lib/coupang";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS } from "@/types/common";
import type { CategoryOption } from "@/types/keyword";
import { DELIVERY_TYPE_LABELS, DELIVERY_TYPES, SELLER_TYPE_LABELS, SELLER_TYPES } from "@/types/product";

interface Ids {
  productId: string;
  itemId: string;
  vendorItemId: string;
  url: string;
}

const EMPTY: Ids = { productId: "", itemId: "", vendorItemId: "", url: "" };

/**
 * 상품 등록. 쿠팡 상품 ID 또는 URL 을 넣으면 productId · itemId · vendorItemId 를 채워 보여주고,
 * 사용자가 확인·수정한 값으로 저장한다 (서버에서 다시 검증).
 */
export function ProductCreateForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState(createProductAction, INITIAL_FORM_STATE);
  const [raw, setRaw] = useState("");
  const [ids, setIds] = useState<Ids>(EMPTY);
  const parsed = raw.trim() ? parseCoupangInput(raw) : null;

  function applyInput(value: string) {
    setRaw(value);
    const p = value.trim() ? parseCoupangInput(value) : null;
    if (p) setIds({ productId: p.productId, itemId: p.itemId ?? "", vendorItemId: p.vendorItemId ?? "", url: p.url ?? "" });
  }

  return (
    <form
      action={action}
      // 액션이 끝나면 React 가 폼을 reset 한다 → 직접 관리하는 ID 칸도 함께 비운다
      onReset={() => {
        setRaw("");
        setIds(EMPTY);
      }}
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <Label htmlFor="coupang-input">쿠팡 상품 URL 또는 상품 ID</Label>
        <Input
          id="coupang-input"
          value={raw}
          onChange={(e) => applyInput(e.target.value)}
          placeholder="https://www.coupang.com/vp/products/… 또는 숫자 ID"
          autoComplete="off"
        />
        <p className={parsed || !raw.trim() ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
          {!raw.trim()
            ? "붙여넣으면 아래 ID 칸이 자동으로 채워집니다. 저장 전에 확인하세요."
            : parsed
              ? "해석 완료 — 아래 값을 확인하세요."
              : "쿠팡 상품 URL 형식이 아닙니다. 상품 ID 를 직접 입력해도 됩니다."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <IdField label="상품 ID (필수)" name="coupang_product_id" value={ids.productId} required onChange={(v) => setIds({ ...ids, productId: v })} />
        <IdField label="itemId" name="coupang_item_id" value={ids.itemId} onChange={(v) => setIds({ ...ids, itemId: v })} />
        <IdField label="vendorItemId" name="coupang_vendor_item_id" value={ids.vendorItemId} onChange={(v) => setIds({ ...ids, vendorItemId: v })} />
      </div>
      <input type="hidden" name="product_url" value={ids.url} />
      {ids.url && <p className="text-muted-foreground -mt-2 truncate text-xs">저장될 URL: {ids.url}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-product-name">상품명 (필수)</Label>
          <Input id="new-product-name" name="product_name" required maxLength={300} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-brand">브랜드</Label>
          <Input id="new-brand" name="brand" maxLength={100} />
        </div>
        <CategoryField categories={categories} idPrefix="new-product" />
        <div className="space-y-1.5">
          <Label htmlFor="new-seller">판매자 유형</Label>
          <NativeSelect id="new-seller" name="seller_type" defaultValue="">
            <option value="">모름</option>
            {SELLER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SELLER_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">오늘 확인한 지표 (선택)</legend>
        <p className="text-muted-foreground text-xs">입력하면 첫 스냅샷(직접 입력, 오늘 KST)으로 저장됩니다. 비우면 저장하지 않습니다.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-price">판매가 (원)</Label>
            <Input id="new-price" name="price" type="number" min={0} step={1} inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-delivery">배송 유형</Label>
            <NativeSelect id="new-delivery" name="delivery_type" defaultValue="">
              <option value="">모름</option>
              {DELIVERY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DELIVERY_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-confidence">신뢰도</Label>
            <NativeSelect id="new-confidence" name="confidence" defaultValue="B">
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c} · {CONFIDENCE_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Plus />
          {pending ? "등록 중…" : "상품 등록"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function IdField({
  label,
  name,
  value,
  required,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  required?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`new-${name}`}>{label}</Label>
      <Input
        id={`new-${name}`}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        inputMode="numeric"
        pattern="\d{1,20}"
        required={required}
        autoComplete="off"
      />
    </div>
  );
}
