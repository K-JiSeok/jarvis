import Link from "next/link";

import { setPrimaryScenarioAction } from "@/app/profit/actions";
import { Badge } from "@/components/ui/badge";
import { formatPercent, formatShortDate, formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProfitScenario } from "@/types/profit";

import { ScenarioDeleteButton } from "./scenario-delete-button";

const tone = (v: number | null) => (v == null ? "" : v < 0 ? "text-destructive" : "");

/** 상품의 시나리오 목록. editHref(id) 로 수정 화면 링크를 만든다 */
export function ScenarioTable({
  scenarios,
  selectedId,
  editHref,
}: {
  scenarios: ProfitScenario[];
  selectedId: string | null;
  editHref: (scenarioId: string) => string;
}) {
  if (scenarios.length === 0) return <p className="text-muted-foreground text-sm">저장된 시나리오가 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-normal">시나리오</th>
            <th className="py-2 text-right font-normal">판매가</th>
            <th className="py-2 text-right font-normal">원가</th>
            <th className="py-2 text-right font-normal">개당 순이익</th>
            <th className="py-2 text-right font-normal">순이익률</th>
            <th className="py-2 text-right font-normal">ROI</th>
            <th className="py-2 text-right font-normal">손익분기가</th>
            <th className="py-2 text-right font-normal">계산</th>
            <th className="py-2 font-normal" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {scenarios.map((s) => {
            const c = s.current;
            return (
              <tr key={s.id} className={cn("border-b last:border-0", s.id === selectedId && "bg-muted/50")}>
                <td className="py-2">
                  <span className="font-medium">{s.name}</span>
                  {s.isPrimary && (
                    <Badge variant="secondary" className="ml-1.5">
                      대표
                    </Badge>
                  )}
                </td>
                <td className="py-2 text-right">{formatWon(s.salePrice)}</td>
                <td className="py-2 text-right" title="원화 환산 원가">
                  {formatWon(c?.unitCostKrw ?? (s.unitCostCurrency === "KRW" ? s.unitCostAmount : null))}
                </td>
                <td className={cn("py-2 text-right font-medium", tone(c?.netProfitPerUnit ?? null))}>{formatWon(c?.netProfitPerUnit)}</td>
                <td className={cn("py-2 text-right", tone(c?.netMarginRate ?? null))}>{formatPercent(c?.netMarginRate)}</td>
                <td className={cn("py-2 text-right", tone(c?.roi ?? null))}>{formatPercent(c?.roi)}</td>
                <td className="py-2 text-right">{formatWon(c?.breakEvenPrice)}</td>
                <td className="text-muted-foreground py-2 text-right text-xs" title={c ? `${c.formulaVersion} · 자체 계산` : "필수값 미입력으로 결과 없음"}>
                  {c ? formatShortDate(c.calculatedAt) : "미계산"}
                </td>
                <td className="space-x-2 py-2 text-right whitespace-nowrap">
                  <Link href={editHref(s.id)} className="text-xs font-medium hover:underline">
                    수정
                  </Link>
                  {!s.isPrimary && (
                    <form action={setPrimaryScenarioAction.bind(null, s.productId, s.id)} className="inline">
                      <button type="submit" className="text-xs font-medium hover:underline">
                        대표로
                      </button>
                    </form>
                  )}
                  <ScenarioDeleteButton productId={s.productId} scenarioId={s.id} name={s.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
