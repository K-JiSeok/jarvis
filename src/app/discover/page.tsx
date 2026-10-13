import type { Metadata } from "next";
import Link from "next/link";

import { DataPointValue } from "@/components/common/data-point-value";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { AutomationPanel } from "@/components/discover/automation-panel";
import { StagePanel, type ScopeItem } from "@/components/discover/stage-panel";
import { productStage, stageCounts } from "@/lib/discover/stage";
import { loadStageRows } from "@/lib/repositories/stage";
import { DiscoverProductCard } from "@/components/discover/discover-product-card";
import { ReadinessList } from "@/components/discover/readiness-list";
import { NAVER_PROXY_NOTE } from "@/components/keywords/naver-volume-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { keywordReadiness } from "@/lib/discover/readiness";
import { discoverStatus, shortageReasons, sortForDiscover } from "@/lib/discover/summary";
import { formatNumber, formatPercent, formatWon } from "@/lib/format";
import { naverSearchAdConfig } from "@/lib/ingest/naver-searchad";
import { listAutomationRuns, listCompliance, listKeywordCandidates } from "@/lib/repositories/automation";
import { DISCOVER_MAX_PRODUCTS, getDiscoverAnalysis } from "@/lib/repositories/discover";
import { loadDetails } from "@/lib/repositories/costs";
import { listSourcing } from "@/lib/repositories/sourcing";
import { listKeywords } from "@/lib/repositories/keywords";
import { listProducts } from "@/lib/repositories/products";
import { listNaverStatus } from "@/lib/repositories/naver-status";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const nav = findNavItem("/discover")!;
export const metadata: Metadata = { title: "상품 발굴" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

/*
 * 상품 발굴 (PHASE 15): 키워드 선택 → 연결된 등록 상품 (검색 순위 · 경쟁 관계 · 관심상품, 중복 제거)
 *   → 상품마다 Score Engine V1 미리 보기 + 대표 수익성 시나리오 + 위험 + 부족한 데이터
 * 최종 판정은 9개 요소가 모두 계산될 때만 (기존 V1). 일부만 있으면 "잠정 분석"으로 따로 표시. 점수는 저장하지 않는다.
 */
export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/discover" configured={isSupabaseConfigured()} />
      </>
    );
  }
  const sp = await searchParams;
  const kw = typeof sp.kw === "string" && UUID.test(sp.kw) ? sp.kw : null;
  const naverConfigured = naverSearchAdConfig() != null;
  const [keywords, naverStatus, analysis, runs, candidates, compliance, allProducts] = await Promise.all([
    listKeywords(),
    listNaverStatus(),
    kw ? getDiscoverAnalysis(kw) : null,
    listAutomationRuns(5),
    listKeywordCandidates({ limit: 30 }),
    listCompliance(),
    listProducts(),
  ]);
  const sorted = analysis ? sortForDiscover(analysis.products) : [];
  // 단계 (PHASE 21): 상세 원가는 소싱 대상(사용자가 [소싱 시작]한 상품)만 계산한다
  const stageRows = await loadStageRows();
  const stageOf = new Map(stageRows.map((r) => [r.productId, { ...productStage(r), watchStatus: r.watchStatus }]));
  const scopeIds = stageRows.filter((r) => stageOf.get(r.productId)!.inScope).map((r) => r.productId);
  const [sourcing, details] = await Promise.all([listSourcing(sorted.map((p) => p.id)), loadDetails(scopeIds)]);
  const sourcingOf = (id: string) => ({ query: sourcing.queries.get(id) ?? null, links: sourcing.links.get(id) ?? [], detail: details.get(id)?.result ?? null, stage: stageOf.get(id) ?? null, keywordId: analysis?.keyword.id ?? null });
  const nameOf = new Map(allProducts.map((p) => [p.id, p.productName ?? "(이름 없음)"]));
  const shortlisted = stageRows.filter((r) => stageOf.get(r.productId)!.stage === "SHORTLISTED").map((r) => ({ id: r.productId, name: nameOf.get(r.productId) ?? r.productId.slice(0, 8) }));
  const scopeItems: ScopeItem[] = scopeIds.map((id) => {
    const s = stageOf.get(id)!;
    const d = details.get(id)?.result;
    return { id, name: nameOf.get(id) ?? id.slice(0, 8), stage: s.stage, blocker: s.blocker ?? (d && d.status !== "CONFIRMED" ? `확인 안 된 필수 비용 ${d.confirmed.blocking.length}개` : null), cost: d?.status ?? "NOT_ANALYZABLE" };
  });
  // 판매 불가(사용자 확인) 상품은 일반 후보에서 빼고 아래에 사유와 함께 따로 둔다 (기록 유지)
  const excluded = sorted.filter((p) => compliance.get(p.id)?.status === "BLOCKED");
  const products = sorted.filter((p) => compliance.get(p.id)?.status !== "BLOCKED");
  const complianceCounts: Record<string, number> = {};
  for (const c of compliance.values()) complianceCounts[c.status] = (complianceCounts[c.status] ?? 0) + 1;
  const counts = { FINAL: 0, PROVISIONAL: 0, INSUFFICIENT: 0 };
  for (const p of products) counts[discoverStatus(p.preview)] += 1;
  const shortages = analysis
    ? shortageReasons({
        hasSearchVolume: analysis.keyword.metrics.searchVolume?.value != null,
        naverConfigured,
        naverLastAttempt: analysis.naver?.lastAttempt ?? null,
        products,
      })
    : [];

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <AutomationPanel
        runs={runs}
        candidates={candidates}
        totals={{ products: allProducts.length, compliance: complianceCounts, unscreened: allProducts.filter((p) => !compliance.has(p.id)).length }}
        naverConfigured={naverConfigured}
      />

      <StagePanel counts={stageCounts(stageRows)} shortlisted={shortlisted} scope={scopeItems} />

      <Card>
        <CardHeader>
          <CardTitle>1. 키워드 선택</CardTitle>
          <CardDescription>
            등록한 키워드 {keywords.length}개 · 네이버 검색광고 API {naverConfigured ? "설정됨" : "키 없음 (검색량은 /import · 직접 입력으로)"} · {NAVER_PROXY_NOTE}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keywords.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              등록된 키워드가 없습니다.{" "}
              <Link href="/keywords" className="underline">
                키워드 발굴
              </Link>
              에서 먼저 등록하세요.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-3 font-medium">키워드</th>
                    <th className="py-2 pr-3 text-right font-medium">월 검색량</th>
                    <th className="py-2 pr-3 font-medium">네이버 수집 상태</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => {
                    const a = naverStatus.get(k.id)?.lastAttempt;
                    return (
                      <tr key={k.id} className={cn("border-b last:border-0", k.id === kw && "bg-muted/50")}>
                        <td className="py-2 pr-3 font-medium">{k.keyword}</td>
                        <td className="py-2 pr-3 text-right">
                          <DataPointValue point={k.metrics.searchVolume} format={formatNumber} className="items-end" />
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {a ? (
                            <span className={a.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
                              {dateTime.format(new Date(a.at))} {a.ok ? "성공" : `실패 — ${a.label}`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">수집 기록 없음</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/discover?kw=${k.id}`} className="text-primary text-xs font-medium hover:underline" data-analyze={k.id}>
                            분석
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {kw && !analysis && (
        <p className="text-destructive text-sm" role="alert">
          키워드를 찾을 수 없습니다 (삭제됐거나 다른 사용자의 키워드).
        </p>
      )}

      {analysis && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. &quot;{analysis.keyword.keyword}&quot; 분석 요약</CardTitle>
              <CardDescription>
                연결된 등록 상품 {analysis.totalLinked}개
                {analysis.totalLinked > DISCOVER_MAX_PRODUCTS ? ` 중 최근 순위 순 ${DISCOVER_MAX_PRODUCTS}개` : ""} · 최종 판정 {counts.FINAL} · 잠정 분석 {counts.PROVISIONAL} · 분석 불가{" "}
                {counts.INSUFFICIENT}. 점수는 저장하지 않습니다 (상품 상세의 &quot;점수 다시 계산&quot;으로 저장).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="discover-keyword">
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">월 검색량 (수요 대리 지표)</dt>
                  <dd className="mt-1 font-semibold">
                    <DataPointValue point={analysis.keyword.metrics.searchVolume} format={formatNumber} showDate />
                  </dd>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">검색량 증감</dt>
                  <dd className="mt-1 font-semibold">
                    <DataPointValue point={analysis.keyword.metrics.searchGrowthRate} format={(v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`} showDate />
                  </dd>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">1페이지 평균가 · 평균 리뷰</dt>
                  <dd className="mt-1 font-semibold">
                    {formatWon(analysis.keyword.metrics.averagePrice?.value)} · {formatNumber(analysis.keyword.metrics.averageReviews?.value)}
                  </dd>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <dt className="text-muted-foreground text-xs">로켓 비율 · 네이버 마지막 수집</dt>
                  <dd className="mt-1 text-xs">
                    {analysis.keyword.metrics.rocketRatio?.value == null ? "-" : formatPercent(analysis.keyword.metrics.rocketRatio.value)} ·{" "}
                    {analysis.naver?.lastAttempt ? `${dateTime.format(new Date(analysis.naver.lastAttempt.at))} ${analysis.naver.lastAttempt.ok ? "성공" : "실패"}` : "없음"}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">키워드 데이터 준비 상태</h3>
                <ReadinessList
                  testId="discover-keyword-readiness"
                  items={keywordReadiness({
                    naverConfigured,
                    naverLatest: analysis.naver?.latest ? { total: analysis.naver.latest.total, capturedOn: analysis.naver.latest.capturedOn } : null,
                    naverLastAttempt: analysis.naver?.lastAttempt ?? null,
                    searchVolume: analysis.keyword.metrics.searchVolume,
                    coupangSearch: analysis.coupangSearch,
                  })}
                />
              </div>
              {shortages.length > 0 && (
                <div className="space-y-1" data-testid="discover-shortages">
                  <h3 className="text-sm font-semibold">데이터가 부족한 이유</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {shortages.map((s) => (
                      <li key={s.area}>
                        <strong>{s.area}</strong>: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                최종 판정은 9개 요소가 모두 계산될 때만 기존 V1 기준(80 이상 강력추천 · 60~79 검토 · 60 미만 제외)으로 표시합니다. &quot;잠정 분석&quot;은 계산된 요소의 점수와 가능 범위일
                뿐 판정이 아닙니다. 데이터가 없다는 이유로 상품을 빼지 않습니다.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. 판매 후보 ({products.length})</CardTitle>
              <CardDescription>최종 판정(총점 순) → 잠정 분석(계산된 요소 수 · 확보 점수 순) → 분석 불가. 잠정 분석끼리의 순서는 추천 순위가 아닙니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {products.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  이 키워드와 연결된 등록 상품이 없습니다. 쿠팡에서 이 키워드를 검색한 뒤 확장 프로그램 패널에서 후보 상품을 골라 등록하세요.
                </p>
              ) : (
                products.map((p) => <DiscoverProductCard key={p.id} p={p} compliance={compliance.get(p.id) ?? null} sourcing={sourcingOf(p.id)} />)
              )}
              {excluded.length > 0 && (
                <div className="space-y-2" data-testid="discover-excluded">
                  <h3 className="text-sm font-semibold">판매 불가로 제외된 상품 ({excluded.length}) — 사용자 확인</h3>
                  {excluded.map((p) => (
                    <DiscoverProductCard key={p.id} p={p} compliance={compliance.get(p.id) ?? null} sourcing={sourcingOf(p.id)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
