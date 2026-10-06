import { SourceBadge } from "@/components/common/source-badge";
import type { DataPoint } from "@/types/common";

interface MetricItemProps {
  label: string;
  point: DataPoint | null;
  format: (value: number | null) => string;
}

export function MetricItem({ label, point, format }: MetricItemProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {format(point?.value ?? null)}
      </span>
      {point && <SourceBadge source={point.source} confidence={point.confidence} />}
    </div>
  );
}
