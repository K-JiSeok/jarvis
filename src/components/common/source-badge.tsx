import { cn } from "@/lib/utils";
import {
  CONFIDENCE_LABELS,
  SOURCE_TYPE_LABELS,
  type Confidence,
  type SourceType,
} from "@/types/common";

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  A: "text-emerald-700 dark:text-emerald-300",
  B: "text-sky-700 dark:text-sky-300",
  C: "text-amber-700 dark:text-amber-300",
};

/** 데이터 출처 + 신뢰도 표시. 예) 추정 · C */
export function SourceBadge({
  source,
  confidence,
  className,
}: {
  source: SourceType;
  confidence: Confidence;
  className?: string;
}) {
  return (
    <span
      title={`출처: ${SOURCE_TYPE_LABELS[source]} / 신뢰도 ${confidence} (${CONFIDENCE_LABELS[confidence]})`}
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1 text-[10px] leading-none",
        className,
      )}
    >
      {SOURCE_TYPE_LABELS[source]}
      <span className={cn("font-bold", CONFIDENCE_STYLES[confidence])}>
        {confidence}
      </span>
    </span>
  );
}
