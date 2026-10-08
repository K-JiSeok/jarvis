"use client";

import { useState, useTransition } from "react";

import { rollbackImportAction } from "@/app/import/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 가져오기 되돌리기 (rollback_import). 이후에 같은 데이터가 바뀌었으면 아무것도 바꾸지 않는다 */
export function RollbackButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!confirm("이 가져오기로 추가된 행은 삭제하고, 갱신된 행은 이전 값으로 되돌립니다. 진행할까요?")) return;
          start(async () => setMsg(await rollbackImportAction(jobId)));
        }}
      >
        {pending ? "되돌리는 중…" : "가져오기 되돌리기"}
      </Button>
      {msg && <span className={cn("text-xs", msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{msg.message}</span>}
    </span>
  );
}
