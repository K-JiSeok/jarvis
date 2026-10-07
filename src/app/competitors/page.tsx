import type { Metadata } from "next";
import Link from "next/link";

import { CompetitorsTable } from "@/components/competitors/competitors-table";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCompetitors, type CompetitorStatusFilter } from "@/lib/repositories/competitors";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RELATION_TYPE_LABELS, RELATION_TYPES, type RelationType } from "@/types/competitor";

const nav = findNavItem("/competitors")!;

export const metadata: Metadata = { title: "경쟁상품" };

const STATUS_LABELS: Record<CompetitorStatusFilter, string> = { ACTIVE: "활성", RELEASED: "해제됨", ALL: "전체" };

export default async function CompetitorsPage({ searchParams }: PageProps<"/competitors">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/competitors" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const params = await searchParams;
  const status = (["ACTIVE", "RELEASED", "ALL"] as const).find((s) => s === params.status) ?? "ACTIVE";
  const relationType = RELATION_TYPES.find((t) => t === params.relation);
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const relations = await listCompetitors({ status, relationType, query });

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <Card>
        <CardHeader>
          <CardTitle>경쟁상품 비교</CardTitle>
          <CardDescription>
            {relations.length}건. 경쟁상품 등록은 상품 상세 화면에서 합니다 (키워드 순위 후보 또는 URL 입력). 관계는 &quot;기준 상품 →
            경쟁상품&quot; 한 방향이며, 값 아래 배지는 출처·신뢰도, &quot;-&quot; 는 데이터 없음.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-center gap-2" role="search">
            <Input name="q" defaultValue={query} placeholder="상품명 · 상품 ID · 키워드" aria-label="검색" className="h-8 w-56 text-xs" />
            <NativeSelect name="relation" defaultValue={relationType ?? ""} aria-label="관계 유형" className="h-8 w-32 text-xs">
              <option value="">관계 전체</option>
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RELATION_TYPE_LABELS[t as RelationType]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="status" defaultValue={status} aria-label="상태" className="h-8 w-28 text-xs">
              {(Object.keys(STATUS_LABELS) as CompetitorStatusFilter[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              적용
            </Button>
            {(query || relationType || status !== "ACTIVE") && (
              <Link href="/competitors" className="text-muted-foreground text-xs hover:underline">
                초기화
              </Link>
            )}
          </form>
          <CompetitorsTable relations={relations} mode="list" />
        </CardContent>
      </Card>
    </>
  );
}
