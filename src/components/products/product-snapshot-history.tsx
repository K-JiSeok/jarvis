import { setProductSnapshotExcludedAction } from "@/app/products/actions";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductSnapshotView } from "@/types/product";

import { deliveryLabel } from "./labels";

/** 날짜·출처별 원본 기록 (최신 → 과거). 잘못된 행은 삭제하지 않고 제외 */
export function ProductSnapshotHistory({ productId, snapshots }: { productId: string; snapshots: ProductSnapshotView[] }) {
  if (snapshots.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">아직 수집된 지표가 없습니다.</p>;
  }

  const n = (v: number | null) => formatNumber(v);
  const calc = (s: ProductSnapshotView, field: string) =>
    s.calculatedFields.includes(field) ? <span className="text-muted-foreground ml-0.5 text-[10px]">계산</span> : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">수집일</th>
            <th className="py-2 pr-3 font-medium">출처</th>
            <th className="py-2 pr-3 text-right font-medium">가격</th>
            <th className="py-2 pr-3 text-right font-medium">할인</th>
            <th className="py-2 pr-3 text-right font-medium">리뷰</th>
            <th className="py-2 pr-3 text-right font-medium">평점</th>
            <th className="py-2 pr-3 text-right font-medium">카테고리 순위</th>
            <th className="py-2 pr-3 text-right font-medium">28일 조회</th>
            <th className="py-2 pr-3 text-right font-medium">판매량 실제/추정</th>
            <th className="py-2 pr-3 text-right font-medium">매출 실제/추정</th>
            <th className="py-2 pr-3 text-right font-medium">전환율</th>
            <th className="py-2 pr-3 font-medium">배송</th>
            <th className="py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id} className={cn("border-b align-top last:border-0", s.isExcluded && "text-muted-foreground bg-muted/40")}>
              <td className="py-2.5 pr-3 tabular-nums">{s.capturedOn}</td>
              <td className="py-2.5 pr-3">
                <SourceBadge source={s.source} confidence={s.confidence} />
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{n(s.price)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {formatPercent(s.discountRate)}
                {calc(s, "discount_rate")}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{n(s.reviewCount)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{s.rating == null ? "-" : s.rating.toFixed(1)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{n(s.categoryRank)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{n(s.views28d)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {n(s.salesActual)} / {n(s.salesEstimated)}
                {s.salesPeriodDays != null && <span className="text-muted-foreground block text-[10px]">{s.salesPeriodDays}일</span>}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {n(s.revenueActual)} / {n(s.revenueEstimated)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatPercent(s.conversionRate)}</td>
              <td className="py-2.5 pr-3 text-xs">{s.deliveryType ? deliveryLabel(s.deliveryType) : "-"}</td>
              <td className="py-2.5">
                {s.isExcluded ? (
                  <form action={setProductSnapshotExcludedAction.bind(null, productId, s.id, false)} className="flex flex-col items-start gap-1">
                    <Badge variant="outline">제외됨</Badge>
                    {s.excludedReason && <span className="text-[11px]">{s.excludedReason}</span>}
                    <button type="submit" className="text-foreground text-xs font-medium hover:underline">
                      복원
                    </button>
                  </form>
                ) : (
                  <form action={setProductSnapshotExcludedAction.bind(null, productId, s.id, true)} className="flex items-center gap-1.5">
                    <input name="reason" placeholder="제외 사유" aria-label="제외 사유" className="border-input h-7 w-24 rounded border px-1.5 text-xs" />
                    <button type="submit" className="text-destructive text-xs font-medium hover:underline">
                      제외
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
