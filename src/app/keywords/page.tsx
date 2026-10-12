import type { Metadata } from "next";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { KeywordCreateForm } from "@/components/keywords/keyword-create-form";
import { KeywordsTable } from "@/components/keywords/keywords-table";
import { NaverCollectBar } from "@/components/keywords/naver-volume-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isNaverMockBaseUrl, naverSearchAdConfig } from "@/lib/ingest/naver-searchad";
import { listCategories, listKeywords } from "@/lib/repositories/keywords";
import { listNaverStatus } from "@/lib/repositories/naver-status";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const nav = findNavItem("/keywords")!;

export const metadata: Metadata = { title: "키워드 발굴" };

export default async function KeywordsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/keywords" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const [keywords, categories, naverStatus] = await Promise.all([listKeywords(), listCategories(), listNaverStatus()]);
  const naverConfig = naverSearchAdConfig();
  const tracking = keywords.filter((k) => k.isTracking).length;

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <Card>
        <CardHeader>
          <CardTitle>키워드 등록</CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordCreateForm categories={categories} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>키워드 목록</CardTitle>
          <CardDescription>
            {keywords.length}개 · 추적 중 {tracking}개. 값 아래 배지는 출처와 신뢰도이고, &quot;-&quot; 는 아직 데이터가
            없다는 뜻입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NaverCollectBar configured={naverConfig != null} mock={isNaverMockBaseUrl(naverConfig)} />
          <KeywordsTable keywords={keywords} naverStatus={naverStatus} />
        </CardContent>
      </Card>
    </>
  );
}
