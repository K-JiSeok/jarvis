import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/competitors")!;

export const metadata: Metadata = { title: "경쟁상품" };

export default function CompetitorsPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "상위 경쟁상품 10~20개 비교표",
          "가격, 리뷰, 평점, 조회수, 판매량, 매출",
          "배송방식, 브랜드, 판매자, 옵션, 상품명",
        ]}
      />
    </>
  );
}
