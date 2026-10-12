import type { ReadinessItem, ReadyState } from "@/lib/discover/readiness";
import { cn } from "@/lib/utils";

const STATE_LABELS: Record<ReadyState, string> = { READY: "준비됨", PARTIAL: "일부", MISSING: "없음" };
const STATE_CLASS: Record<ReadyState, string> = {
  READY: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  PARTIAL: "border-amber-300 text-amber-700 dark:text-amber-300",
  MISSING: "border-muted-foreground/40 text-muted-foreground",
};

/** 데이터 준비 상태 표 (PHASE 16) — 점수 · 판정을 대체하지 않는다 */
export function ReadinessList({ items, testId }: { items: ReadinessItem[]; testId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs" data-testid={testId}>
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-1.5 font-normal">항목</th>
            <th className="py-1.5 font-normal">상태</th>
            <th className="py-1.5 pl-3 font-normal">지금 있는 데이터</th>
            <th className="py-1.5 pl-3 font-normal">다음에 할 일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key} className="border-b align-top last:border-0" data-ready={i.key} data-state={i.state}>
              <td className="py-1.5 whitespace-nowrap">{i.area}</td>
              <td className="py-1.5 whitespace-nowrap">
                <span className={cn("rounded border px-1.5 py-0.5", STATE_CLASS[i.state])}>{STATE_LABELS[i.state]}</span>
              </td>
              <td className="py-1.5 pl-3">{i.status}</td>
              <td className={cn("py-1.5 pl-3", !i.next && "text-muted-foreground")}>{i.next ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
