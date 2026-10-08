import Link from "next/link";

import { DataPointValue } from "@/components/common/data-point-value";
import { VerdictBadge } from "@/components/common/score-badge";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatShortDate, formatWon } from "@/lib/format";
import { LIFECYCLE_LABELS, type ProductSummary } from "@/types/product";
import type { SavedScoreView } from "@/types/score";

import { deliveryLabel } from "./labels";

export function ProductsTable({ products, scores }: { products: ProductSummary[]; scores?: Map<string, SavedScoreView> }) {
  if (products.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">표시할 상품이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1140px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">상품</th>
            <th className="py-2 pr-3 font-medium">점수</th>
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
              <td className="py-2.5 pr-3">
                <ScoreCell score={scores?.get(p.id) ?? null} />
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

/** 저장된 현재 점수 (없으면 미계산 — 데이터 부족이거나 아직 계산하지 않음) */
function ScoreCell({ score }: { score: SavedScoreView | null }) {
  if (!score) return <span className="text-muted-foreground text-xs">미계산</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1" title={`${score.scoringVersion} · ${formatShortDate(score.calculatedAt)} 계산`}>
      <span className="text-base leading-none font-bold tabular-nums">{Math.round(score.total * 100) / 100}</span>
      <VerdictBadge verdict={score.verdict} />
    </span>
  );
}
