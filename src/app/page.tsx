import Link from "next/link";

import {
  DataStatus,
  KpiGrid,
  Recommendations,
  RecentActivity,
  ScoreDistribution,
  WatchingList,
} from "@/components/dashboard/dashboard-sections";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/repositories/dashboard";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { DashboardData } from "@/types/dashboard";

const TITLE = "Dashboard";
const DESCRIPTION = "지금까지 JARVIS에 쌓인 실제 데이터 현황 · 추천 상품 · 분석 상태";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <LoginRequired next="/" configured={isSupabaseConfigured()} />
      </>
    );
  }

  let data: DashboardData;
  try {
    data = await getDashboardData();
  } catch (error) {
    console.error("dashboard", error);
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <Card className="border-destructive/40">
          <CardContent className="space-y-2 text-sm">
            <p className="text-destructive font-medium">Dashboard 데이터를 불러오지 못했습니다.</p>
            <p className="text-muted-foreground">잠시 후 새로고침해 보세요. 계속되면 다시 로그인하거나 설정 화면에서 DB 연결 상태를 확인하세요.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings">설정 · DB 상태</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const { summary } = data;
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} actions={<Badge>LIVE</Badge>} />

      {summary.products === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-start gap-3 text-sm">
            <p className="font-medium">아직 등록된 상품이 없습니다.</p>
            <p className="text-muted-foreground">상품을 등록하면 JARVIS 분석이 시작됩니다.</p>
            <Button asChild size="sm">
              <Link href="/products">상품 등록하러 가기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiGrid data={data} />
          <ScoreDistribution summary={summary} />
          <Recommendations items={data.recommendations} hasScores={summary.scored > 0} />
          <DataStatus quality={data.quality} freshness={data.freshness} />
          <RecentActivity products={data.recentProducts} scores={data.recentScores} />
          <WatchingList items={data.watching} total={data.watchingCount} />
        </>
      )}
    </>
  );
}
