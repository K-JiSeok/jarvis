"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";

import { createKeywordAction, type FormState } from "@/app/keywords/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { KEYWORD_MAX_LENGTH } from "@/lib/keywords";
import type { CategoryOption } from "@/types/keyword";

import { CategoryField } from "./category-field";
import { FormMessage } from "./form-message";

const INITIAL: FormState = { ok: false, message: null };

export function KeywordCreateForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState(createKeywordAction, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="new-keyword">키워드</Label>
          <Input
            id="new-keyword"
            name="keyword"
            required
            maxLength={KEYWORD_MAX_LENGTH}
            placeholder="예: 실리콘 주방 트레이"
            autoComplete="off"
          />
        </div>
        <CategoryField categories={categories} idPrefix="new" />
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="is_tracking" defaultChecked className="size-4" />
          추적
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Plus />
          {pending ? "등록 중…" : "키워드 등록"}
        </Button>
        <FormMessage state={state} />
      </div>
      <p className="text-muted-foreground text-xs">
        대소문자·공백만 다른 키워드는 같은 키워드로 봅니다. 키워드는 삭제하지 않고 &quot;추적 중지&quot;로 관리합니다.
      </p>
    </form>
  );
}
