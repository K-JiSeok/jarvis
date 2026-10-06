/**
 * ⚠️ DEMO / MOCK 데이터
 *
 * 화면 레이아웃 확인용 가상 데이터다. 실제 쿠팡 상품·수치가 아니다.
 * mode: "DEMO" 로 표시되며, UI는 반드시 DEMO 배너를 띄운다.
 * PHASE 8에서 실제 점수 엔진 결과로 교체한다.
 */
import type { DataPoint } from "@/types/common";
import type { DashboardData } from "@/types/dashboard";

/** 데모 값은 전부 ESTIMATED / C 등급으로 표시한다. */
function demo(value: number): DataPoint {
  return { value, source: "ESTIMATED", confidence: "C" };
}

export const MOCK_DASHBOARD: DashboardData = {
  mode: "DEMO",
  generatedAt: "2026-10-06T00:00:00+09:00",
  recommendations: [
    {
      rank: 1,
      productName: "[DEMO] 상품 A — 실리콘 주방 정리 트레이",
      category: "주방용품 > 정리/수납",
      opportunityScore: 87,
      sales: { actual: null, estimated: demo(420), predicted: null },
      monthlyRevenue: demo(7_980_000),
      monthlyNetProfit: demo(1_915_000),
      marginRate: demo(0.24),
      competitionRatio: demo(1.8),
      topReviewAvg: demo(310),
      wingRatio: demo(0.62),
      growthRate: demo(0.18),
      reasons: [
        { kind: "POSITIVE", message: "검색 수요 증가" },
        { kind: "POSITIVE", message: "경쟁강도 낮음" },
        { kind: "POSITIVE", message: "WING 판매자 비율 높음" },
        { kind: "POSITIVE", message: "상위상품 리뷰 장벽 낮음" },
        { kind: "POSITIVE", message: "예상 마진 24%" },
        { kind: "CAUTION", message: "광고 경쟁 높음" },
      ],
      risks: [
        {
          type: "AD_DEPENDENCY",
          severity: "MEDIUM",
          message: "상위 노출 상품 다수가 광고 상품",
        },
      ],
    },
    {
      rank: 2,
      productName: "[DEMO] 상품 B — 차량용 틈새 수납 포켓",
      category: "자동차용품 > 실내용품",
      opportunityScore: 82,
      sales: { actual: null, estimated: demo(350), predicted: null },
      monthlyRevenue: demo(5_215_000),
      monthlyNetProfit: demo(1_095_000),
      marginRate: demo(0.21),
      competitionRatio: demo(2.4),
      topReviewAvg: demo(540),
      wingRatio: demo(0.55),
      growthRate: demo(0.09),
      reasons: [
        { kind: "POSITIVE", message: "판매량 안정적" },
        { kind: "POSITIVE", message: "WING 판매자 비율 높음" },
        { kind: "POSITIVE", message: "예상 마진 21%" },
        { kind: "CAUTION", message: "상위 1~3위 리뷰 다소 많음" },
      ],
      risks: [
        {
          type: "BRAND_MONOPOLY",
          severity: "MEDIUM",
          message: "상위 10개 중 동일 브랜드 4개",
        },
      ],
    },
    {
      rank: 3,
      productName: "[DEMO] 상품 C — 접이식 캠핑 사이드 테이블",
      category: "스포츠/레저 > 캠핑",
      opportunityScore: 76,
      sales: { actual: null, estimated: demo(180), predicted: null },
      monthlyRevenue: demo(5_022_000),
      monthlyNetProfit: demo(904_000),
      marginRate: demo(0.18),
      competitionRatio: demo(3.1),
      topReviewAvg: demo(820),
      wingRatio: demo(0.41),
      growthRate: demo(-0.04),
      reasons: [
        { kind: "POSITIVE", message: "객단가 높음" },
        { kind: "CAUTION", message: "판매량 소폭 감소" },
        { kind: "CAUTION", message: "리뷰 장벽 높음" },
      ],
      risks: [
        { type: "SEASONALITY", severity: "HIGH", message: "가을·겨울 비수기 진입" },
        { type: "BULKY_HEAVY", severity: "LOW", message: "부피 큰 상품, 배송비 주의" },
      ],
    },
  ],
};
