import { setSnapshotExcludedAction } from "@/app/keywords/actions";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { formatDecimal, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { KeywordSnapshotView } from "@/types/keyword";

/** 날짜·출처별 스냅샷 이력. 잘못된 행은 삭제하지 않고 "제외" (현재 값 계산에서 빠짐) */
export function SnapshotHistory({ keywordId, snapshots }: { keywordId: string; snapshots: KeywordSnapshotView[] }) {
  if (snapshots.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">아직 수집된 지표가 없습니다.</p>;
  }

  const calc = (s: KeywordSnapshotView, field: string) =>
    s.calculatedFields.includes(field) ? <span title="자동 계산" className="text-muted-foreground ml-0.5 text-[10px]">계산</span> : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">수집일</th>
            <th className="py-2 pr-3 font-medium">출처</th>
            <th className="py-2 pr-3 text-right font-medium">검색량</th>
            <th className="py-2 pr-3 text-right font-medium">상품 수</th>
            <th className="py-2 pr-3 text-right font-medium">경쟁강도</th>
            <th className="py-2 pr-3 text-right font-medium">WING</th>
            <th className="py-2 pr-3 text-right font-medium">로켓</th>
            <th className="py-2 pr-3 text-right font-medium">평균 가격</th>
            <th className="py-2 pr-3 text-right font-medium">평균 리뷰</th>
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
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(s.searchVolume)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(s.coupangProductCount)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {formatDecimal(s.competitionIntensity)}
                {calc(s, "competition_intensity")}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatPercent(s.wingRatio)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatPercent(s.rocketRatio)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(s.averagePrice)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(s.averageReviews)}</td>
              <td className="py-2.5">
                {s.isExcluded ? (
                  <form action={setSnapshotExcludedAction.bind(null, keywordId, s.id, false)} className="flex flex-col items-start gap-1">
                    <Badge variant="outline" title={s.excludedReason ?? undefined}>
                      제외됨
                    </Badge>
                    {s.excludedReason && <span className="text-[11px]">{s.excludedReason}</span>}
                    <button type="submit" className="text-foreground text-xs font-medium hover:underline">
                      복원
                    </button>
                  </form>
                ) : (
                  <form action={setSnapshotExcludedAction.bind(null, keywordId, s.id, true)} className="flex items-center gap-1.5">
                    <input
                      name="reason"
                      placeholder="제외 사유"
                      aria-label="제외 사유"
                      className="border-input h-7 w-24 rounded border px-1.5 text-xs"
                    />
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
