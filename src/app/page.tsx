import { MockBanner } from "@/components/common/mock-banner";
import { PageHeader } from "@/components/common/page-header";
import { RecommendationCard } from "@/components/dashboard/recommendation-card";
import { getDashboardData } from "@/lib/repositories/dashboard";

export default async function DashboardPage() {
  // PHASE 8에서 실제 점수 엔진 결과(LIVE)로 교체한다. 그전까지는 DEMO.
  const data = await getDashboardData();

  return (
    <>
      <PageHeader
        title="오늘의 추천상품"
        description="기회 점수 순으로 정렬된 판매 후보 상품"
      />
      {data.mode === "DEMO" && <MockBanner />}
      <div className="grid gap-4">
        {data.recommendations.map((item) => (
          <RecommendationCard key={item.rank} item={item} />
        ))}
      </div>
    </>
  );
}
