import Link from "next/link";

import { VerdictBadge } from "@/components/common/score-badge";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { AREA_LABELS, COMPLIANCE_LABELS } from "@/lib/automation/compliance";
import { productReadiness } from "@/lib/discover/readiness";
import type { ComplianceView } from "@/lib/repositories/automation";
import { discoverStatus } from "@/lib/discover/summary";

import { ComplianceForm } from "./automation-forms";
import { ComplianceBadge } from "./automation-panel";
import { ReadinessList } from "./readiness-list";
import { formatPercent, formatShortDate, formatWon } from "@/lib/format";
import type { DiscoverOrigin, DiscoverProduct } from "@/lib/repositories/discover";
import { cn } from "@/lib/utils";
import { RISK_LABELS, type Confidence, type SourceType } from "@/types/common";
import { isSourceType } from "@/types/db";

const ORIGIN_LABELS: Record<DiscoverOrigin, string> = { RANK: "검색 순위", COMPETITOR: "경쟁 관계", WATCHLIST: "관심상품" };
const LEVEL_LABELS = { LOW: "낮음", MEDIUM: "보통", HIGH: "높음" } as const;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** 상품 1개 분석 카드 — 값은 모두 Score Engine V1 결과 · 기존 Profit 계산 결과 그대로 */
export function DiscoverProductCard({ p, compliance = null }: { p: DiscoverProduct; compliance?: ComplianceView | null }) {
  const r = p.preview;
  const status = discoverStatus(r);
  const calc = p.primaryScenario?.current ?? null;
  const known = r.factors.length - r.missingFactors.length;
  const positives = r.reasons.filter((x) => x.kind === "POSITIVE");
  const cautions = r.reasons.filter((x) => x.kind === "CAUTION");
  const missing = [...new Set(r.factors.flatMap((f) => (f.score == null ? f.missing : [])))];

  return (
    <article className="space-y-3 rounded-lg border p-4" data-product={p.coupangProductId} data-status={status}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href={`/products/${p.id}`} className="font-semibold hover:underline">
            {p.productName}
          </Link>
          <p className="text-muted-foreground text-xs">
            쿠팡 상품 ID {p.coupangProductId}
            {p.latestRank.capturedOn && (
              <>
                {" "}
                · 순위 {p.latestRank.organic != null ? `자연 ${p.latestRank.organic}위` : ""}
                {p.latestRank.ad != null ? ` 광고 ${p.latestRank.ad}위` : ""} ({formatShortDate(p.latestRank.capturedOn)})
              </>
            )}{" "}
            · {p.origins.map((o) => ORIGIN_LABELS[o]).join(" · ")}
          </p>
          <ComplianceBadge status={compliance?.status ?? null} decidedBy={compliance?.decidedBy ?? null} />
        </div>
        <div className="text-right" data-testid="discover-verdict">
          {status === "FINAL" ? (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums">{fmt(r.total!)}</span>
              <VerdictBadge verdict={r.verdict!} />
            </div>
          ) : status === "PROVISIONAL" ? (
            <div className="space-y-0.5">
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                잠정 분석 · 최종 판정 아님
              </Badge>
              <p className="text-muted-foreground text-xs tabular-nums">
                계산 {known}/9 · 확보 {fmt(r.knownPoints)}/{r.knownWeight}점 · 가능 범위 {fmt(r.range.min)}~{fmt(r.range.max)}
              </p>
            </div>
          ) : (
            <Badge variant="outline">분석 불가 · 계산된 요소 없음</Badge>
          )}
        </div>
      </header>

      {/* 판매 가능성 사전 검토 (PHASE 17) — 점수와 별도, 법률 판단 · 쿠팡 승인 아님 */}
      <details className="rounded-md border px-3 py-2" data-testid="discover-compliance">
        <summary className="cursor-pointer text-xs font-semibold">
          판매 가능성 · 인증 · 브랜드 · 공급 {compliance ? `— ${COMPLIANCE_LABELS[compliance.status]}` : "— 미검토 (다음 자동 실행에서 검토)"}
        </summary>
        <div className="mt-2 space-y-2 text-xs">
          {compliance && (
            <ul className="space-y-1">
              {compliance.findings.map((f, i) => (
                <li key={i} className="rounded border px-2 py-1" data-finding={f.rule}>
                  <strong>{AREA_LABELS[f.area] ?? f.area}</strong> · {COMPLIANCE_LABELS[f.status]} · {f.method === "USER" ? "사용자" : "자동"} ({f.checkedAt.slice(0, 10)})
                  <br />
                  근거: {f.evidence}
                  {f.source !== "-" && (
                    <>
                      <br />
                      확인할 규정: {f.source}
                    </>
                  )}
                  {f.action !== "-" && (
                    <>
                      <br />
                      할 일: {f.action}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">자동 검토는 상품명 · 카테고리로 확인할 규정의 가능성만 표시합니다. 판매 불가 · 확인 완료는 근거를 확인한 뒤 직접 정합니다.</p>
          <ComplianceForm productId={p.id} />
        </div>
      </details>

      {/* 데이터 준비 상태 (PHASE 16) — 점수 · 판정을 대체하지 않음 */}
      <details className="rounded-md border px-3 py-2" open={status !== "FINAL"}>
        <summary className="cursor-pointer text-xs font-semibold">데이터 준비 상태 · 다음에 할 일</summary>
        <div className="mt-2">
          <ReadinessList
            testId="discover-readiness"
            items={productReadiness({
              input: p.input,
              result: r,
              reviewHistory: p.reviewHistory,
              scenario: p.primaryScenario ? { hasCalculation: !!calc, netProfitPerUnit: calc?.netProfitPerUnit ?? null, netMarginRate: calc?.netMarginRate ?? null } : null,
            })}
          />
        </div>
      </details>

      {/* 9개 요소 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-1.5 font-normal">요소 (가중치)</th>
              <th className="py-1.5 text-right font-normal">점수</th>
              <th className="py-1.5 pl-3 font-normal">근거</th>
              <th className="py-1.5 pl-3 font-normal">데이터 출처 · 신뢰도 · 수집일</th>
            </tr>
          </thead>
          <tbody>
            {r.factors.map((f) => {
              const used = f.inputs.filter((x) => x.value != null);
              return (
                <tr key={f.factor} className="border-b align-top last:border-0" data-factor={f.factor} data-score={f.score ?? ""}>
                  <td className="py-1.5 whitespace-nowrap">
                    {f.label} <span className="text-muted-foreground">({f.weight})</span>
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                    {f.score == null ? <span className="text-amber-700 dark:text-amber-300">— 데이터 부족</span> : <strong>{fmt(f.score)}</strong>}
                  </td>
                  <td className={cn("py-1.5 pl-3", f.score == null && "text-muted-foreground")}>{f.basis}</td>
                  <td className="py-1.5 pl-3">
                    {used.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {used.slice(0, 3).map((x, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-1">
                            <span>
                              {x.name}: {typeof x.value === "number" ? x.value.toLocaleString("ko-KR") : x.value}
                            </span>
                            {isSourceType(x.source) && x.confidence && <SourceBadge source={x.source as SourceType} confidence={x.confidence as Confidence} />}
                            {x.capturedOn && <span className="text-muted-foreground">{formatShortDate(x.capturedOn)}</span>}
                          </li>
                        ))}
                        {used.length > 3 && <li className="text-muted-foreground">외 {used.length - 3}건</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 text-xs md:grid-cols-4">
        <section>
          <h4 className="mb-1 font-semibold">수익성 (대표 시나리오)</h4>
          {calc ? (
            <ul className="space-y-0.5 tabular-nums" data-testid="discover-profit">
              <li>판매가 {formatWon(p.primaryScenario!.salePrice)}</li>
              <li>개당 순이익 {formatWon(calc.netProfitPerUnit)}</li>
              <li>순이익률 {calc.netMarginRate == null ? "-" : formatPercent(calc.netMarginRate)}</li>
              <li>손익분기 판매가 {formatWon(calc.breakEvenPrice)}</li>
              {calc.monthlyNetProfit != null && <li className="text-muted-foreground">월 순이익 {formatWon(calc.monthlyNetProfit)} (내가 입력한 예상 판매량 기준 · 예측값)</li>}
              <li className="text-muted-foreground">{calc.formulaVersion} · 자체 계산</li>
            </ul>
          ) : (
            <p className="text-muted-foreground">수익성 시나리오 없음 — 상품 상세의 수익성 계산기에서 입력 (원가 · 수수료 없이 추정하지 않음)</p>
          )}
        </section>
        <section>
          <h4 className="mb-1 font-semibold">추천 근거</h4>
          {positives.length ? (
            <ul className="list-disc space-y-0.5 pl-4">{positives.map((x, i) => <li key={i}>{x.message}</li>)}</ul>
          ) : (
            <p className="text-muted-foreground">70점 이상 요소 없음</p>
          )}
        </section>
        <section>
          <h4 className="mb-1 font-semibold">주요 위험</h4>
          {cautions.length || p.risks.length ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {p.risks.map((x) => (
                <li key={x.id}>
                  {RISK_LABELS[x.type]} ({LEVEL_LABELS[x.level]}): {x.description}
                </li>
              ))}
              {cautions.map((x, i) => (
                <li key={i}>{x.message}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">없음</p>
          )}
        </section>
        <section>
          <h4 className="mb-1 font-semibold">추가로 필요한 데이터</h4>
          {missing.length ? (
            <ul className="list-disc space-y-0.5 pl-4" data-testid="discover-missing">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">없음 (9개 요소 모두 계산됨)</p>
          )}
        </section>
      </div>
    </article>
  );
}
