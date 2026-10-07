import Link from "next/link";

import { addCandidateAction, restoreCompetitorAction } from "@/app/competitors/actions";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/format";
import type { CandidateGroup } from "@/types/competitor";

import { RelationBadge, RelationSelect } from "./competitor-controls";
import { FulfillmentCell, PriceCell, ReviewCell, SalesCell } from "./metric-cells";

/**
 * 경쟁상품 후보: 이 상품이 순위로 연결된 키워드의 최근 검색 결과(keyword_product_ranks) 상위 상품.
 * 자동 등록하지 않는다. 사용자가 관계 유형을 골라 등록한다.
 */
export function CandidateList({ productId, groups }: { productId: string; groups: CandidateGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        후보가 없습니다. 아래 &quot;키워드 검색 순위&quot;에 이 상품의 순위를 입력하고, 같은 키워드의 다른 상품 순위도 입력하면 후보로 나타납니다.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.keywordId} className="space-y-2">
          <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            <Link href={`/keywords/${g.keywordId}`} className="hover:underline">
              키워드: {g.keyword}
            </Link>
            <span className="text-muted-foreground text-xs font-normal">
              {formatShortDate(g.capturedOn)} 수집 · 이 상품 {g.baseRank ? `${g.baseRank}위` : "순위 없음"}
            </span>
          </h4>
          {g.candidates.length === 0 ? (
            <p className="text-muted-foreground text-xs">이 날짜에 기록된 다른 상품이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1.5 pr-3 font-medium">순위</th>
                    <th className="py-1.5 pr-3 font-medium">상품</th>
                    <th className="py-1.5 pr-3 text-right font-medium">가격</th>
                    <th className="py-1.5 pr-3 text-right font-medium">리뷰</th>
                    <th className="py-1.5 pr-3 text-right font-medium">판매량</th>
                    <th className="py-1.5 pr-3 font-medium">배송 · 판매자</th>
                    <th className="py-1.5 font-medium">경쟁상품</th>
                  </tr>
                </thead>
                <tbody>
                  {g.candidates.map((c) => (
                    <tr key={c.product.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="font-semibold tabular-nums">{c.rank}위</span>
                        {c.isAd && <Badge variant="outline" className="ml-1">광고</Badge>}
                        <span className="block">
                          <SourceBadge source={c.source} confidence={c.confidence} />
                        </span>
                      </td>
                      <td className="max-w-[260px] py-2 pr-3">
                        <Link href={`/products/${c.product.id}`} className="line-clamp-2 hover:underline">
                          {c.product.productName}
                        </Link>
                        <span className="text-muted-foreground text-xs">ID {c.product.coupangProductId}</span>
                      </td>
                      <td className="py-2 pr-3 text-right"><PriceCell metrics={c.metrics} /></td>
                      <td className="py-2 pr-3 text-right"><ReviewCell metrics={c.metrics} /></td>
                      <td className="py-2 pr-3 text-right"><SalesCell metrics={c.metrics} /></td>
                      <td className="py-2 pr-3"><FulfillmentCell metrics={c.metrics} /></td>
                      <td className="py-2">
                        {c.existing?.isActive ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <RelationBadge type={c.existing.relationType} /> 등록됨
                          </span>
                        ) : c.existing ? (
                          <form action={restoreCompetitorAction.bind(null, productId, c.product.id, c.existing.relationType)}>
                            <button type="submit" className="text-foreground text-xs font-medium hover:underline">
                              다시 등록 (해제됨)
                            </button>
                          </form>
                        ) : (
                          <form action={addCandidateAction.bind(null, productId, c.product.id, g.keywordId)} className="flex items-center gap-1.5">
                            <RelationSelect />
                            <button type="submit" className="bg-primary text-primary-foreground rounded-md px-2 py-1 text-xs font-medium">
                              등록
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
