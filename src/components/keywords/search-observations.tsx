import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { deliveryLabel } from "@/components/products/labels";
import type { SearchObservation } from "@/lib/repositories/search-observations";

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
const BADGE: Record<string, string> = { NONE: "로켓 아님", UNKNOWN: "배지 확인 못 함" };

/**
 * 확장 프로그램으로 수집한 검색 결과 (PHASE 12). 수집 횟수별 요약 + 가장 최근 수집의 전체 칸.
 * 미등록 상품도 화면 값은 남아 있다 (관측 데이터 — JARVIS 상품이 아님).
 */
export function SearchObservations({ observations }: { observations: SearchObservation[] }) {
  if (observations.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">확장 프로그램으로 수집한 검색 결과가 없습니다.</p>;
  }
  const latest = observations[0];
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="py-2 pr-3 font-medium">수집 시각</th>
              <th className="py-2 pr-3 text-right font-medium">전체 칸</th>
              <th className="py-2 pr-3 text-right font-medium">자연</th>
              <th className="py-2 pr-3 text-right font-medium">광고</th>
              <th className="py-2 pr-3 text-right font-medium">서로 다른 상품</th>
              <th className="py-2 pr-3 text-right font-medium">등록 상품</th>
              <th className="py-2 pr-3 text-right font-medium">미등록 상품</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {observations.map((o) => (
              <tr key={o.jobId} className="border-b last:border-0">
                <td className="py-2 pr-3">{o.capturedAt ? dateTime.format(new Date(o.capturedAt)) : "-"}</td>
                <td className="py-2 pr-3 text-right">{o.total}</td>
                <td className="py-2 pr-3 text-right">{o.organic}</td>
                <td className="py-2 pr-3 text-right">{o.ads}</td>
                <td className="py-2 pr-3 text-right">{o.uniqueProducts}</td>
                <td className="py-2 pr-3 text-right">{o.registered}</td>
                <td className="py-2 pr-3 text-right">
                  {o.unregistered}
                  {o.unknown > 0 && <span className="text-muted-foreground text-xs"> (모름 {o.unknown})</span>}
                </td>
                <td className="py-2 text-right">
                  <Link href={`/import?job=${o.jobId}`} className="text-xs hover:underline">
                    수집 기록
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold">최근 수집의 검색 결과 ({latest.total}칸)</h3>
        <p className="text-muted-foreground text-xs">
          쿠팡 화면 순서대로. 순위는 자연·광고를 따로 센 값 (쿠팡 순위 배지와 같음). 미등록 상품은 순위 테이블에 저장되지 않고 수집 기록에만 남습니다.
        </p>
        <div className="max-h-[480px] overflow-auto rounded-md border">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-background sticky top-0">
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-2 py-1.5 text-right font-normal">위치</th>
                <th className="px-2 py-1.5 font-normal">순위</th>
                <th className="px-2 py-1.5 font-normal">상품</th>
                <th className="px-2 py-1.5 text-right font-normal">가격</th>
                <th className="px-2 py-1.5 text-right font-normal">리뷰</th>
                <th className="px-2 py-1.5 text-right font-normal">평점</th>
                <th className="px-2 py-1.5 font-normal">배송</th>
                <th className="px-2 py-1.5 font-normal">JARVIS</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {latest.items.map((i, n) => (
                <tr key={n} className="border-b align-top last:border-0">
                  <td className="px-2 py-1.5 text-right">{i.displayPosition ?? "-"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Badge variant={i.isAd ? "outline" : "secondary"}>{i.isAd ? "광고" : "자연"}</Badge> {i.rank ?? "-"}위
                  </td>
                  <td className="max-w-80 px-2 py-1.5">
                    {i.productId ? (
                      <Link href={`/products/${i.productId}`} className="hover:underline">
                        {i.productName ?? i.coupangProductId}
                      </Link>
                    ) : (
                      (i.productName ?? "-")
                    )}
                    <span className="text-muted-foreground ml-1">ID {i.coupangProductId ?? "-"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{i.price != null ? `${i.price.toLocaleString("ko-KR")}원` : "-"}</td>
                  <td className="px-2 py-1.5 text-right">{i.reviewCount?.toLocaleString("ko-KR") ?? "-"}</td>
                  <td className="px-2 py-1.5 text-right">{i.rating ?? "-"}</td>
                  <td className="px-2 py-1.5">{i.deliveryType ? deliveryLabel(i.deliveryType) : (BADGE[i.badge ?? ""] ?? "-")}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{i.productId ? <Badge variant="secondary">등록</Badge> : <span className="text-muted-foreground">미등록</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
