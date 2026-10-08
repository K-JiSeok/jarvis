import type { Metadata } from "next";
import Link from "next/link";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { ProductCreateForm } from "@/components/products/product-create-form";
import { ProductsTable } from "@/components/products/products-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCategories } from "@/lib/repositories/keywords";
import { listCurrentScoresByProduct } from "@/lib/repositories/opportunity";
import { listProducts } from "@/lib/repositories/products";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, VERDICTS, type Verdict } from "@/types/common";
import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES, type LifecycleStatus } from "@/types/product";

const nav = findNavItem("/products")!;

export const metadata: Metadata = { title: "상품 분석" };

const FILTERS: { value: LifecycleStatus | "ALL" | undefined; label: string }[] = [
  { value: undefined, label: "삭제 제외" },
  ...LIFECYCLE_STATUSES.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] })),
  { value: "ALL", label: "전체" },
];

const SCORE_FILTERS: { value: Verdict | "NONE" | undefined; label: string }[] = [
  { value: undefined, label: "전체" },
  ...VERDICTS.map((v) => ({ value: v, label: VERDICT_LABELS[v] })),
  { value: "NONE", label: "미계산" },
];

function query(status: string | undefined, verdict: string | undefined) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (verdict) p.set("verdict", verdict);
  const q = p.toString();
  return q ? `/products?${q}` : "/products";
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/products" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const { status: rawStatus, verdict: rawVerdict } = await searchParams;
  const status = FILTERS.find((f) => f.value && f.value === rawStatus)?.value;
  const verdict = SCORE_FILTERS.find((f) => f.value && f.value === rawVerdict)?.value;
  const [allProducts, categories, scores] = await Promise.all([listProducts({ status }), listCategories(), listCurrentScoresByProduct()]);
  const products = allProducts.filter((p) => {
    if (!verdict) return true;
    const s = scores.get(p.id);
    return verdict === "NONE" ? !s : s?.verdict === verdict;
  });

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <Card>
        <CardHeader>
          <CardTitle>상품 등록</CardTitle>
          <CardDescription>같은 쿠팡 상품 ID 는 한 번만 등록됩니다. 하나의 상품을 여러 키워드에 연결할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductCreateForm categories={categories} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>상품 목록</CardTitle>
          <CardDescription>
            {products.length}개. 점수는 저장된 현재 Opportunity Score (데이터가 부족하면 미계산). 키워드 순위는 가장 최근 수집일의 자연 노출 최고 순위입니다. &quot;-&quot; 는 데이터 없음.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav className="flex flex-wrap gap-1.5" aria-label="상태 필터">
            {FILTERS.map((f) => (
              <Link
                key={f.label}
                href={query(f.value, verdict)}
                aria-current={f.value === status ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  f.value === status ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="점수 판정 필터">
            <span className="text-muted-foreground mr-1 text-xs">점수</span>
            {SCORE_FILTERS.map((f) => (
              <Link
                key={f.label}
                href={query(status, f.value)}
                aria-current={f.value === verdict ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  f.value === verdict ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          <ProductsTable products={products} scores={scores} />
        </CardContent>
      </Card>
    </>
  );
}
