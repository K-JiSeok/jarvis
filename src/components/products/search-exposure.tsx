import Link from "next/link";

import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import type { KeywordRankView, ProductSnapshotView } from "@/types/product";

import { deliveryLabel } from "./labels";

/**
 * 검색 노출 (PHASE 12): 키워드 · 노출 구분별 가장 최근 순위 + 같은 날 상품 스냅샷의 화면 값.
 * 순위(keyword_product_ranks)와 스냅샷(product_snapshots)을 그대로 읽는다 — 새 저장소 없음.
 * 같은 날 스냅샷이 여러 출처면 쿠팡 페이지(COUPANG_PAGE) 값을 먼저 쓴다. 제외된 스냅샷은 쓰지 않는다.
 */
export function latestExposures(ranks: KeywordRankView[], snapshots: ProductSnapshotView[]) {
  const latest = new Map<string, KeywordRankView>();
  for (const r of ranks) {
    const key = `${r.keywordId}:${r.isAd}`;
    const prev = latest.get(key);
    if (!prev || r.capturedOn > prev.capturedOn) latest.set(key, r);
  }
  return [...latest.values()]
    .sort((a, b) => b.capturedOn.localeCompare(a.capturedOn) || Number(a.isAd) - Number(b.isAd) || a.rank - b.rank)
    .map((rank) => {
      const sameDay = snapshots.filter((s) => s.capturedOn === rank.capturedOn && !s.isExcluded);
      const snap = sameDay.find((s) => s.source === "COUPANG_PAGE") ?? sameDay[0] ?? null;
      return { rank, snap };
    });
}

export function SearchExposure({ ranks, snapshots }: { ranks: KeywordRankView[]; snapshots: ProductSnapshotView[] }) {
  const rows = latestExposures(ranks, snapshots);
  if (rows.length === 0) return <p className="text-muted-foreground py-4 text-center text-sm">검색 노출 기록이 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">키워드</th>
            <th className="py-2 pr-3 font-medium">순위</th>
            <th className="py-2 pr-3 text-right font-medium">가격</th>
            <th className="py-2 pr-3 text-right font-medium">리뷰</th>
            <th className="py-2 pr-3 text-right font-medium">평점</th>
            <th className="py-2 pr-3 font-medium">배송</th>
            <th className="py-2 pr-3 font-medium">수집일</th>
            <th className="py-2 font-medium">출처</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map(({ rank, snap }) => (
            <tr key={rank.id} className="border-b last:border-0">
              <td className="py-2 pr-3">
                <Link href={`/keywords/${rank.keywordId}`} className="hover:underline">
                  {rank.keyword}
                </Link>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <Badge variant={rank.isAd ? "outline" : "secondary"}>{rank.isAd ? "광고" : "자연"}</Badge> <b>{rank.rank}위</b>
                {rank.page != null && <span className="text-muted-foreground text-xs"> · {rank.page}페이지</span>}
              </td>
              <td className="py-2 pr-3 text-right">{snap?.price != null ? `${snap.price.toLocaleString("ko-KR")}원` : "-"}</td>
              <td className="py-2 pr-3 text-right">{snap?.reviewCount?.toLocaleString("ko-KR") ?? "-"}</td>
              <td className="py-2 pr-3 text-right">{snap?.rating ?? "-"}</td>
              <td className="py-2 pr-3">{snap?.deliveryType ? deliveryLabel(snap.deliveryType) : "-"}</td>
              <td className="py-2 pr-3">{rank.capturedOn}</td>
              <td className="py-2">
                <SourceBadge source={rank.source} confidence={rank.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
