import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { DbStatusCard } from "@/components/settings/db-status-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JUDGE_ASSUMPTIONS, JUDGE_THRESHOLDS, JUDGE_WEIGHTS } from "@/config/judge-assumptions";
import { findNavItem } from "@/config/navigation";
import {
  DEFAULT_SCORE_WEIGHTS,
  SCORE_FACTORS,
  VERDICT_THRESHOLDS,
  totalWeight,
} from "@/config/scoring-weights";

const nav = findNavItem("/settings")!;

export const metadata: Metadata = { title: "설정" };

export default function SettingsPage() {
  const total = totalWeight();

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <DbStatusCard />

      <Card>
        <CardHeader>
          <CardTitle>기회 점수 가중치 (V1 기본안)</CardTitle>
          <CardDescription>
            현재는 코드 상수(<code>src/config/scoring-weights.ts</code>)에서 읽기 전용으로 표시합니다.
            합계 {total}점
            {total !== 100 && <span className="text-destructive"> — 합계가 100이 아닙니다</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium">항목</th>
                  <th className="py-2 pr-4 text-right font-medium">배점</th>
                  <th className="py-2 font-medium">설명</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_FACTORS.map((key) => {
                  const f = DEFAULT_SCORE_WEIGHTS[key];
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium whitespace-nowrap">{f.label}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{f.weight}</td>
                      <td className="text-muted-foreground py-2">{f.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-4 text-xs">
            판정 기준: {VERDICT_THRESHOLDS.strongBuy}점 이상 강력추천 · {VERDICT_THRESHOLDS.review}~
            {VERDICT_THRESHOLDS.strongBuy - 1}점 검토 · {VERDICT_THRESHOLDS.review}점 미만 제외
          </p>
        </CardContent>
      </Card>

      <Card data-testid="judge-assumptions">
        <CardHeader>
          <CardTitle>판정 V2 가정값 (judge-v2)</CardTitle>
          <CardDescription>
            목표: 쿠팡 로켓그로스로 팔았을 때 확실히 남는 상품만 강력추천. 모든 가정은 이익을 적게 잡는 쪽으로 정했습니다. 지금은 코드(
            <code>src/config/judge-assumptions.ts</code>)에서 읽기 전용으로 보여 줍니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium">항목</th>
                  <th className="py-2 pr-4 text-right font-medium">값</th>
                  <th className="py-2 font-medium">근거</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(JUDGE_ASSUMPTIONS).map(([key, a]) => (
                  <tr key={key} className="border-b align-top last:border-0">
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{a.label}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                      {Array.isArray(a.value)
                        ? (a.value as readonly number[]).map((v) => `${v.toLocaleString("ko-KR")}원`).join(" ~ ")
                        : "unit" in a
                          ? `${String(a.value)}${a.unit}`
                          : typeof a.value === "number" && a.value < 1
                          ? `${Math.round(a.value * 100)}%`
                          : `${String(a.value)}개`}
                    </td>
                    <td className="text-muted-foreground py-2 text-xs">
                      {a.basis}
                      {a.source && (
                        <>
                          {" "}
                          <a href={a.source} target="_blank" rel="noreferrer" className="underline">
                            출처
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            점수 = 시장(수요 {JUDGE_WEIGHTS.market.demand} · 리뷰 장벽 {JUDGE_WEIGHTS.market.reviewBarrier} · 판매자 구성 {JUDGE_WEIGHTS.market.sellerMix} · 광고 부담 {JUDGE_WEIGHTS.market.adBurden}) 50% + 상품(단위 경제성 {JUDGE_WEIGHTS.product.economics} · 판매 근거 {JUDGE_WEIGHTS.product.salesEvidence} · 가격대 {JUDGE_WEIGHTS.product.priceFit}, 전환율은 있으면 최대 +5) 50%. 판정: {JUDGE_THRESHOLDS.strongBuy}점 이상 강력추천 · {JUDGE_THRESHOLDS.review}점 이상 검토 · 그 미만 제외.
            관문: 실제 공급 원가를 확인하기 전에는 강력추천을 내지 않고, 순이익률이 목표 미만 · 판매 추정 최소값 부족 · 시장 위험 2개 이상이면 검토까지로 낮춥니다.
          </p>
        </CardContent>
      </Card>

      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "가중치·판정 기준 · 판정 V2 가정값을 화면에서 수정하고 Supabase에 저장",
          "수익성 계산 기본값(쿠팡 수수료율, 배송비 등) 관리",
        ]}
      />
    </>
  );
}
