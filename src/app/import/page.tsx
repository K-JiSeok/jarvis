import type { Metadata } from "next";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { ImportHistory, ImportJobDetail } from "@/components/import/import-history";
import { ImportWizard } from "@/components/import/import-wizard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getImportJob, listImportJobs } from "@/lib/repositories/imports";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const nav = findNavItem("/import")!;

export const metadata: Metadata = { title: "데이터 가져오기" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/import" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const { job: rawJob } = await searchParams;
  const jobId = typeof rawJob === "string" && UUID.test(rawJob) ? rawJob : null;
  const [jobs, detail] = await Promise.all([listImportJobs(), jobId ? getImportJob(jobId) : null]);

  return (
    <>
      <PageHeader
        title={nav.label}
        description="CSV · Excel 파일의 상품 · 키워드 · 순위 데이터를 확인 후 JARVIS 에 저장합니다."
        actions={<Badge>LIVE</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>파일 가져오기</CardTitle>
          <CardDescription>
            파일 선택 → 컬럼 매핑 → 검증·미리 보기 → 실행. 등록된 상품·키워드에만 저장하고, 빈 칸은 모름으로 둡니다 (기존 값을 지우지 않음).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportWizard />
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle>가져오기 결과 상세</CardTitle>
            <CardDescription>실패 → 건너뜀 → 갱신 → 추가 순 (최대 500행)</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportJobDetail job={detail.job} rows={detail.rows} />
          </CardContent>
        </Card>
      )}
      {jobId && !detail && <p className="text-destructive text-sm">가져오기 기록을 찾을 수 없습니다.</p>}

      <Card>
        <CardHeader>
          <CardTitle>가져오기 이력</CardTitle>
          <CardDescription>최근 30건. 파일명을 누르면 행별 결과를 봅니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImportHistory jobs={jobs} selectedId={jobId} />
        </CardContent>
      </Card>
    </>
  );
}
