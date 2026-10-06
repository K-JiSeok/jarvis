import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/watchlist")!;

export const metadata: Metadata = { title: "관심상품" };

export default function WatchlistPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "검토 중인 상품 저장 및 메모",
          "점수·판정 변화 추적",
        ]}
      />
    </>
  );
}
