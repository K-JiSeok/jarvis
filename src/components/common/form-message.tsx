import Link from "next/link";

import type { FormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("text-sm", state.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
      {state.message}
      {state.link && (
        <>
          {" "}
          <Link href={state.link.href} className="font-medium underline">
            {state.link.label}
          </Link>
        </>
      )}
    </p>
  );
}
