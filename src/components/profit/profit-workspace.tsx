import Link from "next/link";

import { formatPercent, formatWon } from "@/lib/format";
import type { ProfitProductContext, ProfitScenario } from "@/types/profit";

import { ProfitCalculator } from "./profit-calculator";
import { ScenarioTable } from "./scenario-table";

/**
 * 상품 하나의 수익성 영역 (/profit 과 /products/[id] 공용).
 * selectedId 가 있으면 그 시나리오를 수정, 없으면 새 시나리오 입력.
 */
export function ProfitWorkspace({
  product,
  scenarios,
  selectedId,
  hrefFor,
}: {
  product: ProfitProductContext;
  scenarios: ProfitScenario[];
  selectedId: string | null;
  /** 시나리오 id(null = 새 시나리오) → 링크 */
  hrefFor: (scenarioId: string | null) => string;
}) {
  const selected = scenarios.find((s) => s.id === selectedId) ?? null;
  const category = product.category;

  return (
    <div className="space-y-6">
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>카테고리 {category?.name ?? "미지정"}</span>
        <span>
          기본 수수료율 {formatPercent(category?.feeRate, 2)}{" "}
          <Link href="/categories" className="underline">
            관리
          </Link>
        </span>
        <span>
          현재 판매가 {formatWon(product.currentPrice)} · 정가 {formatWon(product.originalPrice)} · 할인율 {formatPercent(product.discountRate)}
        </span>
      </div>

      <ScenarioTable scenarios={scenarios} selectedId={selected?.id ?? null} editHref={(id) => hrefFor(id)} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{selected ? `"${selected.name}" 수정` : "새 시나리오"}</h3>
          {selected && (
            <Link href={hrefFor(null)} className="text-xs font-medium hover:underline">
              + 새 시나리오
            </Link>
          )}
        </div>
        {/* 시나리오를 바꿀 때만 새로 그린다 (저장 후에는 폼이 직접 상태를 관리) */}
        <ProfitCalculator
          key={selected?.id ?? "new"}
          productId={product.id}
          scenario={selected}
          defaultSalePrice={product.currentPrice}
          categoryFeeRate={category?.feeRate ?? null}
          categoryName={category?.name ?? null}
          isFirstScenario={scenarios.length === 0}
        />
      </div>
    </div>
  );
}
