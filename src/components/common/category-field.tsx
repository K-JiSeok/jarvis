"use client";

import { useEffect, useRef, useState } from "react";

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
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  const selectRef = useRef<HTMLSelectElement>(null);

  // 저장 후 서버 값(defaultValue)이 바뀌면 선택도 맞춘다
  if (defaultValue !== prevDefault) {
    setPrevDefault(defaultValue);
    setValue(defaultValue);
  }

  // 폼 액션이 끝나면 React 가 폼을 reset 한다 → 선택 상태도 기본값으로 되돌려 화면과 폼 값을 맞춘다
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => setValue(defaultValue);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-category`}>카테고리</Label>
      <NativeSelect
        ref={selectRef}
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
