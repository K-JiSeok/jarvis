import { VerdictBadge } from "@/components/common/score-badge";
import { Badge } from "@/components/ui/badge";
import type { JudgeResult } from "@/lib/judge/engine";
import { cn } from "@/lib/utils";

const CONF_STYLE = { A: "text-emerald-700 dark:text-emerald-300", B: "text-sky-700 dark:text-sky-300", C: "text-amber-700 dark:text-amber-300" } as const;

/** 판정 V2 (PHASE 26 · judge-v2) — "로켓그로스로 팔면 확실히 남는가". 시장 50% + 상품 50%, 확실한 수익 관문 */
export function JudgeBlock({ j }: { j: JudgeResult }) {
  return (
    <section className="space-y-2 rounded-md border p-3 text-xs" data-testid="judge-v2" data-verdict={j.verdict ?? "NONE"}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">판정 V2</span>
          {j.verdict ? (
            <>
              <span className="text-lg font-bold tabular-nums">{j.total}</span>
              <VerdictBadge verdict={j.verdict} />
              {j.confidence && <span className={cn("font-bold", CONF_STYLE[j.confidence])}>신뢰도 {j.confidence}</span>}
            </>
          ) : j.verdictIfCertain ? (
            <>
              <VerdictBadge verdict={j.verdictIfCertain} />
              <span className="text-muted-foreground">데이터가 부족해도 결론 확실</span>
            </>
          ) : (
            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
              판정 보류 · 가능 범위 {j.range.min}~{j.range.max}
            </Badge>
          )}
        </div>
        <span className="text-muted-foreground tabular-nums">
          시장 {j.marketScore ?? "-"} · 상품 {j.productScore ?? "-"}
        </span>
      </header>
      {j.gates.length > 0 && (
        <ul className="list-disc pl-5 text-amber-800 dark:text-amber-200">
          {j.gates.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {j.parts.map((p) => (
          <div key={p.part} className="flex gap-2">
            <span className="w-20 shrink-0 font-medium">{p.label}</span>
            <span className="w-8 shrink-0 text-right tabular-nums">{p.score ?? "-"}</span>
            <span className="text-muted-foreground">{p.basis}</span>
          </div>
        ))}
      </div>
      {j.missing.length > 0 && <p className="text-amber-800 dark:text-amber-200">판정에 필요한 데이터: {j.missing.join(" / ")}</p>}
      {j.risks.length > 0 && (
        <ul className="list-disc pl-5 text-red-700 dark:text-red-300">
          {j.risks.map((x) => (
            <li key={x.code + x.message}>{x.message}</li>
          ))}
        </ul>
      )}
      {j.confidenceWhy.length > 0 && <p className="text-muted-foreground">신뢰도 근거: {j.confidenceWhy.join(" · ")}</p>}
    </section>
  );
}
