import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/products")!;

export const metadata: Metadata = { title: "상품 분석" };

export default function ProductsPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "기본정보: 상품 ID, 상품명, 브랜드, 가격, 배송 유형(Rocket/Growth/WING)",
          "28일 조회수·판매량(실제/추정/예측 구분)·매출, 전환율, 판매 추세",
          "시장정보 + 경쟁상품 + 수익성 요약",
          "\"왜 이 상품을 검토해야 하는가\" 근거와 위험요소",
        ]}
      />
    </>
  );
}
