/**
 * 검증 루프 (PHASE 30 · validation-v1) — 순수 함수. DB 와 무관하다.
 *
 * 질문: "판정 엔진이 말한 판매량이 맞았나?"
 *
 * 쿠팡은 판매량을 공개하지 않으므로 지금 쓸 수 있는 검증은 세 가지이고, 각각 증명할 수 있는 것이 다르다.
 *
 *   1. 쿠팡 표시 하한 "한 달간 N명 이상 구매" (리뷰와 독립된 근거)
 *        추정 최대값 < N 이면 확실한 과소 추정. 하한이라 과대 추정은 증명하지 못한다.
 *        → 리뷰 작성률의 "상한"만 계산된다: 작성률 ≤ 월 리뷰 수 ÷ N
 *   2. 지속성: 예측한 뒤 7~35일 동안 실제로 늘어난 리뷰 수로 본 판매량이 예측 범위 안에 들었나
 *        같은 리뷰 작성률 가정을 쓰므로 "정확도"가 아니라 "지난달만큼 다음 달에도 팔리나(시즌 · 유행 하락)"를 본다
 *   3. 내 상품 실제 판매 (my_listings · sales_results) — 유일하게 리뷰 작성률을 직접 잴 수 있다. 판매 시작 뒤에 쓴다
 *
 * 그래서 이 화면의 결론은 "가정이 맞다"가 아니라 "가정과 어긋난 증거가 있는가"다.
 */

import { REVIEW_RATE } from "../estimate/sales";

export const VALIDATION_VERSION = "validation-v1";

export const VALIDATION_RULES = {
  /** 예측 뒤 이 일수 이상 지나야 지속성을 본다 (리뷰 증가 추정과 같은 최소 간격) */
  minDays: 7,
  /** 예측 뒤 이 일수 안의 관찰만 쓴다 */
  maxDays: 35,
  /** 예측 시점 리뷰 수: 예측 시작일 앞뒤 이 일수 안의 기록 */
  baseToleranceDays: 3,
} as const;

export interface PredictionInput {
  productId: string;
  /** 예측의 기준일 (데이터 수집일) */
  start: string;
  sales: { min: number; mid: number; max: number };
  verdict: string | null;
  keyword: string | null;
  name: string | null;
}

export interface ReviewPoint {
  on: string;
  count: number;
}

export interface BadgePoint {
  on: string;
  floor: number;
}

export interface PersistenceResult {
  from: string;
  to: string;
  days: number;
  addedReviews: number;
  /** 관찰된 월 판매 (같은 작성률 가정, 가운데 3%) */
  observedMid: number;
  observedMin: number;
  observedMax: number;
  /** 관찰 가운데 값 ÷ 예측 가운데 값 */
  ratio: number;
  /** 관찰 가운데 값이 예측 범위 [min, max] 안 */
  within: boolean;
}

export interface BadgeResult {
  on: string;
  floor: number;
  /** 예측 최대값 < 표시 하한 → 확실한 과소 추정 */
  under: boolean;
}

export interface PredictionEval {
  productId: string;
  start: string;
  status: "PENDING" | "EVALUATED" | "NO_DATA";
  persistence: PersistenceResult | null;
  badge: BadgeResult | null;
  note: string;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export function evaluatePrediction(p: PredictionInput, reviews: ReviewPoint[], badges: BadgePoint[], asOf: string): PredictionEval {
  const R = VALIDATION_RULES;
  const age = daysBetween(p.start, asOf);
  const sorted = [...reviews].sort((a, b) => a.on.localeCompare(b.on));
  const base = sorted.filter((r) => Math.abs(daysBetween(p.start, r.on)) <= R.baseToleranceDays).sort((a, b) => Math.abs(daysBetween(p.start, a.on)) - Math.abs(daysBetween(p.start, b.on)))[0];
  const later = base ? sorted.filter((r) => { const d = daysBetween(base.on, r.on); return d >= R.minDays && d <= R.maxDays; }).at(-1) : undefined;

  let persistence: PersistenceResult | null = null;
  if (base && later) {
    const days = daysBetween(base.on, later.on);
    const added = Math.max(0, later.count - base.count);
    const monthlyReviews = (added / days) * 30;
    const observedMid = Math.round(monthlyReviews / REVIEW_RATE.mid);
    persistence = {
      from: base.on,
      to: later.on,
      days,
      addedReviews: added,
      observedMid,
      observedMin: Math.round(monthlyReviews / REVIEW_RATE.high),
      observedMax: Math.round(monthlyReviews / REVIEW_RATE.low),
      ratio: p.sales.mid > 0 ? Math.round((observedMid / p.sales.mid) * 100) / 100 : 0,
      within: observedMid >= p.sales.min && observedMid <= p.sales.max,
    };
  }

  // 예측 기준일 ~ +35일 사이에 본 가장 최근 하한
  const b = badges.filter((x) => { const d = daysBetween(p.start, x.on); return d >= -R.baseToleranceDays && d <= R.maxDays; }).sort((x, y) => x.on.localeCompare(y.on)).at(-1);
  const badge: BadgeResult | null = b ? { on: b.on, floor: b.floor, under: p.sales.max < b.floor } : null;

  let status: PredictionEval["status"];
  let note: string;
  if (persistence || badge) {
    status = "EVALUATED";
    note = [persistence ? `${persistence.days}일 동안 리뷰 +${persistence.addedReviews} → 월 ${persistence.observedMid.toLocaleString("ko-KR")}개 (예측의 ${Math.round(persistence.ratio * 100)}%)` : null, badge ? `쿠팡 표시 월 ${badge.floor.toLocaleString("ko-KR")}명 이상${badge.under ? " — 예측 최대값보다 큼 (과소 추정)" : ""}` : null]
      .filter(Boolean)
      .join(" · ");
  } else if (age < R.minDays || !base) {
    status = "PENDING";
    note = !base ? "예측 시점 리뷰 수 기록 없음" : `예측 ${age}일 지남 — ${R.minDays}일 뒤 다시 수집하면 확인`;
  } else {
    status = age > R.maxDays ? "NO_DATA" : "PENDING";
    note = age > R.maxDays ? `${R.maxDays}일 안에 다시 수집한 기록이 없다` : "다음 수집을 기다리는 중";
  }
  return { productId: p.productId, start: p.start, status, persistence, badge, note };
}

export interface ValidationSummary {
  version: typeof VALIDATION_VERSION;
  predictions: number;
  evaluated: number;
  pending: number;
  /** 지속성: 확인한 수 · 범위 안 비율 · 관찰/예측 비율 중앙값 */
  persistence: { n: number; withinRate: number | null; medianRatio: number | null; dropCount: number };
  /** 표시 하한: 확인한 수 · 과소 추정 수 */
  badge: { n: number; under: number };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarizeValidation(evals: PredictionEval[]): ValidationSummary {
  const per = evals.map((e) => e.persistence).filter((x): x is PersistenceResult => x != null);
  const badges = evals.map((e) => e.badge).filter((x): x is BadgeResult => x != null);
  const med = median(per.map((x) => x.ratio));
  return {
    version: VALIDATION_VERSION,
    predictions: evals.length,
    evaluated: evals.filter((e) => e.status === "EVALUATED").length,
    pending: evals.filter((e) => e.status === "PENDING").length,
    persistence: {
      n: per.length,
      withinRate: per.length ? Math.round((per.filter((x) => x.within).length / per.length) * 100) / 100 : null,
      medianRatio: med == null ? null : Math.round(med * 100) / 100,
      // 예측의 절반 미만으로 떨어진 상품 (시즌 끝 · 유행 하락 · 과대 추정 의심)
      dropCount: per.filter((x) => x.ratio < 0.5).length,
    },
    badge: { n: badges.length, under: badges.filter((x) => x.under).length },
  };
}

export interface RateBound {
  productId: string;
  name: string | null;
  floor: number;
  monthlyReviews: number;
  /** 리뷰 작성률 상한 = 월 리뷰 수 ÷ 표시 하한 (실제 구매자는 하한 이상이므로 실제 작성률은 이 값 이하) */
  upper: number;
}

/**
 * 리뷰 작성률 상한 (표시 하한 + 같은 시기 리뷰 증가). 가정 범위(1~5%)와 비교:
 *   상한 < 1%  → 가정보다 작성률이 낮다는 증거 (추정 최대값조차 과소)
 *   상한 < 5%  → 추정 최소값(÷5%)은 실제보다 작다 — 보수적인 쪽이라 문제 아님
 *   상한 ≥ 5%  → 이 자료로는 판단할 수 없다 (하한만 알기 때문)
 */
export function reviewRateBound(i: { productId: string; name: string | null; floor: number; monthlyReviews: number }): RateBound | null {
  if (!(i.floor > 0) || !(i.monthlyReviews >= 0)) return null;
  return { ...i, monthlyReviews: Math.round(i.monthlyReviews * 10) / 10, upper: Math.round((i.monthlyReviews / i.floor) * 10_000) / 10_000 };
}
