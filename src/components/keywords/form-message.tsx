import Link from "next/link";

import type { FormState } from "@/app/keywords/actions";
import { cn } from "@/lib/utils";

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("text-sm", state.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
      {state.message}
      {state.existingKeywordId && (
        <>
          {" "}
          <Link href={`/keywords/${state.existingKeywordId}`} className="font-medium underline">
            기존 키워드 보기
          </Link>
        </>
      )}
    </p>
  );
}
