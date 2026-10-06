import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/profit")!;

export const metadata: Metadata = { title: "수익성 계산" };

export default function ProfitPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "입력: 판매가, 원가, 국제·국내 배송비, 쿠팡 수수료, 물류/그로스 비용, 광고비, 기타",
          "1개당 순이익, 순이익률, ROI",
          "월 100 / 300 / 500개 판매 시 예상수익",
          "손익분기 판매량",
        ]}
      />
    </>
  );
}
