"use client";

import { useActionState } from "react";

import { updateProductAction } from "@/app/products/actions";
import { CategoryField } from "@/components/common/category-field";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { INITIAL_FORM_STATE } from "@/lib/forms";
import type { CategoryOption } from "@/types/keyword";
import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES, SELLER_TYPE_LABELS, SELLER_TYPES, type ProductDetail } from "@/types/product";

/** master 컬럼만 수정. 쿠팡 상품 ID 는 식별자라 바꾸지 않는다 */
export function ProductEditForm({ product, categories }: { product: ProductDetail; categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState(updateProductAction.bind(null, product.id), INITIAL_FORM_STATE);
  const m = product.master;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="coupang_product_id" value={product.coupangProductId} />

      <div className="space-y-1.5">
        <Label htmlFor="edit-name">상품명</Label>
        <Input id="edit-name" name="product_name" defaultValue={product.productName} required maxLength={300} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-brand">브랜드</Label>
          <Input id="edit-brand" name="brand" defaultValue={product.brand ?? ""} maxLength={100} />
        </div>
        <CategoryField categories={categories} defaultValue={product.category?.id ?? ""} idPrefix="edit-product" />
        <div className="space-y-1.5">
          <Label htmlFor="edit-item">itemId</Label>
          <Input id="edit-item" name="coupang_item_id" defaultValue={m.coupangItemId ?? ""} inputMode="numeric" pattern="\d{1,20}" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-vendor">vendorItemId</Label>
          <Input id="edit-vendor" name="coupang_vendor_item_id" defaultValue={m.coupangVendorItemId ?? ""} inputMode="numeric" pattern="\d{1,20}" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-url">상품 URL</Label>
        <Input id="edit-url" name="product_url" defaultValue={m.productUrl ?? ""} placeholder="https://www.coupang.com/vp/products/…" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-seller">판매자 유형</Label>
          <NativeSelect id="edit-seller" name="seller_type" defaultValue={product.sellerType ?? ""}>
            <option value="">모름</option>
            {SELLER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SELLER_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-pb">쿠팡 PB</Label>
          <NativeSelect id="edit-pb" name="is_coupang_pb" defaultValue={m.isCoupangPb == null ? "" : String(m.isCoupangPb)}>
            <option value="">모름</option>
            <option value="true">예</option>
            <option value="false">아니오</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-options">옵션 수</Label>
          <Input id="edit-options" name="option_count" type="number" min={0} step={1} defaultValue={m.optionCount ?? ""} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="edit-lifecycle">상태</Label>
          <NativeSelect id="edit-lifecycle" name="lifecycle_status" defaultValue={product.lifecycleStatus}>
            {LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LIFECYCLE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="is_own_product" defaultChecked={product.isOwnProduct} className="size-4" />
          내가 판매하는 상품
        </label>
      </div>
      <p className="text-muted-foreground text-xs">상품은 삭제하지 않습니다. 판매가 끝났으면 상태를 &quot;삭제·판매 종료&quot;로 바꾸세요 (이력 유지).</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "저장 중…" : "기본 정보 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
