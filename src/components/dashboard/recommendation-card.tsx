import { Minus, Plus, TriangleAlert } from "lucide-react";

import { ScoreBadge } from "@/components/common/score-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatNumber,
  formatPercent,
  formatSignedPercent,
  formatWon,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { RISK_LABELS } from "@/types/common";
import type { RecommendationView } from "@/types/dashboard";
import { MetricItem } from "./metric-item";

const ratio = (v: number | null) => (v == null ? "-" : v.toFixed(1));

export function RecommendationCard({ item }: { item: RecommendationView }) {
  // 판매량은 실제 → 추정 → 예측 순으로 표시하고, 라벨로 종류를 구분한다.
  const salesPoint = item.sales.actual ?? item.sales.estimated ?? item.sales.predicted;
  const salesLabel = item.sales.actual
    ? "월 판매량(실제)"
    : item.sales.estimated
      ? "월 판매량(추정)"
      : "월 판매량(예측)";

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-muted-foreground text-xs font-medium">
            {item.rank}위 · {item.category}
          </div>
          <h3 className="font-semibold break-keep">{item.productName}</h3>
        </div>
        <ScoreBadge score={item.opportunityScore} />
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <MetricItem label={salesLabel} point={salesPoint} format={formatNumber} />
          <MetricItem label="예상 월매출" point={item.monthlyRevenue} format={formatWon} />
          <MetricItem label="예상 월순이익" point={item.monthlyNetProfit} format={formatWon} />
          <MetricItem label="마진율" point={item.marginRate} format={(v) => formatPercent(v)} />
          <MetricItem label="경쟁강도" point={item.competitionRatio} format={ratio} />
          <MetricItem label="상위 평균 리뷰" point={item.topReviewAvg} format={formatNumber} />
          <MetricItem label="WING 비율" point={item.wingRatio} format={(v) => formatPercent(v, 0)} />
          <MetricItem label="성장률" point={item.growthRate} format={formatSignedPercent} />
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium">점수 근거</div>
            <ul className="space-y-1 text-sm">
              {item.reasons.map((r) => (
                <li key={r.message} className="flex items-center gap-1.5">
                  {r.kind === "POSITIVE" ? (
                    <Plus className="size-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Minus className="size-3.5 shrink-0 text-amber-600" />
                  )}
                  <span className={cn(r.kind === "CAUTION" && "text-muted-foreground")}>
                    {r.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {item.risks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium">위험 요소</div>
              <ul className="space-y-1 text-sm">
                {item.risks.map((risk) => (
                  <li key={risk.type} className="flex items-start gap-1.5">
                    <TriangleAlert
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        risk.severity === "HIGH" ? "text-red-600" : "text-amber-600",
                      )}
                    />
                    <span>
                      <span className="font-medium">{RISK_LABELS[risk.type]}</span>
                      <span className="text-muted-foreground"> — {risk.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
