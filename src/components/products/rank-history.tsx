import Link from "next/link";

import { deleteRankAction } from "@/app/products/actions";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import type { KeywordRankView } from "@/types/product";

/**
 * 키워드 검색 순위 이력. mode = "product" 면 키워드 열, "keyword" 면 상품 열을 보여준다.
 * 직접 입력(MANUAL) 행만 삭제할 수 있다.
 */
export function RankHistory({ ranks, mode }: { ranks: KeywordRankView[]; mode: "product" | "keyword" }) {
  if (ranks.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">기록된 순위가 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">{mode === "product" ? "키워드" : "상품"}</th>
            <th className="py-2 pr-3 text-right font-medium">순위</th>
            <th className="py-2 pr-3 font-medium">노출</th>
            <th className="py-2 pr-3 text-right font-medium">페이지</th>
            <th className="py-2 pr-3 font-medium">수집일</th>
            <th className="py-2 pr-3 font-medium">출처</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {ranks.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="py-2 pr-3">
                {mode === "product" ? (
                  <Link href={`/keywords/${r.keywordId}`} className="hover:underline">
                    {r.keyword}
                  </Link>
                ) : (
                  <Link href={`/products/${r.productId}`} className="hover:underline">
                    {r.productName}
                    <span className="text-muted-foreground ml-1 text-xs">ID {r.coupangProductId}</span>
                  </Link>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums">{r.rank}위</td>
              <td className="py-2 pr-3">
                <Badge variant={r.isAd ? "outline" : "secondary"}>{r.isAd ? "광고" : "자연"}</Badge>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.page ?? "-"}</td>
              <td className="py-2 pr-3 tabular-nums">{r.capturedOn}</td>
              <td className="py-2 pr-3">
                <SourceBadge source={r.source} confidence={r.confidence} />
              </td>
              <td className="py-2 text-right">
                {r.source === "MANUAL" && (
                  <form action={deleteRankAction.bind(null, r.productId, r.keywordId, r.id)}>
                    <button type="submit" className="text-destructive text-xs font-medium hover:underline" title="직접 입력한 순위만 삭제할 수 있습니다">
                      삭제
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
