import { verdictFromScore } from "@/lib/scoring/verdict";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type Verdict } from "@/types/common";

const VERDICT_STYLES: Record<Verdict, string> = {
  STRONG_BUY:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  REVIEW:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
  EXCLUDE:
    "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-300 dark:border-zinc-500/30",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        VERDICT_STYLES[verdict],
      )}
    >
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

/** 기회 점수 + 판정 */
export function ScoreBadge({ score }: { score: number }) {
  const verdict = verdictFromScore(score);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-3xl leading-none font-bold tabular-nums">{score}</span>
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[11px] leading-none">/ 100</span>
        <VerdictBadge verdict={verdict} />
      </div>
    </div>
  );
}
