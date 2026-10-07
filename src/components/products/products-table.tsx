import Link from "next/link";

import { DataPointValue } from "@/components/common/data-point-value";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatShortDate, formatWon } from "@/lib/format";
import { LIFECYCLE_LABELS, type ProductSummary } from "@/types/product";

import { deliveryLabel } from "./labels";

export function ProductsTable({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">표시할 상품이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">상품</th>
            <th className="py-2 pr-3 font-medium">카테고리</th>
            <th className="py-2 pr-3 text-right font-medium">가격</th>
            <th className="py-2 pr-3 text-right font-medium">리뷰</th>
            <th className="py-2 pr-3 text-right font-medium">평점</th>
            <th className="py-2 pr-3 text-right font-medium">카테고리 순위</th>
            <th className="py-2 pr-3 font-medium">키워드 순위</th>
            <th className="py-2 pr-3 font-medium">배송</th>
            <th className="py-2 pr-3 font-medium">최근 수집</th>
            <th className="py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b align-top last:border-0">
              <td className="max-w-[260px] py-2.5 pr-3">
                <Link href={`/products/${p.id}`} className="line-clamp-2 font-medium hover:underline">
                  {p.productName}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {p.brand ?? "브랜드 -"} · ID {p.coupangProductId}
                </span>
              </td>
              <td className="text-muted-foreground py-2.5 pr-3 text-xs">{p.category?.path ?? p.category?.name ?? "-"}</td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={p.metrics.price} format={formatWon} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={p.metrics.reviewCount} format={formatNumber} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={p.metrics.rating} format={(v) => v.toFixed(1)} className="items-end" />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <DataPointValue point={p.metrics.categoryRank} format={(v) => `${formatNumber(v)}위`} className="items-end" />
              </td>
              <td className="py-2.5 pr-3">
                {p.topKeywordRank ? (
                  <span className="inline-flex flex-col gap-0.5">
                    <span>
                      <span className="tabular-nums">{p.topKeywordRank.rank}위</span>
                      <span className="text-muted-foreground"> · {p.topKeywordRank.keyword}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <SourceBadge source={p.topKeywordRank.source} confidence={p.topKeywordRank.confidence} />
                      <span className="text-muted-foreground text-[10px] leading-none">{formatShortDate(p.topKeywordRank.capturedOn)}</span>
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </td>
              <td className="py-2.5 pr-3">
                <DataPointValue point={p.metrics.deliveryType} format={deliveryLabel} />
              </td>
              <td className="py-2.5 pr-3 text-xs tabular-nums">{formatShortDate(p.latestCapturedOn)}</td>
              <td className="py-2.5">
                <Badge variant={p.lifecycleStatus === "ACTIVE" ? "secondary" : "outline"}>{LIFECYCLE_LABELS[p.lifecycleStatus]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
