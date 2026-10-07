import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DataPointValue } from "@/components/common/data-point-value";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { KeywordSettingsForm } from "@/components/keywords/keyword-settings-form";
import { SnapshotForm } from "@/components/keywords/snapshot-form";
import { SnapshotHistory } from "@/components/keywords/snapshot-history";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { formatDecimal, formatNumber, formatPercent, formatShortDate, formatSignedPercent, formatWon } from "@/lib/format";
import { getKeywordDetail, listCategories } from "@/lib/repositories/keywords";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { DataPoint } from "@/types/common";
import type { KeywordMetrics } from "@/types/keyword";

export const metadata: Metadata = { title: "키워드 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METRICS: { key: keyof KeywordMetrics; label: string; format: (v: number) => string }[] = [
  { key: "searchVolume", label: "월 검색량", format: formatNumber },
  { key: "searchVolumePrevious", label: "이전 검색량", format: formatNumber },
  { key: "searchGrowthRate", label: "검색량 증감", format: formatSignedPercent },
  { key: "coupangProductCount", label: "쿠팡 상품 수", format: formatNumber },
  { key: "competitionIntensity", label: "경쟁강도 (상품수÷검색량)", format: (v) => formatDecimal(v) },
  { key: "wingRatio", label: "WING 비율", format: (v) => formatPercent(v) },
  { key: "rocketRatio", label: "로켓 비율", format: (v) => formatPercent(v) },
  { key: "brandConcentration", label: "브랜드 집중도", format: (v) => formatPercent(v) },
  { key: "averagePrice", label: "평균 가격", format: formatWon },
  { key: "averageReviews", label: "평균 리뷰 수", format: formatNumber },
  { key: "sampleSize", label: "표본 수", format: formatNumber },
  { key: "adBid", label: "광고 입찰가", format: formatWon },
];

export default async function KeywordDetailPage({ params }: PageProps<"/keywords/[id]">) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <>
        <PageHeader title="키워드 상세" />
        <LoginRequired next={`/keywords/${id}`} configured={isSupabaseConfigured()} />
      </>
    );
  }

  if (!UUID.test(id)) notFound();
  const [keyword, categories] = await Promise.all([getKeywordDetail(id), listCategories()]);
  // RLS: 다른 사용자의 키워드는 조회되지 않으므로 존재하지 않는 것과 같다
  if (!keyword) notFound();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

  return (
    <>
      <Link href="/keywords" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" />
        키워드 목록
      </Link>

      <PageHeader
        title={keyword.keyword}
        description={`중복 판정 키: ${keyword.normalizedKeyword}`}
        actions={
          <>
            <Badge variant={keyword.isTracking ? "default" : "outline"}>{keyword.isTracking ? "추적 중" : "추적 중지"}</Badge>
            <Badge variant="secondary">LIVE</Badge>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
            <CardDescription>
              카테고리: {keyword.category?.path ?? keyword.category?.name ?? "미지정"} · 스냅샷 {keyword.snapshotCount}건
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeywordSettingsForm keyword={keyword} categories={categories} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>현재 지표</CardTitle>
            <CardDescription>
              항목마다 가장 최근·신뢰도 높은 값을 보여줍니다 (제외된 스냅샷 제외). 최근 수집{" "}
              {formatShortDate(keyword.latestCapturedOn)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {METRICS.map((m) => (
                <MetricTile key={m.key} label={m.label} point={keyword.metrics[m.key]} format={m.format} />
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>지표 직접 입력</CardTitle>
          <CardDescription>외부 도구나 쿠팡 화면에서 확인한 값을 입력합니다. 빈 칸은 &quot;모름&quot;이며, 같은 날짜에 다시 저장해도 기존 값을 지우지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotForm keywordId={keyword.id} today={today} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>수집 이력</CardTitle>
          <CardDescription>날짜·출처별 원본 기록. 잘못된 값은 삭제하지 않고 제외합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotHistory keywordId={keyword.id} snapshots={keyword.snapshots} />
        </CardContent>
      </Card>
    </>
  );
}

function MetricTile({ label, point, format }: { label: string; point: DataPoint | null; format: (v: number) => string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 font-semibold">
        <DataPointValue point={point} format={format} showDate />
      </dd>
    </div>
  );
}
