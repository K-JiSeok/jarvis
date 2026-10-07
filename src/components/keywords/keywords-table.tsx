import Link from "next/link";

import { setTrackingAction } from "@/app/keywords/actions";
import { DataPointValue } from "@/components/common/data-point-value";
import { Badge } from "@/components/ui/badge";
import { formatDecimal, formatNumber, formatPercent, formatShortDate } from "@/lib/format";
import type { KeywordSummary } from "@/types/keyword";

export function KeywordsTable({ keywords }: { keywords: KeywordSummary[] }) {
  if (keywords.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">등록된 키워드가 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">키워드</th>
            <th className="py-2 pr-3 font-medium">카테고리</th>
            <th className="py-2 pr-3 text-right font-medium">월 검색량</th>
            <th className="py-2 pr-3 text-right font-medium">상품 수</th>
            <th className="py-2 pr-3 text-right font-medium">경쟁강도</th>
            <th className="py-2 pr-3 text-right font-medium">WING</th>
            <th className="py-2 pr-3 text-right font-medium">로켓</th>
            <th className="py-2 pr-3 font-medium">최근 수집</th>
            <th className="py-2 font-medium">추적</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k) => (
            <tr key={k.id} className={k.isTracking ? "border-b last:border-0" : "text-muted-foreground border-b last:border-0"}>
              <td className="py-2.5 pr-3 font-medium">
                <Link href={`/keywords/${k.id}`} className="hover:underline">
                  {k.keyword}
                </Link>
              </td>
              <td className="text-muted-foreground py-2.5 pr-3 text-xs">{k.category?.path ?? k.category?.name ?? "-"}</td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={k.metrics.searchVolume} format={formatNumber} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={k.metrics.coupangProductCount} format={formatNumber} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={k.metrics.competitionIntensity} format={(v) => formatDecimal(v)} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={k.metrics.wingRatio} format={(v) => formatPercent(v)} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={k.metrics.rocketRatio} format={(v) => formatPercent(v)} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-xs tabular-nums">{formatShortDate(k.latestCapturedOn)}</td>
              <td className="py-2.5">
                <form action={setTrackingAction.bind(null, k.id, !k.isTracking)}>
                  <button type="submit" title={k.isTracking ? "추적 중지" : "추적 재개"}>
                    <Badge variant={k.isTracking ? "default" : "outline"}>{k.isTracking ? "추적 중" : "중지"}</Badge>
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
