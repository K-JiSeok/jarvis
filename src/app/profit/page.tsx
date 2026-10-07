import type { Metadata } from "next";
import Link from "next/link";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { ProfitCalculator } from "@/components/profit/profit-calculator";
import { ProfitWorkspace } from "@/components/profit/profit-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatPercent, formatShortDate, formatWon } from "@/lib/format";
import { listProductOptions } from "@/lib/repositories/products";
import { getProfitProductContext, listProfitOverview, listScenariosForProduct } from "@/lib/repositories/profit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const nav = findNavItem("/profit")!;

export const metadata: Metadata = { title: "수익성 계산" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && UUID.test(s) ? s : null;
}

export default async function ProfitPage({ searchParams }: PageProps<"/profit">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/profit" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const params = await searchParams;
  const productId = one(params.product);
  const scenarioId = one(params.scenario);

  const [products, overview, context, scenarios] = await Promise.all([
    listProductOptions(),
    listProfitOverview(),
    productId ? getProfitProductContext(productId) : null,
    productId ? listScenariosForProduct(productId) : [],
  ]);

  return (
    <>
      <PageHeader title={nav.label} description="판매가·원가·수수료·물류·광고비로 개당 순이익, 순이익률, ROI, 손익분기를 계산합니다." />

      <Card>
        <CardHeader>
          <CardTitle>상품 선택</CardTitle>
          <CardDescription>상품을 고르면 시나리오를 저장할 수 있습니다. 상품 없이 계산만 해 볼 수도 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <NativeSelect name="product" defaultValue={context?.id ?? ""} aria-label="상품" className="max-w-md">
              <option value="">상품 없이 빠른 계산</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName} ({p.coupangProductId})
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              선택
            </Button>
            {context && (
              <Link href={`/products/${context.id}`} className="text-xs font-medium hover:underline">
                상품 상세 →
              </Link>
            )}
          </form>
          {productId && !context && <p className="text-destructive mt-2 text-sm">상품을 찾을 수 없습니다.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{context ? context.productName : "빠른 계산 (저장 안 됨)"}</CardTitle>
          <CardDescription>
            * 판매가·원가·수수료율은 필수입니다. 나머지 비용은 비워 두면 계산에서 빼고 따로 표시합니다. 결과는 자체 계산(CALCULATED)입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {context ? (
            <ProfitWorkspace
              product={context}
              scenarios={scenarios}
              selectedId={scenarioId}
              hrefFor={(id) => `/profit?product=${context.id}${id ? `&scenario=${id}` : ""}`}
            />
          ) : (
            <ProfitCalculator productId={null} scenario={null} defaultSalePrice={null} categoryFeeRate={null} categoryName={null} isFirstScenario={false} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>전체 시나리오</CardTitle>
          <CardDescription>모든 상품의 저장된 시나리오와 현재 계산 결과 (최근 수정 순)</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.length === 0 ? (
            <p className="text-muted-foreground text-sm">아직 저장된 시나리오가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 font-normal">상품</th>
                    <th className="py-2 font-normal">시나리오</th>
                    <th className="py-2 text-right font-normal">판매가</th>
                    <th className="py-2 text-right font-normal">개당 순이익</th>
                    <th className="py-2 text-right font-normal">순이익률</th>
                    <th className="py-2 text-right font-normal">ROI</th>
                    <th className="py-2 text-right font-normal">월 순이익</th>
                    <th className="py-2 text-right font-normal">계산</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {overview.map(({ scenario: s, product: p }) => {
                    const c = s.current;
                    const neg = (v: number | null | undefined) => v != null && v < 0 && "text-destructive";
                    return (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="max-w-64 truncate py-2">
                          <Link href={`/profit?product=${p.id}`} className="hover:underline">
                            {p.productName}
                          </Link>
                        </td>
                        <td className="py-2">
                          <Link href={`/profit?product=${p.id}&scenario=${s.id}`} className="hover:underline">
                            {s.name}
                          </Link>
                          {s.isPrimary && (
                            <Badge variant="secondary" className="ml-1.5">
                              대표
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 text-right">{formatWon(s.salePrice)}</td>
                        <td className={cn("py-2 text-right font-medium", neg(c?.netProfitPerUnit))}>{formatWon(c?.netProfitPerUnit)}</td>
                        <td className={cn("py-2 text-right", neg(c?.netMarginRate))}>{formatPercent(c?.netMarginRate)}</td>
                        <td className={cn("py-2 text-right", neg(c?.roi))}>{formatPercent(c?.roi)}</td>
                        <td className={cn("py-2 text-right", neg(c?.monthlyNetProfit))}>{formatWon(c?.monthlyNetProfit)}</td>
                        <td className="text-muted-foreground py-2 text-right text-xs">{c ? formatShortDate(c.calculatedAt) : "미계산"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
