/**
 * 판매량 추정 (PHASE 22 · est-sales-v1) — 순수 함수. 쿠팡은 판매량을 공개하지 않으므로 모든 결과는 "추정"이다.
 * Score V1 의 판매량 항목에 넣지 않는다 (V1 은 실제 · 확정 데이터만 — 기존 정책 그대로).
 *
 * 근거 3가지 (있는 것만 쓴다)
 *   1. 쿠팡 상품 페이지 문구 "한 달간 N명 이상 구매했어요" — 쿠팡이 보여 준 월 구매자 수 하한 (확인된 하한, 상한은 모름)
 *   2. 상품 페이지 리뷰 목록을 [최신순]으로 본 최근 리뷰 날짜 — 최근 리뷰 n개가 며칠에 걸쳐 달렸는지 → 하루 리뷰 수
 *   3. 같은 상품의 누적 리뷰 수를 다른 날 다시 수집 — 늘어난 리뷰 수 ÷ 지난 일수 → 하루 리뷰 수 (7일 이상 간격일 때)
 *
 * 리뷰 → 판매: 구매자 중 리뷰를 쓰는 비율을 모른다. 업계에서 흔히 쓰는 가정(쿠파일럿 가이드: 약 3%)을 가운데 값으로,
 * 1% ~ 5% 를 범위로 둔다 → 판매량 = 월 리뷰 수 ÷ 작성률 (최소 = ÷5%, 가운데 = ÷3%, 최대 = ÷1%).
 * 범위가 넓은 것은 정상이다 (실제 작성률을 알 수 없음). 판매량 실측(내 상품 판매 기록)이 생기면 그 값을 우선해야 한다.
 */

export const SALES_ESTIMATE_VERSION = "est-sales-v1";
export const REVIEW_RATE = { low: 0.01, mid: 0.03, high: 0.05, basis: "구매자 리뷰 작성률 가정 1% ~ 5% (가운데 3% — 쿠파일럿 가이드의 계산 기준과 같음)" };
const DAY = 86_400_000;

export interface ReviewSample {
  /** YYYY-MM-DD, 화면 순서 그대로 */
  dates: string[];
  /** 수집한 날 (KST YYYY-MM-DD) */
  capturedOn: string;
}

export interface SalesInput {
  price: number | null;
  /** "800명 이상" 같은 문구 (가장 최근 상품 페이지 수집) */
  monthlyBuyersText: string | null;
  monthlyBuyersOn: string | null;
  reviewSample: ReviewSample | null;
  /** 날짜별 누적 리뷰 수 (같은 날 여러 번이면 하나) */
  reviewHistory: { on: string; count: number }[];
}

export type SalesMethod = "BUYERS_BADGE" | "RECENT_REVIEWS" | "REVIEW_GROWTH";
export const SALES_METHOD_LABELS: Record<SalesMethod, string> = {
  BUYERS_BADGE: "쿠팡 표시 '한 달간 N명 이상 구매'",
  RECENT_REVIEWS: "최근 리뷰 날짜 간격",
  REVIEW_GROWTH: "누적 리뷰 수 증가",
};

export interface SalesEstimate {
  version: typeof SALES_ESTIMATE_VERSION;
  /** 월 판매량 범위 (개) — 추정 */
  monthly: { min: number; mid: number; max: number } | null;
  /** 월 매출 범위 (원) — 판매가 × 판매량 */
  revenue: { min: number; mid: number; max: number } | null;
  /** 쿠팡이 보여 준 월 구매자 하한 (있으면 판매량 최소값은 이 값 이상) */
  buyersFloor: number | null;
  monthlyReviews: number | null;
  methods: { method: SalesMethod; detail: string }[];
  /** C = 근거 1개 · B = 근거 2개 이상 또는 리뷰 증가 14일 이상 */
  confidence: "B" | "C" | null;
  missing: string[];
  nextStep: string | null;
}

export function parseBuyers(text: string | null): number | null {
  const m = text?.replace(/,/g, "").match(/(\d+)\s*(만)?\s*명/);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 10_000 : 1);
}

export function isNewestFirst(dates: string[]): boolean {
  if (dates.length < 3) return false;
  for (let i = 1; i < dates.length; i += 1) if (dates[i] > dates[i - 1]) return false;
  return true;
}

/** 최근 리뷰 n개: 가장 오래된 날 ~ 수집일 사이 하루 리뷰 수. 같은 날 리뷰만 있으면 1일로 본다 */
export function rateFromRecent(s: ReviewSample): { perDay: number; days: number; n: number } | null {
  if (!isNewestFirst(s.dates)) return null;
  const oldest = s.dates[s.dates.length - 1];
  const days = Math.max(1, Math.round((Date.parse(s.capturedOn) - Date.parse(oldest)) / DAY));
  return { perDay: s.dates.length / days, days, n: s.dates.length };
}

export function rateFromGrowth(h: { on: string; count: number }[]): { perDay: number; days: number; added: number } | null {
  const sorted = [...h].sort((a, b) => a.on.localeCompare(b.on));
  if (sorted.length < 2) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = Math.round((Date.parse(last.on) - Date.parse(first.on)) / DAY);
  if (days < 7 || last.count < first.count) return null;
  return { perDay: (last.count - first.count) / days, days, added: last.count - first.count };
}

const r = (n: number) => Math.round(n);

export function estimateSales(i: SalesInput): SalesEstimate {
  const methods: SalesEstimate["methods"] = [];
  const missing: string[] = [];
  const buyersFloor = parseBuyers(i.monthlyBuyersText);
  if (buyersFloor != null) methods.push({ method: "BUYERS_BADGE", detail: `"한 달간 ${i.monthlyBuyersText} 구매했어요" (${i.monthlyBuyersOn ?? "수집일 미상"}) — 쿠팡이 보여 준 하한` });

  const rates: number[] = [];
  const recent = i.reviewSample ? rateFromRecent(i.reviewSample) : null;
  if (recent) {
    rates.push(recent.perDay);
    methods.push({ method: "RECENT_REVIEWS", detail: `최근 리뷰 ${recent.n}개가 ${recent.days}일 동안 → 하루 ${recent.perDay.toFixed(2)}개 (${i.reviewSample!.capturedOn} 수집)` });
  } else if (i.reviewSample && i.reviewSample.dates.length > 0) {
    missing.push("리뷰 목록이 최신순이 아님 (베스트순) — 상품 페이지에서 [최신순]을 누른 뒤 다시 수집");
  } else {
    missing.push("최근 리뷰 날짜 없음 — 상품 페이지를 열어 리뷰를 [최신순]으로 보고 JARVIS 수집");
  }
  const growth = rateFromGrowth(i.reviewHistory);
  if (growth) {
    rates.push(growth.perDay);
    methods.push({ method: "REVIEW_GROWTH", detail: `누적 리뷰 ${growth.added}개 증가 / ${growth.days}일 → 하루 ${growth.perDay.toFixed(2)}개` });
  } else {
    missing.push(i.reviewHistory.length >= 2 ? "리뷰 수 기록 간격이 7일 미만" : "리뷰 수 기록이 1번뿐 — 7일 뒤 다시 수집하면 증가 속도 계산");
  }

  let monthly: SalesEstimate["monthly"] = null;
  let monthlyReviews: number | null = null;
  if (rates.length > 0) {
    // 근거가 둘이면 평균 (서로 크게 다르면 범위가 넓어지도록 최소 · 최대도 반영)
    const lo = Math.min(...rates) * 30;
    const hi = Math.max(...rates) * 30;
    monthlyReviews = Math.round(((lo + hi) / 2) * 10) / 10;
    monthly = { min: r(lo / REVIEW_RATE.high), mid: r(monthlyReviews / REVIEW_RATE.mid), max: r(hi / REVIEW_RATE.low) };
  }
  if (buyersFloor != null) {
    // 쿠팡 표시 하한이 있으면 최소값을 끌어올린다 (리뷰 근거가 없으면 하한만 — 가운데 · 최대는 모름 → 하한을 그대로)
    monthly = monthly ? { min: Math.max(monthly.min, buyersFloor), mid: Math.max(monthly.mid, buyersFloor), max: Math.max(monthly.max, buyersFloor) } : { min: buyersFloor, mid: buyersFloor, max: buyersFloor };
  }
  if (i.price == null) missing.push("판매가 없음 → 매출 추정 불가");
  const revenue = monthly && i.price != null ? { min: monthly.min * i.price, mid: monthly.mid * i.price, max: monthly.max * i.price } : null;
  const confidence = methods.length === 0 ? null : methods.length >= 2 || (growth && growth.days >= 14) ? "B" : "C";
  const nextStep = methods.length === 0 ? "쿠팡 상품 페이지를 열고 리뷰를 [최신순]으로 바꾼 뒤 JARVIS 수집" : !growth ? "7일 이상 지나 같은 상품(또는 검색 결과)을 다시 수집하면 리뷰 증가로 정확도가 올라갑니다" : null;
  return { version: SALES_ESTIMATE_VERSION, monthly, revenue, buyersFloor, monthlyReviews, methods, confidence, missing, nextStep };
}
