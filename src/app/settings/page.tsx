import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

      <PhasePlaceholder
        phase={nav.plannedPhase}
        items={[
          "가중치·판정 기준을 화면에서 수정하고 Supabase에 저장",
          "수익성 계산 기본값(쿠팡 수수료율, 배송비 등) 관리",
        ]}
      />
    </>
  );
}
