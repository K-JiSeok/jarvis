import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ECON_ASSUMPTIONS, ECON_LABELS, type EconGrade } from "@/lib/estimate/economics";
import { REVIEW_RATE, SALES_METHOD_LABELS } from "@/lib/estimate/sales";
import type { EstimateView } from "@/lib/repositories/estimates";

import { PromoteTopForm } from "./estimate-forms";

const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const man = (n: number | null | undefined) => (n == null ? "-" : n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원` : won(n));
const num = (n: number) => n.toLocaleString("ko-KR");

/** 추정 판매 순위 (PHASE 22) + 단위 경제성 (PHASE 23) — Score V1 과 별개 · 확정 아님 · 매입 추천 아님 */
export function EstimatePanel({ rows, coupangIdOf }: { rows: EstimateView[]; coupangIdOf: Map<string, string> }) {
  const ranked = [...rows].sort((a, b) => (b.opportunity.rankKey ?? -1) - (a.opportunity.rankKey ?? -1));
  const withSales = ranked.filter((r) => r.sales.monthly);
  const without = ranked.filter((r) => !r.sales.monthly);
  // 저가(단품 비추천)는 순위 표에서 빼고 아래에 묶음 시나리오와 따로 보여 준다
  const main = withSales.filter((r) => r.economics?.grade !== "AVOID");
  const lowPrice = withSales.filter((r) => r.economics?.grade === "AVOID");
  return (
    <Card data-testid="estimate-panel">
      <CardHeader>
        <CardTitle>추정 판매 순위 (추정 · 확정 아님)</CardTitle>
        <CardDescription>
          쿠팡은 판매량을 공개하지 않아 리뷰로 추정합니다: ① 상품 페이지의 &quot;한 달간 N명 이상 구매&quot; ② 리뷰 [최신순] 최근 날짜 간격 ③ 누적 리뷰 증가. {REVIEW_RATE.basis}. 추정 월 매출 순이며 Score V1 판정과 별개입니다.
          <br />
          쓸 수 있는 원가 = 판매가 ÷ 1.1 − 쿠팡 수수료 − 로켓그로스 입출고 · 배송(극소형 가정) − 광고 {ECON_ASSUMPTIONS.adRate * 100}% − 목표 마진 {ECON_ASSUMPTIONS.targetMargin * 100}% (가정). 이 금액 안에 상품 매입가 · 운송 · 관세 · 포장이 모두 들어가야 합니다. 1,500원 미만이면 단품 판매 비추천.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {withSales.length === 0 ? (
          <p className="text-muted-foreground text-sm">판매량을 추정한 상품이 아직 없습니다 — 아래 &quot;오늘 수집할 페이지&quot;의 상품 페이지를 열고 리뷰를 [최신순]으로 바꾼 뒤 JARVIS 수집을 누르세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-xs" data-testid="estimate-table">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-1.5 font-normal">#</th>
                  <th className="py-1.5 font-normal">상품</th>
                  <th className="py-1.5 text-right font-normal">판매가</th>
                  <th className="py-1.5 text-right font-normal">추정 월 판매</th>
                  <th className="py-1.5 text-right font-normal">추정 월 매출</th>
                  <th className="py-1.5 text-right font-normal">쓸 수 있는 원가 (광고 · 마진 30% 후)</th>
                  <th className="py-1.5 font-normal">가격 구조</th>
                  <th className="py-1.5 text-right font-normal">추정 월 이익</th>
                  <th className="py-1.5 pl-3 font-normal">근거 · 신뢰도</th>
                </tr>
              </thead>
              <tbody>
                {main.map((r, i) => {
                  const m = r.sales.monthly!;
                  const e = r.economics;
                  return (
                    <tr key={r.productId} className="border-b align-top last:border-0" data-estimate={r.productId} data-econ={e?.grade}>
                      <td className="py-1.5 pr-2 tabular-nums">{i + 1}</td>
                      <td className="py-1.5 pr-2">
                        <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                          {r.productName.slice(0, 40)}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{won(r.price)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {m.min === m.max ? `${num(m.min)}개 이상` : `${num(m.min)} ~ ${num(m.max)}개`}
                        {m.min !== m.max && <div className="text-muted-foreground">가운데 {num(m.mid)}개</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                        {man(r.sales.revenue?.mid)}
                        {m.min === m.max ? " 이상" : ""}
                        {m.min !== m.max && (
                          <div className="text-muted-foreground font-normal">
                            {man(r.sales.revenue?.min)} ~ {man(r.sales.revenue?.max)}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {won(e?.single.allowedPerUnit)}
                        {e?.afterPromo && <div className="text-muted-foreground">할인 종료 후 {won(e.afterPromo.allowedPerUnit)}</div>}
                      </td>
                      <td className="py-1.5 pr-2">
                        <EconChip grade={e?.grade ?? null} />
                        {e?.bestBundle && e.grade !== "OK" && (
                          <div className="text-muted-foreground">
                            {e.bestBundle.units}개 묶음 {won(e.bestBundle.price)} → 개당 {won(e.bestBundle.allowedPerUnit)}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {r.opportunity.monthlyProfit ? `${man(r.opportunity.monthlyProfit.min)} ~ ${man(r.opportunity.monthlyProfit.max)}` : <span className="text-muted-foreground">공급 원가 없음</span>}
                      </td>
                      <td className="text-muted-foreground py-1.5 pl-3">
                        {r.sales.methods.map((x) => SALES_METHOD_LABELS[x.method]).join(" + ")} · 신뢰도 {r.sales.confidence}
                        {r.sales.nextStep && <div>{r.sales.nextStep}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {lowPrice.length > 0 && (
          <section className="space-y-1 rounded-md border border-red-200 p-2" data-testid="low-price">
            <h3 className="text-sm font-semibold">저가 상품 — 단품 판매 비추천 ({lowPrice.length})</h3>
            <p className="text-muted-foreground text-xs">
              판매가가 낮아 쿠팡 비용(로켓그로스 입출고 · 배송은 가격과 상관없이 개당 2,000원대)을 빼면 원가로 쓸 돈이 거의 없습니다. 팔린다고 남는 것이 아닙니다. 검토한다면 2 · 3개 묶음 세트로 판매가를 올리는 경우만 (묶음가 = 단품 × 개수 × 0.9 가정, 묶음 크기가 극소형을 넘으면 더 나빠짐).
            </p>
            <ul className="space-y-0.5 text-xs">
              {lowPrice.map((r) => {
                const e = r.economics!;
                return (
                  <li key={r.productId} data-low-price={r.productId}>
                    <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                      {r.productName.slice(0, 40)}
                    </Link>{" "}
                    · {won(r.price)} · 추정 월 매출 {man(r.sales.revenue?.mid)} · 단품 쓸 수 있는 원가 {won(e.single.allowedPerUnit)}
                    {e.bundles.map((b) => (
                      <span key={b.units} className={b.grade === "AVOID" ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-300"}>
                        {" "}
                        · {b.units}개 {won(b.price)} → 개당 {won(b.allowedPerUnit)} ({ECON_LABELS[b.grade]})
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="text-muted-foreground text-xs">
          판매량을 추정하지 못한 상품 {without.length}개 — 상품 페이지 리뷰 [최신순] 수집 또는 7일 뒤 재수집이 필요합니다.
          {without.length > 0 && ` 예: ${without.slice(0, 3).map((r) => r.productName.slice(0, 18)).join(" · ")}`}
        </p>
        <CollectChecklist rows={without.slice(0, 12)} coupangIdOf={coupangIdOf} />
      </CardContent>
    </Card>
  );
}

function EconChip({ grade }: { grade: EconGrade | null }) {
  if (!grade) return <span className="text-muted-foreground">-</span>;
  const tone = grade === "OK" ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : grade === "CAUTION" ? "border-amber-300 text-amber-700 dark:text-amber-300" : "border-red-300 text-red-700 dark:text-red-300";
  return <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${tone}`}>{ECON_LABELS[grade]}</span>;
}

function CollectChecklist({ rows, coupangIdOf }: { rows: EstimateView[]; coupangIdOf: Map<string, string> }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1" data-testid="collect-checklist">
      <h3 className="text-sm font-semibold">오늘 수집할 상품 페이지 (판매량 추정용)</h3>
      <p className="text-muted-foreground text-xs">링크를 열고 → 리뷰 목록에서 [최신순] → 확장 프로그램 [JARVIS 수집]. 자동으로 열거나 누르지 않습니다.</p>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.productId}>
            <a href={`https://www.coupang.com/vp/products/${coupangIdOf.get(r.productId) ?? ""}`} target="_blank" rel="noopener noreferrer" className="hover:underline" data-collect={r.productId}>
              {r.productName.slice(0, 40)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 발굴 범위 넓히기 (PHASE 22): 쌓인 키워드 후보 중 검색량 상위를 추적 키워드로 — 다음 자동 실행부터 검색량 · 연관 키워드 수집 */
export function BroadenPanel({ newCandidates, top, tracked }: { newCandidates: number; top: { keyword: string; volume: number | null }[]; tracked: { keyword: string; lastCollected: string | null }[] }) {
  return (
    <Card data-testid="broaden-panel">
      <CardHeader>
        <CardTitle>발굴 범위 넓히기</CardTitle>
        <CardDescription>
          대기 중인 키워드 후보 {newCandidates.toLocaleString("ko-KR")}개 (네이버 검색광고 연관 키워드 — 네이버 검색 수요 참고, 쿠팡 검색량 아님). 일괄 등록은 브랜드 키워드 · 월 10만 이상 한 단어(너무 넓음)를 건너뜁니다. 추적 키워드로 등록하면 다음 자동 실행부터 검색량 · 연관 키워드를 모으고, 쿠팡 검색
          결과를 열어 수집하면 상품이 자동 등록됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p>검색량 상위 후보: {top.map((t) => `${t.keyword} (${t.volume?.toLocaleString("ko-KR") ?? "-"})`).join(" · ") || "없음"}</p>
        <PromoteTopForm />
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">오늘 열어 볼 쿠팡 검색 (추적 키워드)</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {tracked.map((t) => (
              <li key={t.keyword}>
                <a href={`https://www.coupang.com/np/search?q=${encodeURIComponent(t.keyword)}`} target="_blank" rel="noopener noreferrer" className="hover:underline" data-search-keyword={t.keyword}>
                  {t.keyword}
                </a>{" "}
                <span className="text-muted-foreground">— 마지막 수집 {t.lastCollected ?? "없음"}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">검색 결과에서 확장 프로그램 [JARVIS 수집] → 순위 · 리뷰 수가 저장되고, 미등록 상품은 다음 자동 실행에서 등록됩니다. 매일 같은 검색을 수집하면 리뷰 증가로 판매 추정이 정확해집니다.</p>
        </section>
      </CardContent>
    </Card>
  );
}
