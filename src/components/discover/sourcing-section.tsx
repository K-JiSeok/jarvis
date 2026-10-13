import Link from "next/link";

import { CostStateChips } from "@/components/costs/cost-result";
import { SUPPLY_SITE_LABELS } from "@/lib/collectors/supplier/page";
import type { DetailResult } from "@/lib/costs/detail";
import type { QueryView, SupplyLinkView } from "@/lib/repositories/sourcing";
import { SUPPLY_STATE_LABELS, supplyState, type SupplyStateKey } from "@/lib/sourcing/cost-record";
import { searchLinks } from "@/lib/sourcing/links";
import { MATCH_LABELS } from "@/lib/sourcing/matching";
import { cn } from "@/lib/utils";

import { SupplyStatusForm } from "./sourcing-forms";

const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const range = (r: { min: number | null; max: number | null }) => (r.min == null ? "-" : r.min === r.max ? won(r.min) : `${won(r.min)} ~ ${won(r.max)}`);
const pct = (v: number | null | undefined) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const STATE_TONE: Partial<Record<SupplyStateKey, string>> = {
  EXPECTED_LOSS: "border-red-300 text-red-700 dark:text-red-300",
  EXPECTED_PROFIT: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  MATCH_UNCLEAR: "border-amber-300 text-amber-700 dark:text-amber-300",
  UNKNOWN_COSTS: "border-amber-300 text-amber-700 dark:text-amber-300",
  ESTIMATE_ONLY: "border-amber-300 text-amber-700 dark:text-amber-300",
  NOT_COMPUTABLE: "border-red-300 text-red-700 dark:text-red-300",
};

/** 상세 원가 (PHASE 20 · cost-detail-v1) 요약 — 추천이 아니라 상태 표시 */
function DetailSummary({ productId, d }: { productId: string; d: DetailResult }) {
  const a = d.confirmed.outcome;
  const b = d.estimated;
  return (
    <div className="space-y-1 rounded-md border border-violet-200 p-2" data-testid="detail-summary" data-status={d.status}>
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        상세 원가 (로켓그로스 · 수입 비용 포함) <CostStateChips result={d} />
      </p>
      {d.status === "NOT_ANALYZABLE" ? (
        <p className="text-muted-foreground">{d.salePrice == null ? "판매가 없음" : "공급 원가 없음 (공급 후보 [선택] 또는 원가 직접 입력)"} → 수익성 분석 불가</p>
      ) : (
        <ul className="space-y-0.5">
          <li>
            A. 확인된 비용 기준: {a ? `이익 ${won(a.profit)} · 마진 ${pct(a.margin)} · 손익분기 ${won(d.confirmed.breakEven)}` : `산출 불가 — 확인 안 된 필수 항목 ${d.confirmed.blocking.length}개`}
          </li>
          <li>
            B. 추정 포함: {b.worst && b.best ? `이익 ${won(b.worst.profit)} ~ ${won(b.best.profit)}` : "-"}
            {b.omitted.length > 0 && <span className="text-red-700 dark:text-red-300"> · 미포함 {b.omitted.length}개 (실제 이익은 더 낮음)</span>}
          </li>
        </ul>
      )}
      <Link href={`/profit/cost?product=${productId}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
        상세 원가 계산 · 비용 입력 →
      </Link>
    </div>
  );
}

/** 사용자가 선택한 후보: 1) 확인 비용만 2) 추정 포함 3) 산출 불가 + 계산 이력 */
function SelectedCost({ l }: { l: SupplyLinkView }) {
  const lc = l.landed;
  const co = lc?.confirmedOnly;
  return (
    <div className="space-y-1 rounded-md border border-blue-200 p-2" data-testid="selected-cost" data-link={l.linkId}>
      <p className="font-semibold">
        선택한 공급 후보: {l.offer.title.slice(0, 40)} · {MATCH_LABELS[l.matchLevel]}
        {l.matchLevel !== "HIGH" && <span className="text-amber-700 dark:text-amber-300"> — 확정 매칭 아님</span>}
      </p>
      {lc ? (
        <ol className="list-decimal space-y-0.5 pl-5">
          <li data-result="confirmed">
            확인된 비용만: 원가 {won(co?.cost)} (제외: {co?.excluded.slice(0, 3).join(" · ")} 외) →{" "}
            {co?.profit?.complete ? (
              <>
                이익 {won(co.profit.netProfitPerUnit)} · 마진 {pct(co.profit.netMarginRate)} <span className="text-muted-foreground">(실제보다 좋게 나오는 하한 원가 — 확정 수익 아님)</span>
              </>
            ) : (
              <span className="text-muted-foreground">산출 불가 — 쿠팡 수수료율 미설정 (추정 수수료를 넣지 않음)</span>
            )}
          </li>
          <li data-result="estimated">
            추정 포함 시나리오: 도착 원가 {lc.landed ? range(lc.landed) : "-"} · 이익 {lc.profit ? `${won(lc.profit.low.netProfitPerUnit)} ~ ${won(lc.profit.high.netProfitPerUnit)}` : "-"} · 신뢰도 {lc.confidence}
          </li>
          <li data-result="insufficient">
            산출 불가 · 부족: {(lc.insufficient ?? []).join(" / ") || "없음"} · 미확인 비용 {lc.unknownItems.length}개
          </li>
        </ol>
      ) : (
        <p className="text-muted-foreground">원가 계산 불가 (가격 또는 환율 없음)</p>
      )}
      <details>
        <summary className="cursor-pointer">계산 이력 {l.costHistory.length}건 (수정되지 않음 · 입력이 바뀔 때만 새로 쌓임)</summary>
        <table className="mt-1 w-full" data-testid="cost-history">
          <tbody>
            {l.costHistory.map((h) => (
              <tr key={h.id} className="border-b last:border-0">
                <td className="py-0.5 pr-2 whitespace-nowrap">{h.computedAt.slice(0, 16).replace("T", " ")}</td>
                <td className="py-0.5 pr-2">원가 {range({ min: h.landedMin, max: h.landedMax })}</td>
                <td className="py-0.5 pr-2">이익 {h.estimated ? `${won(h.estimated.low?.netProfitPerUnit)} ~ ${won(h.estimated.high?.netProfitPerUnit)}` : "-"}</td>
                <td className="text-muted-foreground py-0.5">
                  판매가 {won(h.salePrice)} · {h.unitPrice ? `${h.unitPrice.amount} ${h.unitPrice.currency}` : "-"} · 환율 {h.fx ? `${h.fx.krw} (${h.fx.rateDate})` : "원화"} · {h.engine?.landed} · {h.engine?.profit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const STATUS: Record<SupplyLinkView["userStatus"], string> = { CANDIDATE: "후보", SELECTED: "선택", REJECTED: "제외" };
const ORIGIN: Record<SupplyLinkView["origin"], string> = { TARGET: "이 상품을 찾다 저장", AUTO: "자동 매칭 제안", USER: "직접 연결" };

/** 상품 카드 안의 중국 도매 소싱 (PHASE 18) — 검색어 · 검색 링크 · 공급 후보 비교 · 도착 원가 · 예상 수익성 */
export function SourcingSection({ productId, query, links, detail = null }: { productId: string; query: QueryView | null; links: SupplyLinkView[]; detail?: DetailResult | null }) {
  const searches = query ? searchLinks({ zh: query.zh ?? "", en: query.en ?? "", koCore: query.ko ?? "" }, productId) : [];
  const active = links.filter((l) => l.userStatus !== "REJECTED");
  const states = supplyState(links);
  const selected = links.filter((l) => l.userStatus === "SELECTED");
  return (
    <details className="rounded-md border px-3 py-2" data-testid="discover-sourcing" open={links.length > 0}>
      <summary className="cursor-pointer text-xs font-semibold">
        중국 도매 소싱 — 공급 후보 {active.length}개{links.length > active.length ? ` (제외 ${links.length - active.length})` : ""}
      </summary>
      <div className="mt-2 space-y-3 text-xs">
        <div className="flex flex-wrap gap-1" data-testid="supply-state">
          {states.map((k) => (
            <span key={k} data-supply-state={k} className={cn("rounded border px-1.5 py-0.5", STATE_TONE[k])}>
              {SUPPLY_STATE_LABELS[k]}
            </span>
          ))}
        </div>
        {detail && <DetailSummary productId={productId} d={detail} />}
        {selected.map((l) => (
          <SelectedCost key={l.linkId} l={l} />
        ))}
        {query ? (
          <div className="space-y-1" data-testid="sourcing-query">
            <p>
              검색어 (사전 번역 {query.dictVersion ?? query.method} — 부정확할 수 있어 원문 검색도 같이):{" "}
              <strong>중국어</strong> {query.zh || "-"} · <strong>영어</strong> {query.en || "-"} · <strong>원문</strong> {query.ko || "-"}
              {query.unmapped.length > 0 && <span className="text-muted-foreground"> · 사전에 없는 말: {query.unmapped.join(", ")}</span>}
              {query.packQty != null && <span className="text-muted-foreground"> · 묶음 수량 {query.packQty}</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {searches.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="rounded border px-2 py-1 hover:underline" data-search={s.site}>
                  {s.label}
                  {!s.verified && <span className="text-muted-foreground"> (주소 미확인)</span>}
                </a>
              ))}
            </div>
            <p className="text-muted-foreground">
              링크로 연 검색 결과에서 상품을 열고 확장 프로그램의 [JARVIS 공급 후보 저장]을 누르면 이 상품의 공급 후보로 저장됩니다. 이미지 검색은 1688 · 타오바오 사이트에서
              직접 업로드해야 합니다 (공식 이미지 검색 연동 없음).
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">검색어 없음 — 다음 자동 발굴 실행에서 만듭니다.</p>
        )}

        {links.length === 0 ? (
          <p className="text-muted-foreground">연결된 공급 후보가 없습니다 (원가 · 도착 원가 계산 불가).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]" data-testid="supply-links">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-1.5 font-normal">공급 후보</th>
                  <th className="py-1.5 font-normal">일치</th>
                  <th className="py-1.5 font-normal">가격 · MOQ</th>
                  <th className="py-1.5 font-normal">도착 원가 (쿠팡 1개)</th>
                  <th className="py-1.5 font-normal">예상 이익 · 마진 (판매가 기준)</th>
                  <th className="py-1.5 font-normal" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const lc = l.landed;
                  const p = lc?.profit;
                  return (
                    <tr key={l.linkId} className={cn("border-b align-top last:border-0", l.userStatus === "REJECTED" && "opacity-50")} data-supply={l.offer.id} data-match={l.matchLevel}>
                      <td className="py-1.5 pr-2">
                        <a href={l.offer.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                          {l.offer.title.slice(0, 50)}
                        </a>
                        <div className="text-muted-foreground">
                          {SUPPLY_SITE_LABELS[l.offer.site]} · {l.offer.supplierName ?? "공급업체 미확인"}
                          {l.offer.supplierMeta?.years != null && ` · ${l.offer.supplierMeta.years}년`} · {ORIGIN[l.origin]} · {STATUS[l.userStatus]}
                        </div>
                        <div className="text-muted-foreground">
                          {[l.offer.material, l.offer.sizeText, l.offer.weightKg != null ? `${l.offer.weightKg}kg` : null].filter(Boolean).join(" · ") || "속성 없음"} · 수집 {l.offer.lastCapturedAt.slice(0, 10)}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <strong>{MATCH_LABELS[l.matchLevel]}</strong>
                        <ul className="text-muted-foreground list-disc pl-4">
                          {[...(l.match?.reasons ?? []), ...(l.match?.conflicts ?? []).map((c) => `⚠ ${c}`)].slice(0, 4).map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        {l.offer.basePrice ? `${l.offer.basePrice.amount} ${l.offer.basePrice.currency} (사이트 기준)` : "기준 가격 없음"}
                        <ul className="text-muted-foreground">
                          {l.offer.tiers.slice(0, 4).map((t, i) => (
                            <li key={i}>
                              {t.minQty}
                              {t.maxQty ? `~${t.maxQty}` : "+"}개: {t.amount.toLocaleString("ko-KR")} {t.currency}
                              {l.offer.tiersConverted && " (표시 환산)"}
                            </li>
                          ))}
                        </ul>
                        MOQ {l.offer.moq ?? "-"}
                        {l.history.length > 1 && <div className="text-muted-foreground">가격 기록 {l.history.length}회</div>}
                      </td>
                      <td className="py-1.5 pr-2">
                        {lc?.landed ? (
                          <>
                            <strong className="tabular-nums">{range(lc.landed)}</strong> <span className="text-muted-foreground">(신뢰도 {lc.confidence} · 미확인 비용 제외)</span>
                            <ul className="text-muted-foreground">
                              {lc.lines
                                .filter((x) => x.status !== "UNKNOWN" && x.key !== "fee")
                                .map((x) => (
                                  <li key={x.key}>
                                    {x.status === "ESTIMATED" ? "추정 " : ""}
                                    {x.label}: {range(x)}
                                  </li>
                                ))}
                              <li>미확인: {lc.unknownItems.join(" · ")}</li>
                              {lc.fx && lc.fx.currency !== "KRW" && <li>환율 1 {lc.fx.currency} = {lc.fx.krw}원 ({lc.fx.source}, {lc.fx.rateDate})</li>}
                            </ul>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{lc?.warnings?.[0] ?? "원가 계산 불가 (가격 없음)"}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        {p ? (
                          <>
                            {won(p.low.netProfitPerUnit)} ~ {won(p.high.netProfitPerUnit)}
                            <br />
                            마진 {pct(p.low.netMarginRate)} ~ {pct(p.high.netMarginRate)}
                            <br />
                            <span className="text-muted-foreground">
                              손익분기 {won(p.high.breakEvenPrice)} ~ {won(p.low.breakEvenPrice)}
                              <br />
                              목표 마진 판매가: {lc!.targetPrices.map((t) => `${Math.round(t.margin * 100)}% ${range(t)}`).join(" · ")}
                              <br />
                              {lc!.lines.find((x) => x.key === "fee")?.status === "ESTIMATED" ? "수수료 추정 4~10.8%" : "수수료 설정값"} · Profit Engine {p.low.formulaVersion} · 예상값 (확정 아님)
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">판매가 또는 원가 없음</span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <SupplyStatusForm linkId={l.linkId} status={l.userStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-1">
              가장 싼 후보를 자동으로 고르지 않습니다 — 일치도 · 구성 수량 · MOQ · 배송비를 함께 보고 [선택]하세요. 도착 원가는 미확인 비용(중국 내 배송 · 구매대행 · 통관 수수료 ·
              국내 배송 · 광고비)을 넣지 않은 하한이며, 이 값은 수익성 시나리오로 저장하지 않습니다.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
