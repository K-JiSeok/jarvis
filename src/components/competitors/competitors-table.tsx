import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CompetitorRelation } from "@/types/competitor";
import { LIFECYCLE_LABELS, type ProductMetrics } from "@/types/product";

import { CompetitorRowControls, RelationBadge } from "./competitor-controls";
import { FulfillmentCell, PriceCell, RatingCell, ReviewCell, SalesCell } from "./metric-cells";

/**
 * 경쟁상품 비교표.
 * mode = "list": /competitors (기준 상품 열 포함)
 * mode = "product": 상품 상세 (맨 위에 기준 상품 행을 두고 경쟁상품과 나란히 비교)
 */
export function CompetitorsTable({
  relations,
  mode,
  base,
}: {
  relations: CompetitorRelation[];
  mode: "list" | "product";
  base?: { name: string; metrics: ProductMetrics; latestCapturedOn: string | null };
}) {
  if (relations.length === 0 && !base) {
    return <p className="text-muted-foreground py-6 text-center text-sm">등록된 경쟁상품이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            {mode === "list" && <th className="py-2 pr-3 font-medium">기준 상품</th>}
            <th className="py-2 pr-3 font-medium">경쟁상품</th>
            <th className="py-2 pr-3 font-medium">관계</th>
            <th className="py-2 pr-3 text-right font-medium">가격</th>
            <th className="py-2 pr-3 text-right font-medium">리뷰</th>
            <th className="py-2 pr-3 text-right font-medium">평점</th>
            <th className="py-2 pr-3 text-right font-medium">판매량</th>
            <th className="py-2 pr-3 font-medium">배송 · 판매자</th>
            <th className="py-2 pr-3 font-medium">최근 수집</th>
            <th className="py-2 pr-3 font-medium">상태</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {base && (
            <tr className="bg-muted/40 border-b align-top">
              <td className="py-2.5 pr-3 font-medium">
                {base.name}
                <span className="text-muted-foreground block text-xs">이 상품 (기준)</span>
              </td>
              <td className="py-2.5 pr-3 text-xs">기준</td>
              <td className="py-2.5 pr-3 text-right"><PriceCell metrics={base.metrics} /></td>
              <td className="py-2.5 pr-3 text-right"><ReviewCell metrics={base.metrics} /></td>
              <td className="py-2.5 pr-3 text-right"><RatingCell metrics={base.metrics} /></td>
              <td className="py-2.5 pr-3 text-right"><SalesCell metrics={base.metrics} /></td>
              <td className="py-2.5 pr-3"><FulfillmentCell metrics={base.metrics} /></td>
              <td className="py-2.5 pr-3 text-xs tabular-nums">{formatShortDate(base.latestCapturedOn)}</td>
              <td className="py-2.5 pr-3" />
              <td className="py-2.5" />
            </tr>
          )}
          {relations.map((r) => (
            <tr key={r.id} className={cn("border-b align-top last:border-0", !r.isActive && "text-muted-foreground")}>
              {mode === "list" && (
                <td className="max-w-[200px] py-2.5 pr-3">
                  <Link href={`/products/${r.base.id}`} className="line-clamp-2 hover:underline">
                    {r.base.productName}
                  </Link>
                  <span className="text-muted-foreground text-xs">ID {r.base.coupangProductId}</span>
                </td>
              )}
              <td className="max-w-[220px] py-2.5 pr-3">
                <Link href={`/products/${r.competitor.id}`} className="line-clamp-2 font-medium hover:underline">
                  {r.competitor.productName}
                </Link>
                <span className="text-muted-foreground text-xs">
                  ID {r.competitor.coupangProductId}
                  {r.keyword && ` · ${r.keyword}`}
                </span>
                {r.competitor.lifecycleStatus !== "ACTIVE" && (
                  <Badge variant="outline" className="ml-1">
                    {LIFECYCLE_LABELS[r.competitor.lifecycleStatus]}
                  </Badge>
                )}
              </td>
              <td className="py-2.5 pr-3"><RelationBadge type={r.relationType} /></td>
              <td className="py-2.5 pr-3 text-right"><PriceCell metrics={r.competitorMetrics} /></td>
              <td className="py-2.5 pr-3 text-right"><ReviewCell metrics={r.competitorMetrics} /></td>
              <td className="py-2.5 pr-3 text-right"><RatingCell metrics={r.competitorMetrics} /></td>
              <td className="py-2.5 pr-3 text-right"><SalesCell metrics={r.competitorMetrics} /></td>
              <td className="py-2.5 pr-3"><FulfillmentCell metrics={r.competitorMetrics} /></td>
              <td className="py-2.5 pr-3 text-xs tabular-nums">{formatShortDate(r.competitorLatestCapturedOn)}</td>
              <td className="py-2.5 pr-3">
                <Badge variant={r.isActive ? "secondary" : "outline"}>{r.isActive ? "활성" : "해제됨"}</Badge>
              </td>
              <td className="py-2.5"><CompetitorRowControls relation={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
