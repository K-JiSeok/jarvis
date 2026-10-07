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
import { listProducts } from "@/lib/repositories/products";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES, type LifecycleStatus } from "@/types/product";

const nav = findNavItem("/products")!;

export const metadata: Metadata = { title: "상품 분석" };

const FILTERS: { value: LifecycleStatus | "ALL" | undefined; label: string }[] = [
  { value: undefined, label: "삭제 제외" },
  ...LIFECYCLE_STATUSES.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] })),
  { value: "ALL", label: "전체" },
];

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

  const { status: rawStatus } = await searchParams;
  const status = FILTERS.find((f) => f.value && f.value === rawStatus)?.value;
  const [products, categories] = await Promise.all([listProducts({ status }), listCategories()]);

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
            {products.length}개. 키워드 순위는 가장 최근 수집일의 자연 노출 최고 순위입니다. &quot;-&quot; 는 데이터 없음.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav className="flex flex-wrap gap-1.5" aria-label="상태 필터">
            {FILTERS.map((f) => (
              <Link
                key={f.label}
                href={f.value ? `/products?status=${f.value}` : "/products"}
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
          <ProductsTable products={products} />
        </CardContent>
      </Card>
    </>
  );
}
