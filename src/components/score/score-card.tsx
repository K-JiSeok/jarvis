import { VerdictBadge } from "@/components/common/score-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { formatShortDate } from "@/lib/format";
import type { FactorInputRef, ScoreResult } from "@/lib/scoring/engine";
import { cn } from "@/lib/utils";
import { CONFIDENCE_LABELS, RISK_LABELS, SOURCE_TYPE_LABELS, VERDICT_LABELS } from "@/types/common";
import type { ProductRiskView, SavedScoreView, ScoreKeywordOption } from "@/types/score";

import { ScoreRecalcButton } from "./score-recalc-button";

const ORIGIN_LABELS: Record<ScoreKeywordOption["origin"], string> = {
  WATCHLIST: "관심상품 발견",
  RANK: "검색 순위",
  COMPETITOR: "경쟁관계",
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

function InputMeta({ x }: { x: FactorInputRef }) {
  const parts = [x.source ? SOURCE_TYPE_LABELS[x.source] : null, x.confidence, x.capturedOn ? formatShortDate(x.capturedOn) : null].filter(Boolean);
  return parts.length ? <span className="text-muted-foreground"> ({parts.join(" · ")})</span> : null;
}

/**
 * 상품 상세의 Opportunity Score 영역.
 * - 위: 저장된 현재 점수 (opportunity_scores)
 * - 아래: 현재 데이터로 계산한 요소별 점수·근거 (저장 전 미리 보기). 데이터가 없는 요소는 "미계산"
 */
export function ScoreCard({
  productId,
  saved,
  preview,
  keywordOptions,
  keywordId,
  risks,
  history,
}: {
  productId: string;
  saved: SavedScoreView | null;
  preview: ScoreResult;
  keywordOptions: ScoreKeywordOption[];
  keywordId: string | null;
  risks: ProductRiskView[];
  history: SavedScoreView[];
}) {
  return (
    <div className="space-y-5">
      {/* 저장된 현재 점수 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {saved ? (
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none font-bold tabular-nums">{fmt(saved.total)}</span>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] leading-none">/ 100</span>
              <VerdictBadge verdict={saved.verdict} />
            </div>
            <div className="text-muted-foreground space-y-0.5 text-xs">
              <p>
                저장된 점수 · {dateTime.format(new Date(saved.calculatedAt))} · Scoring {saved.scoringVersion}
                {saved.engineVersion && ` · ${saved.engineVersion}`}
              </p>
              <p>
                맥락 키워드 {saved.keyword ?? "없음"} · 데이터 신뢰도 {saved.dataConfidence ? `${saved.dataConfidence} (${CONFIDENCE_LABELS[saved.dataConfidence]})` : "-"} · 자체 계산
              </p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">저장된 점수가 없습니다. 9개 항목이 모두 계산되면 저장할 수 있습니다.</p>
        )}
      </div>

      {/* 맥락 키워드 + 다시 계산 */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <label htmlFor="score-kw" className="text-sm font-medium">
            맥락 키워드
          </label>
          <NativeSelect id="score-kw" name="score_kw" defaultValue={keywordId ?? "none"} className="h-8 w-56 text-xs">
            <option value="none">키워드 없음</option>
            {keywordOptions.map((k) => (
              <option key={k.id} value={k.id}>
                {k.keyword} ({ORIGIN_LABELS[k.origin]})
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="outline">
            미리 보기
          </Button>
        </form>
        <ScoreRecalcButton productId={productId} keywordId={keywordId} />
      </div>

      {/* 현재 데이터 기준 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">현재 데이터 기준 계산</h3>
          {preview.complete ? (
            <span className="flex items-center gap-2 text-sm">
              <strong className="tabular-nums">{fmt(preview.total!)} / 100</strong>
              <VerdictBadge verdict={preview.verdict!} />
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                분석 데이터 부족
              </Badge>
              <span className="text-muted-foreground text-xs tabular-nums">
                계산된 {preview.factors.length - preview.missingFactors.length}/{preview.factors.length}개 항목 · 확보 {fmt(preview.knownPoints)} / {preview.knownWeight}점 · 가능 범위{" "}
                {fmt(preview.range.min)}~{fmt(preview.range.max)}
              </span>
              {preview.verdictIfCertain && (
                <span className="text-xs">
                  미계산 항목과 관계없이 <strong>{VERDICT_LABELS[preview.verdictIfCertain]}</strong> 구간 (저장은 하지 않음)
                </span>
              )}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          미계산 항목은 0점으로 치지 않습니다. 총점·판정은 9개 항목이 모두 계산될 때만 냅니다. 요소 점수는 0~100 (높을수록 판매 후보로 유리)이고, 가중치를
          곱해 합산합니다.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-2 font-normal">항목</th>
                <th className="py-2 text-right font-normal">점수</th>
                <th className="py-2 pl-4 font-normal">근거 · 원본 데이터</th>
                {saved && <th className="py-2 text-right font-normal">저장값</th>}
              </tr>
            </thead>
            <tbody>
              {preview.factors.map((f) => {
                const savedPts = saved?.factorScores[f.factor];
                return (
                  <tr key={f.factor} className="border-b align-top last:border-0">
                    <td className="py-2 font-medium whitespace-nowrap">{f.label}</td>
                    <td className="py-2 text-right whitespace-nowrap tabular-nums">
                      {f.points == null ? (
                        <span className="text-amber-700 dark:text-amber-300">미계산</span>
                      ) : (
                        <>
                          <strong>{fmt(f.points)}</strong>
                          <span className="text-muted-foreground"> / {f.weight}</span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-xs">
                      <p className={cn(f.score == null && "text-muted-foreground")}>{f.basis}</p>
                      {f.score == null && f.missing.length > 0 && <p className="text-amber-700 dark:text-amber-300">필요: {f.missing.join(", ")}</p>}
                      {f.inputs.some((x) => x.value != null) && (
                        <details className="mt-0.5">
                          <summary className="text-muted-foreground cursor-pointer">원본 {f.inputs.filter((x) => x.value != null).length}건</summary>
                          <ul className="mt-1 space-y-0.5">
                            {f.inputs
                              .filter((x) => x.value != null)
                              .map((x, i) => (
                                <li key={i}>
                                  {x.name}: {typeof x.value === "number" ? x.value.toLocaleString("ko-KR") : x.value}
                                  <InputMeta x={x} />
                                </li>
                              ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    {saved && (
                      <td className="text-muted-foreground py-2 text-right text-xs tabular-nums">
                        {savedPts == null ? "-" : `${fmt((savedPts * f.weight) / 100)} / ${f.weight}`}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-xs">
          데이터 신뢰도 {preview.dataConfidence ?? "-"}
          {preview.dateRange && ` · 사용 데이터 수집일 ${formatShortDate(preview.dateRange.from)} ~ ${formatShortDate(preview.dateRange.to)}`} · 계산 기준{" "}
          {preview.scoringVersion} / {preview.engineVersion}
        </p>
      </div>

      {preview.reasons.length > 0 && (
        <ul className="space-y-1 text-sm">
          {preview.reasons.map((r, i) => (
            <li key={i} className={r.kind === "POSITIVE" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              {r.kind === "POSITIVE" ? "＋" : "！"} {r.message}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">위험 요소 (참고 — 점수에 반영하지 않음)</h3>
        {risks.length === 0 ? (
          <p className="text-muted-foreground text-xs">등록된 위험 요소 없음</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {risks.map((r) => (
              <li key={r.id}>
                <Badge variant={r.level === "HIGH" ? "destructive" : "outline"} className="mr-1.5">
                  {RISK_LABELS[r.type]} · {r.level}
                </Badge>
                {r.description}
              </li>
            ))}
          </ul>
        )}
      </div>

      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">점수 이력 ({history.length})</summary>
          <ul className="mt-2 space-y-1 text-xs tabular-nums">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{dateTime.format(new Date(h.calculatedAt))}</span>
                <strong>{fmt(h.total)}</strong>
                <VerdictBadge verdict={h.verdict} />
                <span className="text-muted-foreground">
                  {h.scoringVersion} · 키워드 {h.keyword ?? "없음"}
                  {h.isCurrent ? " · 현재" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
