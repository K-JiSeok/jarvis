import type { Metadata } from "next";
import Link from "next/link";

import { CostInputForm, RecordDetailButton, type CostInputDefaults } from "@/components/costs/cost-forms";
import { CostResult } from "@/components/costs/cost-result";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { getCurrentUser } from "@/lib/auth";
import { sanitizeItems } from "@/lib/costs/settings";
import { listCostHistory, loadDetail } from "@/lib/repositories/costs";
import { listProductOptions } from "@/lib/repositories/products";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "상세 원가 · 로켓그로스 비용" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const won = (n: number | null) => (n == null ? "-" : `${n.toLocaleString("ko-KR")}원`);
const num = (v: unknown) => (v == null ? null : Number(v));

export default async function CostPage({ searchParams }: PageProps<"/profit/cost">) {
  const title = "상세 원가 · 로켓그로스 비용";
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={title} />
        <LoginRequired next="/profit/cost" configured={isSupabaseConfigured()} />
      </>
    );
  }
  const params = await searchParams;
  const raw = Array.isArray(params.product) ? params.product[0] : params.product;
  const productId = raw && UUID.test(raw) ? raw : null;
  const [products, view, history] = await Promise.all([listProductOptions(), productId ? loadDetail(productId) : null, productId ? listCostHistory(productId) : []]);

  const r = view?.inputRow ?? null;
  const defaults: CostInputDefaults = {
    salesScope: r?.sales_scope ?? null,
    salesPath: r?.sales_path ?? null,
    feeGroup: r?.fee_group ?? null,
    categoryConfirmed: r?.category_confirmed ?? false,
    lengthCm: num(r?.length_cm),
    widthCm: num(r?.width_cm),
    heightCm: num(r?.height_cm),
    weightKg: num(r?.weight_kg),
    salePrice: num(r?.sale_price),
    sellerDiscount: num(r?.seller_discount),
    storageDays: r?.storage_days ?? null,
    returnRate: num(r?.return_rate),
    hsCode: r?.hs_code ?? null,
    tariffRate: num(r?.tariff_rate),
    tariffBasis: r?.tariff_basis ?? null,
    tariffConfirmed: r?.tariff_confirmed ?? false,
    orderQty: r?.order_qty ?? null,
    unitsPerListing: num(r?.units_per_listing),
    unitCostKrw: num(r?.unit_cost_krw),
    unitCostBasis: r?.unit_cost_basis ?? null,
    overrides: sanitizeItems(r?.overrides),
    memo: r?.memo ?? null,
  };
  const feeGroups = view ? [...new Set(view.input.cards.filter((c) => c.kind === "RG_INOUT").map((c) => c.scope))] : [];

  return (
    <>
      <PageHeader title={title} description="중국 도매 매입부터 수입 · 국내 입고 · 쿠팡 로켓그로스 판매까지 항목별로 계산합니다. 확인된 비용 · 추정 · 미확인을 나눠 보여 주고, 미확인 비용을 0원으로 넣지 않습니다." />
      <Card>
        <CardHeader>
          <CardTitle>상품 선택</CardTitle>
          <CardDescription>
            반복 비용(포워더 · 구매대행 · 통관 · 국내 운송 · 과세 유형)은 <Link href="/profit/rates" className="font-medium underline">비용 설정 · 요율표</Link>에서 한 번 저장해 두면 모든 상품에 씁니다. 기존 수익성 시나리오(profit-v1)와 Score V1 마진은 바뀌지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <NativeSelect name="product" defaultValue={productId ?? ""} aria-label="상품" className="max-w-md">
              <option value="">상품을 고르세요</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName} ({p.coupangProductId})
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              선택
            </Button>
            {productId && (
              <Link href={`/products/${productId}`} className="text-xs font-medium hover:underline">
                상품 상세 →
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {productId && !view && <p className="text-muted-foreground text-sm">상품을 찾을 수 없습니다.</p>}
      {view && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>계산 결과 — {view.productName}</CardTitle>
              <CardDescription>
                공급 원가:{" "}
                {view.supplyRef ? (
                  view.supplyRef.kind === "MANUAL" ? (
                    "직접 입력 원가"
                  ) : (
                    <>
                      선택한 공급 후보 &quot;{view.supplyRef.title.slice(0, 50)}&quot; ({view.supplyRef.matchLevel}){view.selectedCount > 1 ? ` · 선택 후보 ${view.selectedCount}개 중 최근 선택` : ""}
                    </>
                  )
                ) : (
                  <>
                    없음 — <Link href="/discover" className="underline">상품 발굴</Link>에서 공급 후보를 [선택]하거나 아래에 원가를 직접 입력하세요
                  </>
                )}
                {view.coupangPath ? ` · 쿠팡 노출 카테고리: ${view.coupangPath}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CostResult result={view.result} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>상품별 비용 입력</CardTitle>
              <CardDescription>비운 칸은 모름입니다. 0원이면 0을 입력하세요. 저장하면 다시 계산하고, 입력이 바뀐 경우에만 새 계산 이력을 남깁니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <CostInputForm productId={view.productId} d={defaults} feeGroups={feeGroups} guessBasis={view.guess.basis} observedPrice={view.input.sale.source === "OBSERVED" ? view.input.sale.price : null} version={r?.updated_at ?? "new"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>계산 이력 ({history.length}건)</CardTitle>
              <CardDescription>수정되지 않습니다. 요율 · 설정 · 공급가 · 환율 · 판매가가 바뀌면 새 행이 쌓이고, 과거 행은 당시 요율로 계산한 값 그대로입니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <RecordDetailButton productId={view.productId} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs" data-testid="cost-history">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-1.5 font-normal">계산 시각</th>
                      <th className="py-1.5 font-normal">상태</th>
                      <th className="py-1.5 text-right font-normal">판매가</th>
                      <th className="py-1.5 text-right font-normal">확인 비용 이익</th>
                      <th className="py-1.5 text-right font-normal">추정 이익 범위</th>
                      <th className="py-1.5 pl-3 font-normal">적용 요율 (확인일)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b last:border-0">
                        <td className="py-1.5 whitespace-nowrap">{h.computedAt.slice(0, 16).replace("T", " ")}</td>
                        <td className="py-1.5">{h.status === "CONFIRMED" ? "확인 비용 계산" : h.status === "ESTIMATE_ONLY" ? "추정만" : h.status}</td>
                        <td className="py-1.5 text-right tabular-nums">{won(h.salePrice)}</td>
                        <td className="py-1.5 text-right tabular-nums">{h.confirmedProfit == null ? "산출 불가" : won(h.confirmedProfit)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {won(h.estimatedLow)} ~ {won(h.estimatedHigh)}
                        </td>
                        <td className="text-muted-foreground py-1.5 pl-3">
                          {[...new Set(h.cards.map((c) => `${c.scope} ${c.checkedOn}${c.promo ? " 할인가" : ""}`))].slice(0, 4).join(" · ")} · {h.engine}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
