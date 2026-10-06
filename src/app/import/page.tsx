import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { findNavItem } from "@/config/navigation";

const nav = findNavItem("/import")!;

export const metadata: Metadata = { title: "데이터 가져오기" };

export default function ImportPage() {
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "WingMeter28, 소싱구원 등 CSV/Excel export 파일 업로드",
          "컬럼 매핑 → 미리보기 → Supabase 저장",
          "모든 행에 source_type / confidence 기록",
        ]}
      />
    </>
  );
}
