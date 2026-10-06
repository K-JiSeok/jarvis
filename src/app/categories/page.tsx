import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/categories")!;

export const metadata: Metadata = { title: "카테고리 분석" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
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
