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
        {todays.length === 0 && <PicksMissingNotice today={today} lastDate={past[0]?.pickDate ?? null} />}
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

/** PHASE 25: 오늘 추천이 없으면 이유 후보를 알려 준다 (예약 작업은 이 PC · Claude 앱 · DB 가 모두 켜져 있어야 돈다) */
function PicksMissingNotice({ today, lastDate }: { today: string; lastDate: string | null }) {
  const days = lastDate ? Math.round((Date.parse(today) - Date.parse(lastDate)) / 86_400_000) : null;
  return (
    <div role="status" data-testid="picks-missing" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="font-medium">
        오늘({today}) 추천이 아직 없습니다{days != null ? ` — 마지막 추천 ${lastDate} (${days}일 전)` : ""}.
      </p>
      {days != null && days >= 2 ? (
        <ul className="mt-1 list-disc pl-5">
          <li>오전 8시 무렵 이 PC와 Claude 앱이 켜져 있었는지</li>
          <li>Claude 앱 사이드바 &quot;Scheduled&quot;의 &quot;JARVIS 매일 오전 상품 3개 추천&quot; 실행 기록에 오류가 있는지 (프로젝트 폴더를 옮겼다면 작업 안의 경로도 바꿔야 함)</li>
          <li>Supabase 프로젝트가 일시정지되지 않았는지 (무료 플랜은 오래 쓰지 않으면 멈춤)</li>
        </ul>
      ) : (
        <p className="mt-1">오전 8시 이후 PC와 Claude 앱을 켜면 놓친 추천이 바로 실행됩니다.</p>
      )}
    </div>
  );
}
