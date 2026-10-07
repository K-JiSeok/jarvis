import { formatNumber, formatPercent, formatWon } from "@/lib/format";
import { OMITTED_LABELS, REQUIRED_LABELS } from "@/lib/profit/inputs";
import { cn } from "@/lib/utils";

/** 미리 보기(ProfitResult)와 저장 결과(ProfitCalculationView)가 공통으로 보여 주는 값 */
export interface ResultFigures {
  netProfitPerUnit: number | null;
  netMarginRate: number | null;
  roi: number | null;
  totalCostPerUnit: number | null;
  breakEvenPrice: number | null;
  breakEvenUnits: number | null;
  monthlyNetProfit: number | null;
}

const MONTHLY_UNITS = [100, 300, 500];

function tone(v: number | null) {
  if (v == null) return "";
  return v < 0 ? "text-destructive" : v > 0 ? "text-emerald-700 dark:text-emerald-300" : "";
}

export function ResultSummary({ figures, expectedMonthlyUnits }: { figures: ResultFigures; expectedMonthlyUnits: number | null }) {
  const net = figures.netProfitPerUnit;
  const items = [
    { label: "개당 순이익", value: formatWon(net), cls: tone(net), strong: true },
    { label: "순이익률", value: formatPercent(figures.netMarginRate), cls: tone(figures.netMarginRate), strong: true },
    { label: "ROI", value: formatPercent(figures.roi), cls: tone(figures.roi), strong: true },
    { label: "개당 총비용", value: formatWon(figures.totalCostPerUnit) },
    { label: "손익분기 판매가", value: formatWon(figures.breakEvenPrice) },
    {
      label: "손익분기 판매량",
      value: figures.breakEvenUnits == null ? "-" : `${formatNumber(figures.breakEvenUnits)}개`,
      hint: "초기 고정비 회수",
    },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">
              {i.label}
              {i.hint && <span className="ml-1 text-[10px]">({i.hint})</span>}
            </dt>
            <dd className={cn("mt-0.5 tabular-nums", i.strong ? "text-lg font-semibold" : "font-medium", i.cls)}>{i.value}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="py-1 text-left font-normal">월 판매량</th>
            <th className="py-1 text-right font-normal">월 순이익</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {expectedMonthlyUnits != null && (
            <tr className="border-b font-medium">
              <td className="py-1">{formatNumber(expectedMonthlyUnits)}개 (예상)</td>
              <td className={cn("py-1 text-right", tone(figures.monthlyNetProfit))}>{formatWon(figures.monthlyNetProfit)}</td>
            </tr>
          )}
          {MONTHLY_UNITS.map((u) => (
            <tr key={u} className="border-b last:border-0">
              <td className="py-1">{u}개</td>
              <td className={cn("py-1 text-right", tone(net))}>{formatWon(net == null ? null : net * u)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MissingNotes({ missingRequired, omitted, errors = [], warnings = [] }: { missingRequired: string[]; omitted: string[]; errors?: string[]; warnings?: string[] }) {
  return (
    <div className="space-y-1 text-xs">
      {missingRequired.length > 0 && (
        <p className="text-amber-700 dark:text-amber-300">
          {missingRequired.map((k) => REQUIRED_LABELS[k] ?? k).join(" · ")} 미입력 — 결과를 계산하지 않습니다 (추정값으로 채우지 않음).
        </p>
      )}
      {errors.map((e) => (
        <p key={e} className="text-destructive">
          {e}
        </p>
      ))}
      {omitted.length > 0 && (
        <p className="text-muted-foreground">미입력으로 계산에서 뺀 비용: {omitted.map((k) => OMITTED_LABELS[k] ?? k).join(", ")}</p>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-muted-foreground">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}
