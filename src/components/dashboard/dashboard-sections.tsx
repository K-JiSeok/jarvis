import Link from "next/link";

import { VerdictBadge } from "@/components/common/score-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pickReasons, type ScoreSummary } from "@/lib/dashboard/aggregate";
import { formatNumber, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, VERDICTS, type Verdict } from "@/types/common";
import type { DashboardData, DashboardProductRef } from "@/types/dashboard";
import type { SavedScoreView } from "@/types/score";
import { WATCHLIST_STATUS_LABELS } from "@/types/watchlist";

const score2 = (n: number) => String(Math.round(n * 100) / 100);
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

const VERDICT_BAR: Record<Verdict | "NONE", string> = {
  STRONG_BUY: "bg-emerald-500",
  REVIEW: "bg-sky-500",
  EXCLUDE: "bg-zinc-400",
  NONE: "bg-amber-300 dark:bg-amber-500/60",
};

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-4 text-center text-sm">{children}</p>;
}

function ScoreInline({ score }: { score: SavedScoreView | null }) {
  if (!score) return <span className="text-muted-foreground text-xs">미계산</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <strong className="tabular-nums">{score2(score.total)}</strong>
      <VerdictBadge verdict={score.verdict} />
    </span>
  );
}

// ① 전체 현황 ------------------------------------------------------------------------

export function KpiGrid({ data }: { data: DashboardData }) {
  const s = data.summary;
  const items: { label: string; value: number; href: string; hint?: string; tone?: string }[] = [
    { label: "등록 상품", value: s.products, href: "/products", hint: data.deletedProducts ? `삭제·판매 종료 ${data.deletedProducts}개 제외` : undefined },
    { label: "분석 완료", value: s.scored, href: "/products", hint: "저장된 현재 점수" },
    { label: "미계산", value: s.unscored, href: "/products?verdict=NONE", tone: "text-amber-700 dark:text-amber-300" },
    { label: "강력추천", value: s.byVerdict.STRONG_BUY, href: "/products?verdict=STRONG_BUY", tone: "text-emerald-700 dark:text-emerald-300" },
    { label: "검토", value: s.byVerdict.REVIEW, href: "/products?verdict=REVIEW", tone: "text-sky-700 dark:text-sky-300" },
    { label: "제외", value: s.byVerdict.EXCLUDE, href: "/products?verdict=EXCLUDE" },
    { label: "관심상품", value: data.watchingCount, href: "/watchlist?status=WATCHING", hint: "관심 등록(WATCHING)" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {items.map((i) => (
        <Link key={i.label} href={i.href} className="hover:bg-accent/50 rounded-xl border px-4 py-3 transition-colors">
          <p className="text-muted-foreground text-xs">{i.label}</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", i.tone)}>{formatNumber(i.value)}</p>
          {i.hint && <p className="text-muted-foreground mt-0.5 text-[11px]">{i.hint}</p>}
        </Link>
      ))}
    </div>
  );
}

export function ScoreDistribution({ summary }: { summary: ScoreSummary }) {
  const rows = [
    ...VERDICTS.map((v) => ({ key: v as Verdict | "NONE", label: VERDICT_LABELS[v], count: summary.byVerdict[v], href: `/products?verdict=${v}` })),
    { key: "NONE" as const, label: "미계산", count: summary.unscored, href: "/products?verdict=NONE" },
  ];
  const total = summary.products;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Opportunity Score 현황</CardTitle>
        <CardDescription>상품별 현재 점수 기준 (Scoring v1). 미계산 = 저장된 점수가 없는 상품 — 제외로 치지 않습니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <Empty>아직 등록된 상품이 없습니다.</Empty>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full border" role="img" aria-label="점수 판정 분포">
              {rows.map((r) =>
                r.count > 0 ? <div key={r.key} className={VERDICT_BAR[r.key]} style={{ width: `${(r.count / total) * 100}%` }} title={`${r.label} ${r.count}`} /> : null,
              )}
            </div>
            <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {rows.map((r) => (
                <li key={r.key}>
                  <Link href={r.href} className="hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1.5">
                    <span className={cn("size-2.5 shrink-0 rounded-full", VERDICT_BAR[r.key])} />
                    <span className="text-sm whitespace-nowrap">{r.label}</span>
                    <span className="ml-auto font-semibold tabular-nums">{r.count}</span>
                    <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{Math.round((r.count / total) * 100)}%</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ② 좋은 상품 ------------------------------------------------------------------------

export function Recommendations({ items, hasScores }: { items: DashboardData["recommendations"]; hasScores: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>추천 상품</CardTitle>
        <CardDescription>강력추천 전체 → 검토 순, 각각 점수 높은 순. 근거는 점수 저장 당시 기록 그대로입니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty>
            {hasScores ? (
              "강력추천·검토 판정을 받은 상품이 없습니다."
            ) : (
              <>
                아직 계산된 Opportunity Score가 없습니다.
                <br />
                상품 상세에서 점수를 계산해보세요.
              </>
            )}
          </Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((s) => (
              <li key={s.id}>
                <Link href={`/products/${s.productId}#score`} className="hover:bg-accent/40 block h-full space-y-2 rounded-lg border p-4 transition-colors">
                  <p className="line-clamp-2 font-medium break-keep">{s.productName}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl leading-none font-bold tabular-nums">{score2(s.total)}</span>
                    <span className="text-muted-foreground text-xs">/ 100</span>
                    <VerdictBadge verdict={s.verdict} />
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {pickReasons(s.reasons).map((r, i) => (
                      <li key={i} className={r.kind === "POSITIVE" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        {r.kind === "POSITIVE" ? "✓" : "⚠"} {r.message}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-[11px]">
                    {formatShortDate(s.calculatedAt)} 계산 · 키워드 {s.keyword ?? "없음"} · 신뢰도 {s.dataConfidence ?? "-"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ③ 분석 상태 ------------------------------------------------------------------------

export function DataStatus({ quality, freshness }: { quality: DashboardData["quality"]; freshness: DashboardData["freshness"] }) {
  const fresh: [string, string | null][] = [
    ["키워드 데이터", freshness.keyword],
    ["상품 데이터", freshness.product],
    ["가격 데이터", freshness.price],
    ["키워드 순위", freshness.rank],
    ["점수 계산", freshness.score],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>분석 데이터 상태</CardTitle>
        <CardDescription>
          상품마다 현재 데이터로 점수 엔진을 돌려 9개 항목이 모두 계산되는지 확인합니다 (저장하지 않음)
          {quality.truncated && ` · 최근 등록 ${quality.limit}개까지만`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          {quality.checked === 0 ? (
            <Empty>분석할 상품이 없습니다.</Empty>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">점수 계산 가능</dt>
                  <dd className="text-xl font-bold tabular-nums">{quality.computable}</dd>
                  {quality.computableUnsaved > 0 && <dd className="text-[11px] text-sky-700 dark:text-sky-300">그중 {quality.computableUnsaved}개 아직 저장 안 함</dd>}
                </div>
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">분석 데이터 부족</dt>
                  <dd className="text-xl font-bold text-amber-700 tabular-nums dark:text-amber-300">{quality.insufficient}</dd>
                </div>
              </dl>
              {quality.missing.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">주요 부족 데이터 (해당 항목을 계산할 수 없는 상품 수)</p>
                  <ul className="space-y-1">
                    {quality.missing.map((m) => (
                      <li key={m.factor} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-28 shrink-0">{m.label}</span>
                          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                            <div className="h-full bg-amber-400" style={{ width: `${(m.count / quality.checked) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right tabular-nums">{m.count}</span>
                        </div>
                        {m.need && <p className="text-muted-foreground pl-30 text-[11px]">필요: {m.need}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">최근 데이터 (가장 최근 수집일)</p>
          <dl className="divide-y rounded-md border text-sm">
            {fresh.map(([label, value]) => (
              <div key={label} className="flex justify-between px-3 py-1.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value ? (value.length > 10 ? dateTime.format(new Date(value)) : value) : "-"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-[11px]">제외 처리된 스냅샷은 빼고 셉니다. 자동 수집은 아직 없습니다 (직접 입력한 날짜).</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ④ 최근 활동 ------------------------------------------------------------------------

export function RecentActivity({ products, scores }: { products: DashboardProductRef[]; scores: DashboardData["recentScores"] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>최근 등록 상품</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <Empty>등록된 상품이 없습니다.</Empty>
          ) : (
            <ul className="divide-y">
              {products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <Link href={`/products/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {p.productName}
                  </Link>
                  <ScoreInline score={p.score} />
                  <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{formatShortDate(p.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>최근 분석 상품</CardTitle>
        </CardHeader>
        <CardContent>
          {scores.length === 0 ? (
            <Empty>계산된 점수가 없습니다.</Empty>
          ) : (
            <ul className="divide-y">
              {scores.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <Link href={`/products/${s.productId}#score`} className="min-w-0 flex-1 truncate hover:underline">
                    {s.productName}
                  </Link>
                  <ScoreInline score={s} />
                  <span className="text-muted-foreground w-28 text-right text-xs tabular-nums">{dateTime.format(new Date(s.calculatedAt))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ⑤ 관심상품 -------------------------------------------------------------------------

export function WatchingList({ items, total }: { items: DashboardData["watching"]; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>관심상품</CardTitle>
        <CardDescription>
          {WATCHLIST_STATUS_LABELS.WATCHING} 상태 {total}개 (최근 변경 순{total > items.length ? `, ${items.length}개 표시` : ""}).{" "}
          <Link href="/watchlist" className="underline">
            전체 보기
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty>관심 등록한 상품이 없습니다. 상품 상세에서 관심상품으로 등록할 수 있습니다.</Empty>
        ) : (
          <ul className="divide-y">
            {items.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Link href={`/products/${w.productId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {w.productName}
                </Link>
                <ScoreInline score={w.score} />
                <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{formatShortDate(w.statusChangedAt)}</span>
                {w.memo && <p className="text-muted-foreground w-full truncate text-xs">{w.memo}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
