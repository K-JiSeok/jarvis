"use client";

import { useState } from "react";

import { Input, Label, NativeSelect } from "@/components/ui/input";
import type { CategoryOption } from "@/types/keyword";

const NEW_CATEGORY = "__new__";

/** 카테고리 선택 + "새 카테고리" 입력 (새 카테고리는 저장 시 MANUAL 로 생성) */
export function CategoryField({
  categories,
  defaultValue = "",
  idPrefix,
}: {
  categories: CategoryOption[];
  defaultValue?: string;
  idPrefix: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-category`}>카테고리</Label>
      <NativeSelect
        id={`${idPrefix}-category`}
        name="category_id"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">미지정</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.path ?? c.name}
          </option>
        ))}
        <option value={NEW_CATEGORY}>+ 새 카테고리…</option>
      </NativeSelect>
      {value === NEW_CATEGORY && (
        <Input name="new_category" placeholder="예: 주방용품>정리/수납" aria-label="새 카테고리 이름" required autoFocus />
      )}
    </div>
  );
}
