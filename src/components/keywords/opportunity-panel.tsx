import Link from "next/link";

import { setTrackingAction } from "@/app/keywords/actions";
import { VerdictBadge } from "@/components/common/score-badge";
import { CandidateActions } from "@/components/discover/automation-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KW_OPPORTUNITY_RULES, KW_STAGE_LABELS, QUEUE_SKIP_LABELS, type KwStage, type QueueSkip } from "@/lib/discover/keyword-opportunity";
import type { KeywordOpportunityRow, QueueRow } from "@/lib/repositories/keyword-opportunity";
import { cn } from "@/lib/utils";

const STAGE_STYLE: Record<KwStage, string> = {
  JUDGEABLE: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  WAIT_SALES: "border-sky-300 text-sky-700 dark:text-sky-300",
  NEED_SEARCH: "border-amber-300 text-amber-700 dark:text-amber-300",
  STALE: "border-amber-300 text-amber-700 dark:text-amber-300",
  POOR_MARKET: "border-red-300 text-red-700 dark:text-red-300",
};

const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("ko-KR"));
const short = (d: string | null) => (d ? d.slice(5).replace("-", ".") : "-");

/** 키워드 기회 (PHASE 29): 추적 키워드마다 시장 점수 · 시즌 · 수집 상태 · 다음 할 일 */
export function KeywordOpportunityCard({ items, asOf }: { items: KeywordOpportunityRow[]; asOf: string }) {
  const count = (s: KwStage) => items.filter((i) => i.stage === s).length;
  return (
    <Card data-testid="keyword-opportunity">
      <CardHeader>
        <CardTitle>키워드 기회 (추적 {items.length}개)</CardTitle>
        <CardDescription>
          시장 점수 = 판정 V2 의 시장 부분 (수요 · 리뷰 장벽 · 판매자 구성 · 광고 부담). 상품 판정은 상품 발굴 화면과 같은 계산이고 공급 원가는 넣지 않았습니다.
          {" "}판정 가능 {count("JUDGEABLE")} · 판매 추정 대기 {count("WAIT_SALES")} · 수집 필요 {count("NEED_SEARCH") + count("STALE")} · 시장 부적합 {count("POOR_MARKET")} ({asOf} 기준)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">추적 중인 키워드가 없습니다. 아래 수집 대기열에서 등록하세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">키워드</th>
                  <th className="py-2 pr-3 text-right font-medium">월 검색량</th>
                  <th className="py-2 pr-3 text-right font-medium">시장 점수</th>
                  <th className="py-2 pr-3 font-medium">시장 근거</th>
                  <th className="py-2 pr-3 font-medium">수집</th>
                  <th className="py-2 pr-3 text-right font-medium">판매 추정</th>
                  <th className="py-2 pr-3 text-right font-medium">인증 필요</th>
                  <th className="py-2 pr-3 font-medium">최고 판정</th>
                  <th className="py-2 font-medium">상태 · 다음 할 일</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.keywordId} className="border-b align-top last:border-0" data-stage={o.stage}>
                    <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                      <Link href={`/discover?kw=${o.keywordId}`} className="hover:underline">
                        {o.keyword}
                      </Link>
                      {o.season?.group && <div className="text-muted-foreground font-normal">{o.season.group.label} 시즌</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {n(o.searchVolume)}
                      {o.season?.spike && <div className="text-amber-700 dark:text-amber-300">급증 +{Math.round(o.season.spike.ratio * 100)}%</div>}
                    </td>
                    <td className={cn("py-2.5 pr-3 text-right text-sm font-bold tabular-nums", o.marketScore != null && o.marketScore < KW_OPPORTUNITY_RULES.poorMarketScore && "text-red-700 dark:text-red-300")}>
                      {o.marketScore ?? "-"}
                    </td>
                    <td className="text-muted-foreground max-w-[260px] py-2.5 pr-3">
                      {o.marketParts.map((p) => (
                        <div key={p.part}>
                          {p.label} {p.score ?? "-"} · {p.basis}
                        </div>
                      ))}
                      {o.marketRisks.map((r) => (
                        <div key={r} className="text-red-700 dark:text-red-300">
                          {r}
                        </div>
                      ))}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">
                      마지막 {short(o.lastCollectedOn)}
                      {o.regatherOn && <div className="text-sky-700 dark:text-sky-300">재수집 {short(o.regatherOn)}~</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {o.salesCount}/{o.productCount}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{o.certRatio == null ? "-" : `${Math.round(o.certRatio * 100)}%`}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {o.best ? (
                        <span className="flex items-center gap-1">
                          <VerdictBadge verdict={o.best.verdict} />
                          <span className="tabular-nums">{o.best.total}</span>
                        </span>
                      ) : (
                        "-"
                      )}
                      {o.productCount > 0 && (
                        <div className="text-muted-foreground">
                          검토 {o.verdicts.REVIEW} · 제외 {o.verdicts.EXCLUDE} · 보류 {o.verdicts.NONE}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[300px] py-2.5">
                      <Badge variant="outline" className={STAGE_STYLE[o.stage]}>
                        {KW_STAGE_LABELS[o.stage]}
                      </Badge>
                      <p className="text-muted-foreground mt-1">{o.nextAction}</p>
                      {o.stage === "POOR_MARKET" && (
                        <form action={setTrackingAction.bind(null, o.keywordId, false)} className="mt-1">
                          <button type="submit" className="text-red-700 underline dark:text-red-300">
                            추적 중지
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
      </CardContent>
    </Card>
  );
}

/** 수집 대기열 (PHASE 29): 쿠팡 검색 결과가 없는 키워드 후보를 네이버 데이터 · 단어로 먼저 걸러 순서를 매긴다 */
export function CollectionQueueCard({ items, skipped, total, freeSlots }: { items: QueueRow[]; skipped: Partial<Record<QueueSkip, number>>; total: number; freeSlots: number }) {
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <Card data-testid="collection-queue">
      <CardHeader>
        <CardTitle>수집 대기열</CardTitle>
        <CardDescription>
          대기 중인 키워드 후보 {n(total)}개(월 검색량 3,000 이상) 중 {n(skippedTotal)}개를 걸렀습니다. [추적 키워드로 등록]하면 다음 자동 수집(주 1회 · 최대 {KW_OPPORTUNITY_RULES.collectSlots}개, 아직 수집 안 한 키워드부터)이 쿠팡 검색 결과를 모읍니다.
          {" "}지금 남은 자동 수집 칸: <b>{freeSlots}개</b>. 점수는 수집 순서일 뿐 판정이 아닙니다 (월 검색량 60% · 네이버 광고 경쟁 40%).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">대기열이 비었습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">키워드</th>
                  <th className="py-2 pr-3 text-right font-medium">점수</th>
                  <th className="py-2 pr-3 font-medium">근거</th>
                  <th className="py-2 pr-3 font-medium">발견 출처</th>
                  <th className="py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((q) => (
                  <tr key={q.id} className="border-b align-top last:border-0">
                    <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{q.keyword}</td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{q.score}</td>
                    <td className="text-muted-foreground py-2.5 pr-3">{q.notes.join(" · ")}</td>
                    <td className="text-muted-foreground py-2.5 pr-3 whitespace-nowrap">{q.seedKeyword ? `"${q.seedKeyword}" 연관` : "-"}</td>
                    <td className="py-2.5">
                      <CandidateActions id={q.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {skippedTotal > 0 && (
          <p className="text-muted-foreground text-xs">
            거른 이유:{" "}
            {(Object.entries(skipped) as [QueueSkip, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${QUEUE_SKIP_LABELS[k]} ${v}`)
              .join(" · ")}
            . 걸러진 후보도 상품 발굴 화면의 키워드 후보 목록에서 직접 등록할 수 있습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
