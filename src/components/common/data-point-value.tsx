import { SourceBadge } from "@/components/common/source-badge";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DataPoint } from "@/types/common";

/**
 * DataPoint 값 + 출처·신뢰도 배지 (+ 선택: 수집일).
 * 값이 없으면 "-" 만 표시한다 (0 으로 채우지 않는다 — NULL = 모름).
 */
export function DataPointValue({
  point,
  format,
  showDate = false,
  className,
}: {
  point: DataPoint | null;
  format: (value: number) => string;
  showDate?: boolean;
  className?: string;
}) {
  if (!point || point.value == null) {
    return (
      <span className={cn("text-muted-foreground", className)} title="데이터 없음">
        -
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span className="tabular-nums">{format(point.value)}</span>
      <span className="flex items-center gap-1.5">
        <SourceBadge source={point.source} confidence={point.confidence} />
        {showDate && point.collectedAt && (
          <span className="text-muted-foreground text-[10px] leading-none">{formatShortDate(point.collectedAt)}</span>
        )}
      </span>
    </span>
  );
}
