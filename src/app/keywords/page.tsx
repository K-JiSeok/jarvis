import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/keywords")!;

export const metadata: Metadata = { title: "키워드 발굴" };

export default function KeywordsPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "키워드 / 월 검색량 / 쿠팡 상품 수 / 경쟁강도(상품수÷검색량)",
          "WING 비율, 카테고리, 검색량 추세, 급등 여부",
          "필터: 최소 검색량, 최대 경쟁강도, 최소 WING 비율, 최대 평균 리뷰, 성장률, 가격대, 카테고리",
          "키워드별 기회 점수",
        ]}
      />
    </>
  );
}
