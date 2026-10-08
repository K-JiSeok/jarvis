import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { DataPointValue } from "@/components/common/data-point-value";
import { CandidateList } from "@/components/competitors/candidate-list";
import { CompetitorAddForm } from "@/components/competitors/competitor-add-form";
import { RelationBadge } from "@/components/competitors/competitor-controls";
import { CompetitorsTable } from "@/components/competitors/competitors-table";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { deliveryLabel, sellerLabel, withPeriod } from "@/components/products/labels";
import { ProfitWorkspace } from "@/components/profit/profit-workspace";
import { ScoreCard } from "@/components/score/score-card";
import { ProductEditForm } from "@/components/products/product-edit-form";
import { ProductSnapshotForm } from "@/components/products/product-snapshot-form";
import { ProductSnapshotHistory } from "@/components/products/product-snapshot-history";
import { RankForm } from "@/components/products/rank-form";
import { RankHistory } from "@/components/products/rank-history";
import { SearchExposure } from "@/components/products/search-exposure";
import {
  WatchlistEvents,
  WatchlistReleaseButton,
  WatchlistStatusBadge,
  WatchlistStatusForm,
} from "@/components/watchlist/watchlist-controls";
import { WatchlistAddForm, WatchlistMemoForm } from "@/components/watchlist/watchlist-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { formatNumber, formatPercent, formatShortDate, formatWon } from "@/lib/format";
import { getCompetitorCandidates, getCompetitorReferences, getCompetitorsForProduct } from "@/lib/repositories/competitors";
import { listCategories, listKeywordOptions } from "@/lib/repositories/keywords";
import { getProductDetail, kstToday } from "@/lib/repositories/products";
import { getCurrentScore, listActiveRisks, listScoreHistory, listScoreKeywordOptions, previewScore } from "@/lib/repositories/opportunity";
import { getProfitProductContext, listScenariosForProduct } from "@/lib/repositories/profit";
import { getWatchlistForProduct, listWatchlistEvents } from "@/lib/repositories/watchlist";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { DataPoint } from "@/types/common";
import { LIFECYCLE_LABELS, type PeriodDataPoint, type ProductMetrics } from "@/types/product";

export const metadata: Metadata = { title: "상품 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Metric =
  | { key: keyof ProductMetrics; label: string; kind: "number"; format: (v: number) => string }
  | { key: keyof ProductMetrics; label: string; kind: "text"; format: (v: string) => string }
  | { key: keyof ProductMetrics; label: string; kind: "period"; format: (v: number) => string };

const METRICS: Metric[] = [
  { key: "price", label: "판매가", kind: "number", format: formatWon },
  { key: "originalPrice", label: "정가", kind: "number", format: formatWon },
  { key: "discountRate", label: "할인율", kind: "number", format: (v) => formatPercent(v) },
  { key: "reviewCount", label: "리뷰 수", kind: "number", format: formatNumber },
  { key: "rating", label: "평점", kind: "number", format: (v) => v.toFixed(2) },
  { key: "categoryRank", label: "카테고리 순위", kind: "number", format: (v) => `${formatNumber(v)}위` },
  { key: "views28d", label: "28일 조회수", kind: "number", format: formatNumber },
  { key: "conversionRate", label: "전환율", kind: "number", format: (v) => formatPercent(v, 2) },
  { key: "salesActual", label: "실제 판매량", kind: "period", format: formatNumber },
  { key: "salesEstimated", label: "추정 판매량", kind: "period", format: formatNumber },
  { key: "revenueActual", label: "실제 매출", kind: "period", format: formatWon },
  { key: "revenueEstimated", label: "추정 매출", kind: "period", format: formatWon },
  { key: "deliveryType", label: "배송 유형", kind: "text", format: deliveryLabel },
  { key: "sellerTypeObserved", label: "판매자 유형 (관측)", kind: "text", format: sellerLabel },
  { key: "optionCount", label: "옵션 수", kind: "number", format: formatNumber },
  { key: "productNameObserved", label: "관측 상품명", kind: "text", format: (v) => v },
];

export default async function ProductDetailPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const { scenario, score_kw: scoreKw } = await searchParams;
  const scenarioId = typeof scenario === "string" && UUID.test(scenario) ? scenario : null;
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title="상품 상세" />
        <LoginRequired next={`/products/${id}`} configured={isSupabaseConfigured()} />
      </>
    );
  }

  if (!UUID.test(id)) notFound();
  const [product, categories, keywords, watch, competitors, candidates, references, profitContext, scenarios] = await Promise.all([
    getProductDetail(id),
    listCategories(),
    listKeywordOptions(),
    getWatchlistForProduct(id),
    getCompetitorsForProduct(id),
    getCompetitorCandidates(id),
    getCompetitorReferences(id),
    getProfitProductContext(id),
    listScenariosForProduct(id),
  ]);
  // RLS: 다른 사용자의 상품은 조회되지 않으므로 존재하지 않는 것과 같다
  if (!product) notFound();
  const events = watch ? await listWatchlistEvents(watch.id) : [];

  // 점수 맥락 키워드: ?score_kw= (none = 키워드 없음) → 없으면 연결된 첫 키워드 (관심상품 발견 → 검색 순위 → 경쟁관계)
  const keywordOptions = await listScoreKeywordOptions(id);
  const requested = typeof scoreKw === "string" ? scoreKw : null;
  const scoreKeywordId =
    requested === "none" ? null : (keywordOptions.find((k) => k.id === requested) ?? keywordOptions[0])?.id ?? null;
  const [scorePreview, savedScore, scoreHistory, risks] = await Promise.all([
    previewScore(id, scoreKeywordId),
    getCurrentScore(id, scoreKeywordId),
    listScoreHistory(id),
    listActiveRisks(id),
  ]);
  const today = kstToday();

  return (
    <>
      <Link href="/products" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" />
        상품 목록
      </Link>

      <PageHeader
        title={product.productName}
        description={`${product.brand ?? "브랜드 -"} · 쿠팡 상품 ID ${product.coupangProductId}`}
        actions={
          <>
            <Badge variant={product.lifecycleStatus === "ACTIVE" ? "secondary" : "outline"}>{LIFECYCLE_LABELS[product.lifecycleStatus]}</Badge>
            {watch && <WatchlistStatusBadge status={watch.status} />}
            <Badge>LIVE</Badge>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
            <CardDescription className="space-y-0.5">
              <span className="block">
                itemId {product.master.coupangItemId ?? "-"} · vendorItemId {product.master.coupangVendorItemId ?? "-"}
              </span>
              <span className="block">
                카테고리 {product.category?.path ?? product.category?.name ?? "미지정"} · 등록 {formatShortDate(product.master.createdAt)} · 최근 관측{" "}
                {formatShortDate(product.lastSeenAt)}
              </span>
              {product.master.productUrl && (
                <a href={product.master.productUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                  쿠팡에서 보기 <ExternalLink className="size-3" />
                </a>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* 저장 후 React 가 폼을 이전 기본값으로 reset 하므로, 서버 값이 바뀌면 새로 그린다 */}
            <ProductEditForm key={product.master.updatedAt} product={product} categories={categories} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>현재 지표</CardTitle>
              <CardDescription>항목마다 가장 최근·신뢰도 높은 값 (제외된 스냅샷 제외). 판매량·매출은 집계 기간과 함께 표시합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {METRICS.map((m) => (
                  <div key={m.key} className="rounded-md border px-3 py-2">
                    <dt className="text-muted-foreground text-xs">{m.label}</dt>
                    <dd className="mt-1 font-semibold">
                      <MetricValue metric={m} point={product.metrics[m.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>관심상품</CardTitle>
              <CardDescription>상태 이력은 자동 기록됩니다. 메모는 관심상품 메모에 남기세요.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!watch || watch.status === "DROPPED" ? (
                <WatchlistAddForm productId={product.id} keywords={keywords} restoring={watch?.status === "DROPPED"} />
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <WatchlistStatusForm item={watch} />
                  <WatchlistReleaseButton item={watch} />
                  {watch.keyword && <span className="text-muted-foreground text-xs">발견 키워드: {watch.keyword}</span>}
                </div>
              )}
              {watch && <WatchlistMemoForm key={watch.memo ?? ""} watchlistId={watch.id} productId={product.id} memo={watch.memo} />}
              {watch && <WatchlistEvents events={events} />}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card id="score">
        <CardHeader>
          <CardTitle>Opportunity Score</CardTitle>
          <CardDescription>
            이 상품이 판매 후보로 얼마나 좋은가 (100점 만점, Scoring v1 가중치 고정). 수집된 실제 데이터만 사용하고, 없는 데이터는 추정하지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scorePreview && (
            <ScoreCard
              productId={product.id}
              saved={savedScore}
              preview={scorePreview.result}
              keywordOptions={keywordOptions}
              keywordId={scoreKeywordId}
              risks={risks}
              history={scoreHistory}
            />
          )}
        </CardContent>
      </Card>

      {profitContext && (
        <Card id="profit">
          <CardHeader>
            <CardTitle>수익성 분석</CardTitle>
            <CardDescription>
              판매가 기본값은 현재 판매가, 수수료율 기본값은 카테고리 수수료율입니다. 시나리오를 여러 개 저장해 비교할 수 있습니다 (결과: 자체 계산).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfitWorkspace
              product={profitContext}
              scenarios={scenarios}
              selectedId={scenarioId}
              hrefFor={(sid) => `/products/${product.id}${sid ? `?scenario=${sid}` : ""}#profit`}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>검색 노출</CardTitle>
          <CardDescription>
            키워드마다 가장 최근 순위와 그날 쿠팡 화면 값 (확장 프로그램 수집 · 직접 입력). 같은 검색 결과의 다른 등록 상품은 아래 &quot;경쟁상품 후보&quot;에서 직접 골라 연결합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SearchExposure ranks={product.ranks} snapshots={product.snapshots} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>경쟁상품</CardTitle>
          <CardDescription>
            이 상품을 기준으로 본 경쟁상품 (한 방향). 경쟁상품도 일반 상품이라 지표는 그 상품 상세에서 입력합니다. 해제해도 등록 이력은 남습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CompetitorsTable
            mode="product"
            relations={competitors}
            base={{ name: product.productName, metrics: product.metrics, latestCapturedOn: product.latestCapturedOn }}
          />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">경쟁상품 후보 (키워드 검색 순위)</h3>
            <CandidateList productId={product.id} groups={candidates} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">URL · 상품 ID 로 직접 등록</h3>
            <CompetitorAddForm productId={product.id} keywords={keywords} />
          </div>
          {references.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">이 상품을 경쟁상품으로 둔 상품</h3>
              <ul className="space-y-1 text-sm">
                {references.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/products/${r.base.id}`} className="hover:underline">
                      {r.base.productName}
                    </Link>
                    <RelationBadge type={r.relationType} />
                    {r.keyword && <span className="text-muted-foreground text-xs">{r.keyword}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>지표 직접 입력</CardTitle>
          <CardDescription>쿠팡 화면이나 외부 도구에서 확인한 값을 입력합니다. 실제 판매량과 추정 판매량은 따로 입력합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductSnapshotForm productId={product.id} today={today} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>수집 이력</CardTitle>
          <CardDescription>날짜·출처별 원본 기록 (최신 → 과거). 잘못된 값은 삭제하지 않고 제외합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductSnapshotHistory productId={product.id} snapshots={product.snapshots} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>키워드 검색 순위</CardTitle>
          <CardDescription>이 상품이 어떤 키워드에서 언제 몇 위였는지. 상품 하나를 여러 키워드에 연결할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RankForm productId={product.id} keywords={keywords} today={today} />
          <RankHistory ranks={product.ranks} mode="product" />
        </CardContent>
      </Card>
    </>
  );
}

function MetricValue({ metric, point }: { metric: Metric; point: ProductMetrics[keyof ProductMetrics] }) {
  if (metric.kind === "text") return <DataPointValue point={point as DataPoint<string> | null} format={metric.format} showDate />;
  if (metric.kind === "period") {
    const p = point as PeriodDataPoint | null;
    return <DataPointValue point={p} format={(v) => withPeriod(metric.format(v), p?.periodDays)} showDate />;
  }
  return <DataPointValue point={point as DataPoint | null} format={metric.format} showDate />;
}
