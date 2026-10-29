import type { Metadata } from "next";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { REVIEW_RATE } from "@/lib/estimate/sales";
import { getValidationReport } from "@/lib/repositories/validation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { VALIDATION_RULES } from "@/lib/validation/engine";
import { cn } from "@/lib/utils";

const nav = findNavItem("/validation")!;

export const metadata: Metadata = { title: "판정 검증" };

const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("ko-KR"));
const pct = (v: number | null | undefined, digits = 0) => (v == null ? "-" : `${(v * 100).toFixed(digits)}%`);
const VERDICT: Record<string, string> = { STRONG_BUY: "강력추천", REVIEW: "검토", EXCLUDE: "제외" };

export default async function ValidationPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/validation" configured={isSupabaseConfigured()} />
      </>
    );
  }
  const r = await getValidationReport();
  const s = r.summary;
  const evaluated = r.rows.filter((x) => x.status === "EVALUATED");

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <Card data-testid="validation-summary">
        <CardHeader>
          <CardTitle>판매 추정이 맞았나 — 지금 할 수 있는 검증 3가지</CardTitle>
          <CardDescription>
            쿠팡은 판매량을 공개하지 않습니다. 그래서 이 화면의 결론은 &quot;추정이 맞다&quot;가 아니라 &quot;추정과 어긋난 증거가 있는가&quot;입니다. 자동 발굴이 매일 돌 때 추적 키워드 상품의 판정 · 판매
            추정을 검색 결과 수집일마다 한 번씩 기록하고(수정 불가), 다음 수집 뒤 비교합니다. ({r.asOf} 기준 · 예측 {n(s.predictions)}개{r.firstPredictionOn ? ` · 첫 기록 ${r.firstPredictionOn}` : ""}
            {r.modelVersions.length ? ` · ${r.modelVersions.join(", ")}` : ""})
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <section className="space-y-1 rounded-md border p-3">
            <h3 className="font-semibold">1. 지속성 (리뷰 증가)</h3>
            {s.persistence.n ? (
              <>
                <p className="text-2xl font-bold tabular-nums">{pct(s.persistence.withinRate)}</p>
                <p className="text-muted-foreground text-xs">
                  확인 {s.persistence.n}개 중 다음 {VALIDATION_RULES.minDays}~{VALIDATION_RULES.maxDays}일 판매(리뷰 증가 ÷ {pct(REVIEW_RATE.mid)})가 예측 범위 안. 관찰 ÷ 예측 중앙값 {s.persistence.medianRatio ?? "-"} · 절반 미만으로
                  떨어진 상품 {s.persistence.dropCount}개
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">아직 없음 — 예측 뒤 {VALIDATION_RULES.minDays}일 이상 지나 다시 수집해야 합니다 (다음 자동 수집 뒤).</p>
            )}
            <p className="text-muted-foreground text-xs">같은 작성률 가정을 쓰므로 정확도가 아니라 &quot;다음 달에도 그만큼 팔리나(시즌 · 유행 하락)&quot;를 봅니다.</p>
          </section>
          <section className="space-y-1 rounded-md border p-3">
            <h3 className="font-semibold">2. 쿠팡 표시 하한</h3>
            {s.badge.n ? (
              <>
                <p className="text-2xl font-bold tabular-nums">
                  과소 {s.badge.under}/{s.badge.n}
                </p>
                <p className="text-muted-foreground text-xs">&quot;한 달간 N명 이상 구매&quot;가 예측 최대값보다 큰 상품 수. 하한이라 과대 추정은 이것으로 증명할 수 없습니다.</p>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">예측 기간 안에 본 표시 하한이 없습니다 (상품 페이지를 수집해야 보입니다).</p>
            )}
          </section>
          <section className="space-y-1 rounded-md border p-3">
            <h3 className="font-semibold">3. 내 상품 실제 판매</h3>
            <p className="text-2xl font-bold tabular-nums">{r.own.listings ? `${r.own.listings}개 상품` : "판매 전"}</p>
            <p className="text-muted-foreground text-xs">
              유일하게 리뷰 작성률을 직접 잴 수 있는 검증입니다. 내 상품 판매를 시작하면 판매 기록(my_listings · sales_results, 지금 {n(r.own.salesRows)}행)과 같은 상품의 리뷰 수로 작성률을 계산해 가정(
              {pct(REVIEW_RATE.low)}~{pct(REVIEW_RATE.high)})을 고칩니다.
            </p>
          </section>
        </CardContent>
      </Card>

      <Card data-testid="review-rate-bounds">
        <CardHeader>
          <CardTitle>리뷰 작성률 상한 (쿠팡 표시 하한 + 같은 시기 리뷰 증가)</CardTitle>
          <CardDescription>
            실제 구매자 ≥ 표시 하한이므로 실제 작성률 ≤ 월 리뷰 수 ÷ 하한. 가정 범위 {pct(REVIEW_RATE.low)}~{pct(REVIEW_RATE.high)} 와 비교합니다. 상한이 {pct(REVIEW_RATE.high)} 미만이면 추정 최소값(÷{pct(REVIEW_RATE.high)})은 실제보다
            작습니다 — 보수적인 쪽이라 문제가 아닙니다. {pct(REVIEW_RATE.low)} 미만이면 추정 최대값조차 작다는 뜻입니다. 상한이 {pct(REVIEW_RATE.high)} 이상이면 이 자료로는 판단할 수 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r.rateBounds.length === 0 ? (
            <p className="text-muted-foreground text-sm">표시 하한과 7일 이상 리뷰 증가가 함께 있는 상품이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="py-2 pr-3 font-medium">상품</th>
                    <th className="py-2 pr-3 text-right font-medium">표시 하한 (월)</th>
                    <th className="py-2 pr-3 text-right font-medium">월 리뷰 수</th>
                    <th className="py-2 text-right font-medium">작성률 상한</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rateBounds.map((b) => (
                    <tr key={b.productId} className="border-b last:border-0">
                      <td className="py-2 pr-3">{b.name?.slice(0, 40) ?? b.productId.slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(b.floor)}명 이상</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(b.monthlyReviews)}</td>
                      <td className={cn("py-2 text-right font-semibold tabular-nums", b.upper < REVIEW_RATE.low ? "text-red-700 dark:text-red-300" : b.upper < REVIEW_RATE.high ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                        {pct(b.upper, 1)} 이하
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="validation-rows">
        <CardHeader>
          <CardTitle>예측 기록 ({n(s.predictions)}개 · 확인 {n(s.evaluated)} · 대기 {n(s.pending)})</CardTitle>
          <CardDescription>확인된 것을 먼저 보여 줍니다 (관찰 ÷ 예측 큰 순). 예측은 수정할 수 없어 나중에 판정 엔진을 바꿔도 그때 무엇을 말했는지 남습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {r.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">아직 예측 기록이 없습니다. 자동 발굴이 다음에 돌 때 기록을 시작합니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="py-2 pr-3 font-medium">기준일</th>
                    <th className="py-2 pr-3 font-medium">상품</th>
                    <th className="py-2 pr-3 font-medium">판정</th>
                    <th className="py-2 pr-3 text-right font-medium">예측 월 판매</th>
                    <th className="py-2 font-medium">확인 결과</th>
                  </tr>
                </thead>
                <tbody>
                  {(evaluated.length ? r.rows.slice(0, 200) : r.rows.slice(0, 50)).map((x) => (
                    <tr key={`${x.productId}:${x.start}`} className="border-b align-top last:border-0" data-status={x.status}>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{x.start}</td>
                      <td className="py-2 pr-3">
                        {x.name?.slice(0, 36) ?? x.productId.slice(0, 8)}
                        {x.keyword && <div className="text-muted-foreground">{x.keyword}</div>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{x.verdict ? VERDICT[x.verdict] ?? x.verdict : "보류"}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                        {n(x.sales.min)}~{n(x.sales.max)}
                      </td>
                      <td className={cn("py-2", x.status === "EVALUATED" ? (x.persistence && !x.persistence.within) || x.badge?.under ? "text-amber-800 dark:text-amber-200" : "" : "text-muted-foreground")}>{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
