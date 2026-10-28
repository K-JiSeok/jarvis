/**
 * 판정 엔진 V2 (PHASE 26 · judge-v2) — 순수 함수. DB 와 무관하다.
 *
 * 질문 하나에 답한다: "이 상품을 쿠팡 로켓그로스로 팔면 확실히 남는가?"
 *
 * 구조
 *   시장 점수 (키워드 단위)  수요 30 · 리뷰 장벽 30 · 판매자 구성 30 · 광고 부담 10
 *   상품 점수 (후보 단위)    단위 경제성 45 · 판매 근거 35 · 가격대 15~4만원 20 · (+전환율 가산 최대 5)
 *   총점 = 시장 50% + 상품 50%
 *
 * V1 과 다른 점
 *   - 공개 데이터로 구할 수 없는 값(남의 상품 전환율 · 실제 판매량)을 판정의 필수 조건으로 두지 않는다.
 *     핵심 요소(수요 · 리뷰 장벽 · 판매자 구성 · 단위 경제성 · 판매 근거)가 있으면 판정한다.
 *   - "확실한 수익" 관문: 점수가 높아도 아래에 걸리면 판정을 낮춘다.
 *       단품 · 묶음 모두 원가 여유 없음 → 제외 / 실제 공급 원가로 순이익률 10% 미만 → 제외, 목표 미만 → 검토
 *       판매 추정 최소값 < 월 30개 → 검토까지 / 시장 위험 2개 이상 → 검토까지 / 판매 불가 확인 → 제외
 *   - 판정 옆에 신뢰도 A/B/C 와 그 이유를 붙인다.
 *
 * judge-v2.1 (PHASE 28) — 10-28 실제 데이터에서 드러난 세 가지를 막는다
 *   - 계절성: 검색량이 급증했으면 급증 전 값으로 수요를 계산한다. 시즌 상품은 입고(약 6주) 뒤 남은 시즌이 60일 미만이면 검토까지
 *   - 인증: 전기 · 전파 등 인증이 필요한 상품은 인증서 · 비용 확인 전 강력추천 불가 (판매 가능성 규칙 v2 와 함께)
 *   - 판매량 과대 추정: 같은 키워드 상품 추정 중앙값의 3배를 넘으면 그 값으로 낮춘다 (옵션 리뷰 합산)
 */

import { JUDGE_ASSUMPTIONS, JUDGE_THRESHOLDS, JUDGE_WEIGHTS } from "../../config/judge-assumptions";
import type { UnitEconomics } from "../estimate/economics";
import type { SalesEstimate } from "../estimate/sales";
import type { MarketStructure } from "../market/structure";
import { seasonOf, type SeasonResult, type VolumePoint } from "./season";
import { interpolate, RULES } from "../scoring/engine";
import type { Confidence, DataPoint, Verdict } from "../../types/common";

export const JUDGE_VERSION = "judge-v2.1";

/** 시장 데이터가 이 일수보다 오래되면 신뢰도 C · 재수집 안내 */
export const STALE_DAYS = 14;

/** 검색 결과 자연 순위가 이보다 적으면 시장 구조를 쓰지 않는다 (PHASE 29 — 시장 구조는 상위 10개 기준) */
export const MIN_ORGANIC = 10;

const CURVES = {
  adRatio: [[0.1, 100], [0.2, 70], [0.3, 40], [0.5, 0]],
  /** 단품 1개로 쓸 수 있는 도착 원가(원) → 경제성 (공급 원가를 모를 때) */
  allowedCost: [[0, 0], [1_500, 20], [4_000, 60], [8_000, 90], [12_000, 100]],
  /** 판매 추정 최소값(월) → 판매 근거 */
  salesMin: [[0, 0], [30, 40], [100, 70], [300, 100]],
  conversionBonus: [[0.02, 0], [0.05, 3], [0.1, 5]],
} as const;

export interface JudgeInput {
  /** 계산 기준일 (KST YYYY-MM-DD) */
  asOf: string;
  keyword: string | null;
  searchVolume: DataPoint | null;
  searchGrowthRate: DataPoint | null;
  market: MarketStructure | null;
  price: number | null;
  sales: SalesEstimate | null;
  economics: UnitEconomics | null;
  /** 실제 공급 후보 원가로 계산한 순이익률 (확정 > 추정 최악값). 모르면 null */
  supplyMargin: { value: number; status: "CONFIRMED" | "ESTIMATED" } | null;
  /** 내 상품 WING 전환율 (있을 때만 가산) */
  conversionRate: number | null;
  /** 판매 가능성 확인 상태 (product_compliance · 새 규칙으로 다시 본 값) */
  compliance: string | null;
  /** 걸린 인증 규칙 이름 (전기용품 KC · 전파법 …) — PHASE 28 */
  certifications?: string[];
  /** 상품명 (시즌 단어) — PHASE 28 */
  productName?: string | null;
  /** 이 키워드의 네이버 월 검색량 기록 (급증 판단) — PHASE 28 */
  searchVolumeHistory?: VolumePoint[] | null;
  /** 같은 키워드 상품들의 판매 추정 최소값 (과대 추정 판단) — PHASE 28 */
  peerSalesMin?: number[] | null;
}

export type JudgePart = "demand" | "reviewBarrier" | "sellerMix" | "adBurden" | "economics" | "salesEvidence" | "priceFit";

export interface PartResult {
  part: JudgePart;
  label: string;
  weight: number;
  score: number | null;
  basis: string;
  core: boolean;
}

export interface JudgeRisk {
  code: "RETAIL_DOMINANT" | "AD_HEAVY" | "REVIEW_WALL" | "LOW_MARGIN" | "LOW_DEMAND" | "CERTIFICATION" | "BLOCKED" | "PRICE_OUT_OF_BAND" | "STALE_DATA" | "SEASONAL" | "SALES_OUTLIER";
  message: string;
}

export interface JudgeResult {
  version: typeof JUDGE_VERSION;
  marketScore: number | null;
  productScore: number | null;
  total: number | null;
  /** 핵심 요소가 모두 있을 때만. 관문이 판정을 낮출 수 있다 */
  verdict: Verdict | null;
  /** 점수만으로 나온 판정 (관문 적용 전) */
  scoreVerdict: Verdict | null;
  /** 판정이 없어도 결론이 확실한 경우 (빠진 요소가 0~100 어느 값이어도 같은 판정) */
  verdictIfCertain: Verdict | null;
  range: { min: number; max: number };
  confidence: Confidence | null;
  confidenceWhy: string[];
  gates: string[];
  parts: PartResult[];
  missing: string[];
  risks: JudgeRisk[];
  positives: string[];
  /** 시즌 · 검색량 급증 판단 (PHASE 28). 해당 없으면 null */
  season: SeasonResult | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function verdictOf(score: number): Verdict {
  return score >= JUDGE_THRESHOLDS.strongBuy ? "STRONG_BUY" : score >= JUDGE_THRESHOLDS.review ? "REVIEW" : "EXCLUDE";
}
const RANK: Record<Verdict, number> = { STRONG_BUY: 2, REVIEW: 1, EXCLUDE: 0 };
const cap = (v: Verdict, max: Verdict): Verdict => (RANK[v] > RANK[max] ? max : v);

function weighted(parts: PartResult[]): { score: number | null; min: number; max: number } {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const known = parts.filter((p) => p.score != null);
  const knownPts = known.reduce((s, p) => s + p.weight * p.score!, 0);
  const unknownW = total - known.reduce((s, p) => s + p.weight, 0);
  const allKnown = known.length === parts.length;
  // 선택 요소(광고 부담 · 가격대)가 빠지면 아는 요소끼리 비율로 낸다
  const coreKnown = parts.filter((p) => p.core).every((p) => p.score != null);
  const knownW = total - unknownW;
  return {
    score: allKnown ? knownPts / total : coreKnown && knownW > 0 ? knownPts / knownW : null,
    min: knownPts / total,
    max: (knownPts + unknownW * 100) / total,
  };
}

export function judge(i: JudgeInput): JudgeResult {
  const W = JUDGE_WEIGHTS;
  const A = JUDGE_ASSUMPTIONS;
  // PHASE 29: 화면이 다 그려지기 전에 읽어 칸이 적은 검색 결과는 시장 구조로 쓰지 않는다 (10-28 캠핑랜턴 2칸)
  const thinMarket = i.market != null && i.market.organic < MIN_ORGANIC;
  const m = thinMarket ? null : i.market;
  const risks: JudgeRisk[] = [];
  const positives: string[] = [];

  // 시장 ------------------------------------------------------------------------------
  const season = seasonOf({ asOf: i.asOf, keyword: i.keyword, productName: i.productName ?? null, history: i.searchVolumeHistory ?? null });
  const spike = season?.spike ?? null;
  const vol = i.searchVolume?.value ?? null;
  let demand: number | null = null;
  let demandBasis = "네이버 월 검색량 없음";
  if (vol != null) {
    // 급증했으면 급증 전 값으로 계산한다 (성수기 검색량을 1년 내내 있는 수요로 보지 않음)
    const used = spike && spike.latest === vol ? spike.base : vol;
    demand = interpolate(used, RULES.demandVolume);
    demandBasis = used !== vol ? `월 검색량 ${vol.toLocaleString("ko-KR")} — 급증 전(${spike!.baseOn}) ${used.toLocaleString("ko-KR")} 기준` : `월 검색량 ${vol.toLocaleString("ko-KR")}`;
    const g = i.searchGrowthRate?.value;
    if (g != null && used === vol) {
      demand = Math.min(100, Math.max(0, demand + Math.max(-10, Math.min(10, g * 20))));
      demandBasis += ` · 추세 ${g >= 0 ? "+" : ""}${pct(g)}`;
    }
  }
  let review: number | null = null;
  let reviewBasis = thinMarket ? `검색 결과 자연 순위 ${i.market!.organic}칸뿐 — 다시 수집 필요` : "검색 결과 수집 없음";
  if (m?.medianReviews != null) {
    const low = m.reviewKnown ? (m.lowReviewCount / m.reviewKnown) * 100 : 0;
    review = 0.7 * interpolate(m.medianReviews, RULES.reviewCount) + 0.3 * low;
    reviewBasis = `상위 ${m.topN}개 리뷰 중앙값 ${Math.round(m.medianReviews).toLocaleString("ko-KR")}개 · 100개 미만 ${m.lowReviewCount}/${m.reviewKnown}`;
  }
  let sellerMix: number | null = null;
  let sellerBasis = m ? `판매자 유형 확인 ${m.sellerKnown}개 (비율 계산에 부족)` : thinMarket ? `검색 결과 자연 순위 ${i.market!.organic}칸뿐 — 다시 수집 필요` : "검색 결과 수집 없음";
  if (m?.thirdPartyRatio != null && m.retailRatio != null) {
    sellerMix = (interpolate(m.thirdPartyRatio, RULES.wingRatio) + interpolate(m.retailRatio, RULES.retailRatio)) / 2;
    sellerBasis = `제3자 판매자 ${pct(m.thirdPartyRatio)} · 쿠팡 직매입 ${pct(m.retailRatio)}`;
  }
  const adBurden = m?.adRatio != null ? interpolate(m.adRatio, CURVES.adRatio) : null;

  const marketParts: PartResult[] = [
    { part: "demand", label: "수요", weight: W.market.demand, score: demand, basis: demandBasis, core: true },
    { part: "reviewBarrier", label: "리뷰 장벽", weight: W.market.reviewBarrier, score: review, basis: reviewBasis, core: true },
    { part: "sellerMix", label: "판매자 구성", weight: W.market.sellerMix, score: sellerMix, basis: sellerBasis, core: true },
    { part: "adBurden", label: "광고 부담", weight: W.market.adBurden, score: adBurden, basis: m?.adRatio != null ? `검색 결과 광고 칸 ${pct(m.adRatio)}` : "검색 결과 수집 없음", core: false },
  ];

  // 상품 ------------------------------------------------------------------------------
  let econ: number | null = null;
  let econBasis = "판매가 · 쿠팡 비용표로 계산할 수 없음";
  if (i.supplyMargin) {
    econ = interpolate(i.supplyMargin.value, RULES.marginRate);
    econBasis = `실제 공급 원가 기준 순이익률 ${pct(i.supplyMargin.value)} (${i.supplyMargin.status === "CONFIRMED" ? "확정" : "추정 최악값"})`;
  } else if (i.economics) {
    const best = i.economics.bestBundle && i.economics.bestBundle.allowedPerUnit > i.economics.single.allowedPerUnit ? i.economics.bestBundle : null;
    const allowed = Math.max(i.economics.single.allowedPerUnit, best?.allowedPerUnit ?? -Infinity);
    econ = interpolate(allowed, CURVES.allowedCost);
    econBasis = `개당 쓸 수 있는 도착 원가 ${won(allowed)}${best ? ` (${best.units}개 묶음 기준)` : ""} — 공급 원가 미확인`;
  }
  let salesEv: number | null = null;
  let salesBasis = "판매량 추정 없음 (상품 페이지 [최신순] 수집 필요)";
  const sm = i.sales?.monthly ?? null;
  // 판매량 과대 추정 (PHASE 28): 같은 키워드 상품 5개 이상의 추정 최소값 중앙값 × 3 을 넘으면 그 값까지만 믿는다
  const peers = (i.peerSalesMin ?? []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const peerMedian = peers.length >= 5 ? (peers.length % 2 ? peers[(peers.length - 1) / 2] : (peers[peers.length / 2 - 1] + peers[peers.length / 2]) / 2) : null;
  const salesCap = peerMedian != null ? Math.round(peerMedian * A.salesOutlierMultiple.value) : null;
  const outlier = sm != null && salesCap != null && sm.min > salesCap;
  if (sm) {
    const usedMin = outlier ? salesCap! : sm.min;
    salesEv = interpolate(usedMin, CURVES.salesMin) * (i.sales!.confidence === "B" ? 1 : 0.85);
    salesBasis = `추정 월 판매 ${sm.min.toLocaleString("ko-KR")}~${sm.max.toLocaleString("ko-KR")}개 (최소값 기준, 신뢰도 ${i.sales!.confidence ?? "-"})`;
    if (outlier) salesBasis += ` → 같은 키워드 중앙값 ${Math.round(peerMedian!).toLocaleString("ko-KR")}개의 ${A.salesOutlierMultiple.value}배인 ${usedMin.toLocaleString("ko-KR")}개로 낮춰 판단`;
  }
  const [lo, hi] = A.priceBand.value;
  let priceFit: number | null = null;
  if (i.price != null) {
    priceFit = i.price >= lo && i.price <= hi ? 100 : i.price < lo ? interpolate(i.price, [[5_000, 0], [lo, 100]]) : 70;
  }
  const productParts: PartResult[] = [
    { part: "economics", label: "단위 경제성", weight: W.product.economics, score: econ, basis: econBasis, core: true },
    { part: "salesEvidence", label: "판매 근거", weight: W.product.salesEvidence, score: salesEv, basis: salesBasis, core: true },
    { part: "priceFit", label: "가격대", weight: W.product.priceFit, score: priceFit, basis: i.price != null ? `판매가 ${won(i.price)} (주력 ${won(lo)}~${won(hi)})` : "판매가 없음", core: false },
  ];

  const mk = weighted(marketParts);
  const pd = weighted(productParts);
  let productScore = pd.score;
  let bonusNote: string | null = null;
  if (productScore != null && i.conversionRate != null) {
    const b = interpolate(i.conversionRate, CURVES.conversionBonus);
    productScore = Math.min(100, productScore + b);
    bonusNote = `전환율 ${pct(i.conversionRate)} → +${r1(b)}점`;
  }
  const total = mk.score != null && productScore != null ? r1((mk.score + productScore) / 2) : null;
  const range = { min: r1((mk.min + pd.min) / 2), max: r1((mk.max + Math.min(100, pd.max + 5)) / 2) };

  // 위험 ------------------------------------------------------------------------------
  for (const x of m?.risks ?? []) risks.push({ code: x.type, message: x.message });
  if (i.economics?.grade === "AVOID" || i.economics?.grade === "CAUTION") {
    risks.push({ code: "LOW_MARGIN", message: `단품 기준 쓸 수 있는 원가 ${won(i.economics.single.allowedPerUnit)} — ${i.economics.grade === "AVOID" ? "단품 판매 비추천" : "원가가 매우 싸야 함"}` });
  }
  if (sm && sm.min < A.minMonthlySales.value) risks.push({ code: "LOW_DEMAND", message: `보수적 추정 월 판매 ${sm.min}개 — 기준 ${A.minMonthlySales.value}개 미만` });
  if (i.compliance === "BLOCKED") risks.push({ code: "BLOCKED", message: "판매 불가로 확인한 상품" });
  else if (i.compliance === "REQUIRES_CERTIFICATION" || i.compliance === "REQUIRES_BRAND_PROOF") {
    const which = i.certifications?.length ? ` (${i.certifications.join(" · ")})` : "";
    risks.push({ code: "CERTIFICATION", message: i.compliance === "REQUIRES_CERTIFICATION" ? `인증 · 허가 · 신고 확인 필요${which} — 인증 비용 · 기간이 원가에 더해진다` : "브랜드 · 정품 증빙 필요" });
  }
  if (outlier) risks.push({ code: "SALES_OUTLIER", message: `판매 추정 최소 월 ${sm!.min.toLocaleString("ko-KR")}개 — 같은 키워드 중앙값의 ${A.salesOutlierMultiple.value}배 초과 (옵션별 리뷰가 합쳐졌을 수 있음)` });
  const seasonShort = season?.group != null && (season.sellDaysAfterArrival ?? 0) < A.minSeasonSellDays.value;
  if (season?.group) {
    risks.push({
      code: "SEASONAL",
      message:
        season.sellDaysAfterArrival === 0
          ? `${season.group.label} 시즌 상품 ("${season.term}") — 지금 발주하면 ${season.arrivalOn} 입고, 그때는 비시즌 (다음 시즌 ${season.nextSeasonMonth}월)`
          : `${season.group.label} 시즌 상품 ("${season.term}") — 지금 발주하면 ${season.arrivalOn} 입고, 남은 시즌 약 ${season.sellDaysAfterArrival}일. 시즌 뒤 남은 재고는 다음 시즌까지 보관`,
    });
  }
  if (spike) risks.push({ code: "SEASONAL", message: `네이버 검색량 급증 ${spike.base.toLocaleString("ko-KR")}(${spike.baseOn}) → ${spike.latest.toLocaleString("ko-KR")}(${spike.latestOn}), +${pct(spike.ratio)} — 시즌 · 일시 유행일 수 있음` });
  if (i.price != null && (i.price < lo || i.price > hi)) risks.push({ code: "PRICE_OUT_OF_BAND", message: `판매가 ${won(i.price)} — 주력 가격대 밖` });
  const marketAge = i.market ? days(i.market.capturedOn, i.asOf) : null;
  if (marketAge != null && marketAge > STALE_DAYS) risks.push({ code: "STALE_DATA", message: `검색 결과가 ${marketAge}일 전 수집 — 다시 수집 필요` });

  // 관문 ------------------------------------------------------------------------------
  const scoreVerdict = total != null ? verdictOf(total) : null;
  const gates: string[] = [];
  let verdict = scoreVerdict;
  if (verdict) {
    const bundleOk = i.economics?.bundles.some((b) => b.grade !== "AVOID") ?? false;
    if (i.compliance === "BLOCKED") {
      verdict = "EXCLUDE";
      gates.push("판매 불가로 확인 → 제외");
    }
    if (!i.supplyMargin && i.economics?.grade === "AVOID" && !bundleOk) {
      verdict = "EXCLUDE";
      gates.push("단품 · 묶음 모두 원가 여유 없음 → 제외");
    }
    if (i.supplyMargin && i.supplyMargin.value < 0.1) {
      verdict = "EXCLUDE";
      gates.push(`실제 원가 기준 순이익률 ${pct(i.supplyMargin.value)} (10% 미만) → 제외`);
    } else if (i.supplyMargin && i.supplyMargin.value < A.targetNetMargin.value) {
      verdict = cap(verdict, "REVIEW");
      gates.push(`실제 원가 기준 순이익률 ${pct(i.supplyMargin.value)} — 목표 ${pct(A.targetNetMargin.value)} 미만 → 검토까지`);
    }
    if (sm && sm.min < A.minMonthlySales.value) {
      verdict = cap(verdict, "REVIEW");
      gates.push(`보수적 판매 추정 월 ${sm.min}개 < ${A.minMonthlySales.value}개 → 검토까지`);
    }
    if ((m?.risks.length ?? 0) >= 2) {
      verdict = cap(verdict, "REVIEW");
      gates.push(`시장 위험 ${m!.risks.length}개 → 검토까지`);
    }
    if (seasonShort) {
      verdict = cap(verdict, "REVIEW");
      gates.push(
        season!.sellDaysAfterArrival === 0
          ? `입고 예정 ${season!.arrivalOn} 은 비시즌 — 다음 시즌(${season!.nextSeasonMonth}월) 준비 상품 → 검토까지`
          : `입고 뒤 남은 시즌 약 ${season!.sellDaysAfterArrival}일 < ${A.minSeasonSellDays.value}일 → 검토까지`,
      );
    } else if (spike && !season?.group) {
      verdict = cap(verdict, "REVIEW");
      gates.push("검색량 급증 원인(시즌 · 유행) 미확인 → 검토까지");
    }
    if (i.compliance === "REQUIRES_CERTIFICATION") {
      verdict = cap(verdict, "REVIEW");
      gates.push(`인증 필요${i.certifications?.length ? `(${i.certifications.join(" · ")})` : ""} — 공급처 인증서 · 인증 비용 확인 전 강력추천 불가 → 검토까지`);
    }
    if (!i.supplyMargin && verdict === "STRONG_BUY") {
      verdict = "REVIEW";
      gates.push("공급 원가 미확인 — 강력추천은 1688 등 실제 원가 확인 뒤에만");
    }
  }
  const vMin = verdictOf(range.min);
  const verdictIfCertain = verdict == null && vMin === verdictOf(range.max) ? vMin : verdict == null && i.compliance === "BLOCKED" ? "EXCLUDE" : null;

  // 신뢰도 ----------------------------------------------------------------------------
  const why: string[] = [];
  let confidence: Confidence | null = null;
  if (total != null) {
    const fresh = marketAge != null && marketAge <= STALE_DAYS;
    const salesB = i.sales?.confidence === "B";
    if (i.supplyMargin?.status === "CONFIRMED" && salesB && fresh) confidence = "A";
    else if ((salesB || i.sales?.buyersFloor != null) && fresh) confidence = "B";
    else confidence = "C";
    why.push(i.supplyMargin ? `공급 원가 ${i.supplyMargin.status === "CONFIRMED" ? "확정" : "추정"}` : "공급 원가 미확인");
    why.push(salesB ? "판매 근거 2개 이상" : i.sales?.buyersFloor != null ? "쿠팡 표시 월 구매자 하한 있음" : "판매 근거 1개 (리뷰만)");
    why.push(fresh ? `검색 결과 ${marketAge}일 전` : `검색 결과 ${marketAge ?? "-"}일 전 (오래됨)`);
  }

  for (const p of [...marketParts, ...productParts]) if (p.score != null && p.score >= 75) positives.push(`${p.label}: ${p.basis}`);
  if (bonusNote) positives.push(bonusNote);
  const missing = [...marketParts, ...productParts].filter((p) => p.core && p.score == null).map((p) => `${p.label} — ${p.basis}`);

  const round = (p: PartResult): PartResult => ({ ...p, score: p.score == null ? null : r1(p.score) });
  return {
    version: JUDGE_VERSION,
    marketScore: mk.score == null ? null : r1(mk.score),
    productScore: productScore == null ? null : r1(productScore),
    total,
    verdict,
    scoreVerdict,
    verdictIfCertain,
    range,
    confidence,
    confidenceWhy: why,
    gates,
    parts: [...marketParts, ...productParts].map(round),
    missing,
    risks,
    positives,
    season,
  };
}

/** 같은 상품의 상세 원가 결과 → 순이익률 (확정 우선, 없으면 추정 최악값) */
export function supplyMarginOf(detail: { confirmed: { outcome: { margin: number } | null }; estimated: { worst: { margin: number } | null } } | null | undefined): JudgeInput["supplyMargin"] {
  if (detail?.confirmed.outcome) return { value: detail.confirmed.outcome.margin, status: "CONFIRMED" };
  if (detail?.estimated.worst) return { value: detail.estimated.worst.margin, status: "ESTIMATED" };
  return null;
}
