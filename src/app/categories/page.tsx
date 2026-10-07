import type { Metadata } from "next";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { CategoryCreateForm, CategoryFeeForm } from "@/components/profit/category-fee-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { listCategoryFees } from "@/lib/repositories/profit";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const nav = findNavItem("/categories")!;

export const metadata: Metadata = { title: "카테고리 분석" };

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/categories" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const categories = await listCategoryFees();

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <Card>
        <CardHeader>
          <CardTitle>카테고리 수수료율</CardTitle>
          <CardDescription>
            수익성 계산에서 시나리오에 수수료율을 비워 두면 상품 카테고리의 기본 수수료율을 씁니다. 쿠팡 판매 수수료표에서 확인한 값을 직접 입력하세요
            (자동 조회 없음). 비우면 모름입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">카테고리가 없습니다. 아래에서 추가하거나 키워드·상품 등록 때 만드세요.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 font-normal">카테고리</th>
                    <th className="py-2 text-right font-normal">상품 수</th>
                    <th className="py-2 pl-6 font-normal">기본 수수료율</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="font-medium">{c.name}</span>
                        {c.path && c.path !== c.name && <span className="text-muted-foreground ml-1.5 text-xs">{c.path}</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(c.productCount)}</td>
                      <td className="py-2 pl-6">
                        {/* 저장 후 React 가 폼을 이전 기본값으로 reset 하므로, 서버 값이 바뀌면 새로 그린다 */}
                        <CategoryFeeForm key={c.updatedAt} categoryId={c.id} feeRate={c.feeRate} name={c.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CategoryCreateForm />
        </CardContent>
      </Card>

      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "평균/중간 가격, 평균/중간 리뷰",
          "Rocket·WING 비율, 브랜드 집중도",
          "상위상품 조회수·판매량·예상 매출, 매출 성장률",
          "가격 분포",
        ]}
      />
    </>
  );
}
