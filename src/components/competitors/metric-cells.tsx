import { DataPointValue } from "@/components/common/data-point-value";
import { deliveryLabel, sellerLabel, withPeriod } from "@/components/products/labels";
import { formatNumber, formatWon } from "@/lib/format";
import type { ProductMetrics } from "@/types/product";

/** 경쟁 비교표의 공통 지표 칸. 값이 없으면 "-" (0 으로 채우지 않는다) */

export function PriceCell({ metrics }: { metrics: ProductMetrics | null }) {
  return <DataPointValue point={metrics?.price ?? null} format={formatWon} className="items-end" />;
}

export function ReviewCell({ metrics }: { metrics: ProductMetrics | null }) {
  return <DataPointValue point={metrics?.reviewCount ?? null} format={formatNumber} className="items-end" />;
}

export function RatingCell({ metrics }: { metrics: ProductMetrics | null }) {
  return <DataPointValue point={metrics?.rating ?? null} format={(v) => v.toFixed(1)} className="items-end" />;
}

/** 판매량: 실제 / 추정을 섞지 않고 각각 표시 (기간 포함) */
export function SalesCell({ metrics }: { metrics: ProductMetrics | null }) {
  const actual = metrics?.salesActual ?? null;
  const estimated = metrics?.salesEstimated ?? null;
  if (!actual && !estimated) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {actual && (
        <span className="inline-flex items-start gap-1">
          <span className="text-muted-foreground text-[10px]">실제</span>
          <DataPointValue point={actual} format={(v) => withPeriod(formatNumber(v), actual.periodDays)} className="items-end" />
        </span>
      )}
      {estimated && (
        <span className="inline-flex items-start gap-1">
          <span className="text-muted-foreground text-[10px]">추정</span>
          <DataPointValue point={estimated} format={(v) => withPeriod(formatNumber(v), estimated.periodDays)} className="items-end" />
        </span>
      )}
    </span>
  );
}

/** 배송 유형(Rocket 등) + 관측 판매자 유형(WING 등) */
export function FulfillmentCell({ metrics }: { metrics: ProductMetrics | null }) {
  const delivery = metrics?.deliveryType ?? null;
  const seller = metrics?.sellerTypeObserved ?? null;
  if (!delivery && !seller) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex flex-col gap-1">
      {delivery && <DataPointValue point={delivery} format={deliveryLabel} />}
      {seller && <DataPointValue point={seller} format={sellerLabel} />}
    </span>
  );
}
