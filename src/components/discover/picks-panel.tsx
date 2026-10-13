import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyPick } from "@/lib/repositories/picks";

import { PickButtons } from "./picks-forms";

const won = (n: unknown) => (typeof n === "number" ? `${Math.round(n).toLocaleString("ko-KR")}원` : "-");
const man = (n: unknown) => (typeof n === "number" ? (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원` : won(n)) : "-");
const STATUS = { NEW: "답 안 함", SHORTLISTED: "후보로 선택함", DISMISSED: "관심 없음" } as const;

/** 오늘의 추천 (PHASE 24) — 매일 오전 8시 예약 작업(Claude)이 고른 3개. 추천이지 매입 결정이 아니다 */
export function PicksPanel({ picks, today }: { picks: DailyPick[]; today: string }) {
  const todays = picks.filter((p) => p.pickDate === today);
  const past = picks.filter((p) => p.pickDate !== today);
  const latest = todays.length ? todays : past.filter((p) => p.pickDate === past[0]?.pickDate);
  return (
    <Card data-testid="picks-panel">
      <CardHeader>
        <CardTitle>오늘의 추천 {todays.length ? `(${today})` : latest.length ? `— 최근 추천 ${latest[0].pickDate}` : ""}</CardTitle>
        <CardDescription>
          매일 오전 8시에 Claude가 수집된 데이터(추정 판매량 · 가격 구조 · 판매 가능성 · 단계)로 상품 3개를 고르고 근거 · 위험 · 소싱 가이드를 남깁니다. 수치는 추정이며 매입 결정이 아닙니다. 이 PC와 Claude 앱이 켜져 있어야 실행됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {latest.length === 0 ? (
          <p className="text-muted-foreground text-sm">아직 추천이 없습니다 — 첫 추천은 다음 오전 8시에 만들어집니다.</p>
        ) : (
          latest.map((p) => {
            const m = p.metrics as { price?: number; monthlySales?: { min: number; mid: number; max: number }; revenueMid?: number; allowedCost?: number; grade?: string };
            return (
              <article key={p.id} className="space-y-1 rounded-md border p-3 text-sm" data-pick={p.rank} data-pick-status={p.status}>
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/products/${p.productId}`} className="font-semibold hover:underline">
                    {p.rank}. {p.title}
                  </Link>
                  <span className="text-muted-foreground text-xs">{STATUS[p.status]}</span>
                </header>
                <p className="text-muted-foreground text-xs">
                  판매가 {won(m.price)} · 추정 월 판매 {m.monthlySales ? (m.monthlySales.min === m.monthlySales.max ? `${m.monthlySales.min.toLocaleString("ko-KR")}개 이상` : `${m.monthlySales.min.toLocaleString("ko-KR")}~${m.monthlySales.max.toLocaleString("ko-KR")}개`) : "-"} · 추정 월 매출 {man(m.revenueMid)} · 쓸 수 있는 원가 {won(m.allowedCost)} {m.grade ? `· ${m.grade}` : ""}
                </p>
                <p className="whitespace-pre-line">{p.reason}</p>
                {p.risks.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
                    {p.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                {(p.sourcing.targetCost != null || p.sourcing.searchTerms?.length) && (
                  <p className="text-xs">
                    소싱 가이드: 개당 도착 원가 {won(p.sourcing.targetCost)} 이하
                    {p.sourcing.searchTerms?.length ? ` · 1688 검색어 ${p.sourcing.searchTerms.join(" / ")}` : ""}
                    {p.sourcing.bundle ? ` · ${p.sourcing.bundle}` : ""}
                    {p.sourcing.note ? ` · ${p.sourcing.note}` : ""}
                  </p>
                )}
                {p.status === "NEW" && <PickButtons pickId={p.id} />}
              </article>
            );
          })
        )}
        {past.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">지난 추천 ({past.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {past.map((p) => (
                <li key={p.id}>
                  {p.pickDate} {p.rank}. {p.title.slice(0, 40)} — {STATUS[p.status]}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
