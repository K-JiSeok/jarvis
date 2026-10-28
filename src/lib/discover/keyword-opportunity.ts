/**
 * 키워드 기회 · 수집 대기열 (PHASE 29 · kw-opportunity-v1) — 순수 함수. DB 와 무관하다.
 *
 * 왜: 판정은 상품 단위지만, 좋은 상품은 좋은 시장(키워드)에서 나온다. 자동 수집은 주 1회 · 최대 20개라
 *   어떤 키워드에 수집 칸을 쓸지가 발굴 속도를 정한다.
 *
 *   1. keywordOpportunity  추적 키워드마다 시장 점수(판정 V2 의 시장 부분) · 시즌 · 수집 상태 · 다음 할 일
 *   2. queueCandidate      네이버 연관 키워드 후보(수천 개)를 쿠팡 검색 결과 없이 먼저 거르고 순서를 매긴다
 *                          → 위에서부터 사용자가 [추적 등록]하면 다음 자동 수집이 검색 결과를 모은다
 */

import { JUDGE_THRESHOLDS } from "../../config/judge-assumptions";
import { keywordFilter } from "../automation/keyword-filter";
import { RULES as COMPLIANCE_RULES } from "../automation/compliance";
import { judge, type PartResult } from "../judge/engine";
import { seasonOf, type SeasonResult, type VolumePoint } from "../judge/season";
import type { MarketStructure } from "../market/structure";
import { interpolate } from "../scoring/engine";
import type { Verdict } from "../../types/common";

export const KW_OPPORTUNITY_VERSION = "kw-opportunity-v1";

export const KW_OPPORTUNITY_RULES = {
  /** 판매 추정이 이만큼 쌓여야 키워드 판정이 의미 있다 */
  minSalesProducts: 5,
  /** 리뷰 증가로 판매를 추정하려면 같은 키워드를 이 간격 이상 두고 다시 수집해야 한다 */
  regatherDays: 7,
  /** 마지막 수집이 이보다 오래되면 다시 수집 (판정 신뢰도 C 기준과 같음) */
  staleDays: 14,
  /** 시장 점수가 이 미만이면 추적 중지 제안 (판정 "검토" 기준과 같음) */
  poorMarketScore: JUDGE_THRESHOLDS.review,
  /** 마지막 검색 결과의 자연 순위 칸이 이보다 적으면 시장 구조를 믿지 않고 다시 수집 (시장 구조는 상위 10개 기준) */
  minOrganic: 10,
  /** 자동 수집 한 번에 도는 최대 키워드 (확장 프로그램 AUTO_COLLECT_RULES.maxKeywords 와 같음) */
  collectSlots: 20,
} as const;

export type KwStage = "NEED_SEARCH" | "STALE" | "POOR_MARKET" | "WAIT_SALES" | "JUDGEABLE";

export const KW_STAGE_LABELS: Record<KwStage, string> = {
  NEED_SEARCH: "검색 결과 수집 필요",
  STALE: "다시 수집 필요",
  POOR_MARKET: "시장 부적합",
  WAIT_SALES: "판매 추정 대기",
  JUDGEABLE: "판정 가능",
};

export interface KwProductSummary {
  verdict: Verdict | null;
  total: number | null;
  hasSales: boolean;
  /** 인증 필요 (판매 가능성 REQUIRES_CERTIFICATION) */
  certification: boolean;
}

export interface KwOpportunityInput {
  keyword: string;
  asOf: string;
  searchVolume: number | null;
  volumeHistory: VolumePoint[];
  market: MarketStructure | null;
  /** 검색 결과를 수집한 날짜들 (중복 없이) */
  collectedDays: string[];
  /** 가장 최근 수집일 검색 결과에 나온 등록 상품 */
  products: KwProductSummary[];
}

export interface KwOpportunity {
  version: typeof KW_OPPORTUNITY_VERSION;
  keyword: string;
  marketScore: number | null;
  marketParts: PartResult[];
  marketRisks: string[];
  season: SeasonResult | null;
  stage: KwStage;
  nextAction: string;
  lastCollectedOn: string | null;
  /** 다음에 다시 수집하면 좋은 날 (판매 추정 대기일 때) */
  regatherOn: string | null;
  productCount: number;
  salesCount: number;
  certRatio: number | null;
  verdicts: Record<Verdict | "NONE", number>;
  best: { verdict: Verdict; total: number } | null;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const VRANK: Record<Verdict, number> = { STRONG_BUY: 2, REVIEW: 1, EXCLUDE: 0 };

export function keywordOpportunity(i: KwOpportunityInput): KwOpportunity {
  const R = KW_OPPORTUNITY_RULES;
  // 시장 점수는 판정 V2 와 같은 식으로 (상품 입력 없이) 계산한다
  const j = judge({
    asOf: i.asOf,
    keyword: i.keyword,
    searchVolume: i.searchVolume != null ? { value: i.searchVolume, source: "OFFICIAL_API", confidence: "A" } : null,
    searchGrowthRate: null,
    market: i.market,
    price: null,
    sales: null,
    economics: null,
    supplyMargin: null,
    conversionRate: null,
    compliance: null,
    searchVolumeHistory: i.volumeHistory,
  });
  const days = [...new Set(i.collectedDays)].sort();
  const last = days.at(-1) ?? null;
  const salesCount = i.products.filter((p) => p.hasSales).length;
  const certCount = i.products.filter((p) => p.certification).length;
  const verdicts: KwOpportunity["verdicts"] = { STRONG_BUY: 0, REVIEW: 0, EXCLUDE: 0, NONE: 0 };
  let best: KwOpportunity["best"] = null;
  for (const p of i.products) {
    verdicts[p.verdict ?? "NONE"] += 1;
    if (p.verdict && p.total != null && (!best || VRANK[p.verdict] > VRANK[best.verdict] || (p.verdict === best.verdict && p.total > best.total))) best = { verdict: p.verdict, total: p.total };
  }

  let stage: KwStage;
  let nextAction: string;
  let regatherOn: string | null = null;
  const age = last ? daysBetween(last, i.asOf) : null;
  if (!i.market || !last) {
    stage = "NEED_SEARCH";
    nextAction = "쿠팡 검색 결과가 없다 — 다음 자동 수집 때 처음 모은다 (아직 수집하지 않은 키워드부터 돈다)";
  } else if (i.market.organic < R.minOrganic) {
    // 10-28 자동 수집의 캠핑랜턴처럼 화면이 다 그려지기 전에 읽으면 칸이 몇 개뿐이다 — 시장 점수를 믿지 않는다
    stage = "NEED_SEARCH";
    nextAction = `마지막 검색 결과가 자연 순위 ${i.market.organic}칸뿐 — 시장 구조를 믿을 수 없어 다음 자동 수집 때 다시 모은다`;
  } else if (j.marketScore != null && (j.marketScore < R.poorMarketScore || i.market.risks.length >= 2)) {
    stage = "POOR_MARKET";
    nextAction = `시장 점수 ${j.marketScore}${i.market.risks.length >= 2 ? ` · 시장 위험 ${i.market.risks.length}개` : ""} — 추적을 멈추면 자동 수집 칸을 다른 키워드에 쓸 수 있다`;
  } else if (age != null && age > R.staleDays) {
    stage = "STALE";
    nextAction = `마지막 수집 ${age}일 전 — 다음 자동 수집 때 다시 모은다`;
  } else if (salesCount < R.minSalesProducts) {
    stage = "WAIT_SALES";
    const first = days.length >= 2 ? null : last;
    regatherOn = first ? addDays(first, R.regatherDays) : null;
    nextAction = regatherOn
      ? `검색 결과 1회 수집 — ${regatherOn} 이후 한 번 더 수집하면 리뷰 증가로 판매가 추정된다`
      : `판매 추정 ${salesCount}개 (판정에 ${R.minSalesProducts}개 필요) — 다음 수집에서 리뷰 증가가 쌓이면 늘어난다`;
  } else {
    stage = "JUDGEABLE";
    nextAction = best ? `판정 가능 — 최고 ${best.verdict === "STRONG_BUY" ? "강력추천" : best.verdict === "REVIEW" ? "검토" : "제외"} ${best.total}점. 상품 발굴 화면에서 후보를 본다` : "판정 가능 — 상품 발굴 화면에서 후보를 본다";
  }

  return {
    version: KW_OPPORTUNITY_VERSION,
    keyword: i.keyword,
    marketScore: j.marketScore,
    marketParts: j.parts.filter((p) => ["demand", "reviewBarrier", "sellerMix", "adBurden"].includes(p.part)),
    marketRisks: j.risks.filter((r) => ["RETAIL_DOMINANT", "AD_HEAVY", "REVIEW_WALL", "SEASONAL", "STALE_DATA"].includes(r.code)).map((r) => r.message),
    season: j.season,
    stage,
    nextAction,
    lastCollectedOn: last,
    regatherOn,
    productCount: i.products.length,
    salesCount,
    certRatio: i.products.length ? Math.round((certCount / i.products.length) * 100) / 100 : null,
    verdicts,
    best,
  };
}

/** 키워드 기회 정렬: 판정 가능 → 판매 추정 대기 → 수집 필요 → 다시 수집 → 시장 부적합, 같은 단계는 시장 점수 순 */
export function sortOpportunities(list: KwOpportunity[]): KwOpportunity[] {
  const order: Record<KwStage, number> = { JUDGEABLE: 0, WAIT_SALES: 1, NEED_SEARCH: 2, STALE: 3, POOR_MARKET: 4 };
  return [...list].sort((a, b) => order[a.stage] - order[b.stage] || (b.marketScore ?? -1) - (a.marketScore ?? -1));
}

// 수집 대기열 ---------------------------------------------------------------------------

export type QueueSkip = "BRAND" | "TOO_BROAD" | "NOT_GOODS" | "FASHION" | "HEAVY_CERT" | "RESTRICTED" | "OFF_SEASON" | "LOW_VOLUME";

export const QUEUE_SKIP_LABELS: Record<QueueSkip, string> = {
  BRAND: "브랜드",
  TOO_BROAD: "너무 넓음",
  NOT_GOODS: "상품이 아님 (서비스 · 대여 · 상품권 등)",
  FASHION: "의류 · 신발 (사이즈 · 반품 부담)",
  HEAVY_CERT: "인증 부담 큼 (전기 · 전파 · 가스 · 어린이 · 화장품 · 식품 · 의료 · 생활화학)",
  RESTRICTED: "판매 제한 의심",
  OFF_SEASON: "지금 발주하면 입고 때 비시즌",
  LOW_VOLUME: "월 검색량 3,000 미만",
};

/** 서비스 · 대여 · 상품권 · 장소 — 사입해서 팔 상품이 아님 */
const NOT_GOODS = ["렌트", "렌탈", "대여", "기프티콘", "상품권", "쿠폰", "예약", "여행", "펜션", "글램핑", "숙소", "호텔", "수리", "학원", "보험", "대출", "가격", "추천", "후기", "하는법", "뜻", "제작", "인쇄", "시공", "배우기", "가볼만한곳", "데이트", "박람회", "서비스센터", "준비물", "리스트", "기능사", "분리배출", "종류", "순위", "비교", "이벤트", "선물"];
/** 의류 · 신발 — 사이즈 · 색상 반품이 많고 계절 재고 부담이 크다 */
const FASHION = ["가디건", "블라우스", "자켓", "재킷", "점퍼", "패딩", "코트", "원피스", "스커트", "치마", "바지", "청바지", "슬랙스", "셔츠", "티셔츠", "맨투맨", "후드티", "니트", "조끼", "레깅스", "속옷", "브래지어", "팬티", "양말", "스니커즈", "운동화", "구두", "부츠", "샌들", "로퍼", "신발", "수영복", "래쉬가드", "스카프", "모자", "손목시계", "귀찌", "귀걸이", "목걸이", "반지", "앞치마"];
/** 옷 · 신발 단어가 있어도 수납 · 관리 용품이면 의류가 아니다 (신발장 · 코트걸이 · 양말건조대) */
const FASHION_UNLESS = ["장", "정리", "건조", "걸이", "수납", "깔창", "주걱", "거치", "행거", "옷걸이"];
/** 식품 — 수입식품 신고 · 유통기한 관리가 필요하다 */
const FOOD = ["솔트", "소금", "사탕", "젤리", "과자", "간식", "원두", "커피", "꿀", "견과", "육포", "차티백"];
/** 인증 부담이 큰 규칙 — 식품용 기구(food-contact)는 시험성적서로 대응 가능해 감점만 한다 */
const HEAVY_CERT_RULES = new Set(["electric", "radio", "gas-appliance", "children-product", "cosmetics", "food-health", "medical-device", "household-chemical"]);

export interface QueueCandidateInput {
  keyword: string;
  searchVolume: number | null;
  compIdx: string | null;
  seenCount?: number | null;
}

export interface QueueCandidate {
  keyword: string;
  score: number | null;
  skip: QueueSkip | null;
  notes: string[];
}

const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const VOLUME_CURVE = [[1_000, 0], [3_000, 50], [8_000, 90], [12_000, 100], [25_000, 100], [40_000, 80], [60_000, 60], [100_000, 30]] as const;
const COMP: Record<string, number> = { 낮음: 100, 중간: 70, 높음: 35 };

/** 쿠팡 검색 결과 없이 네이버 데이터 · 단어만으로 먼저 거른다. 점수는 수집 순서일 뿐 판정이 아니다 */
export function queueCandidate(c: QueueCandidateInput, asOf: string): QueueCandidate {
  const k = key(c.keyword);
  const notes: string[] = [];
  const f = keywordFilter(c.keyword, c.searchVolume);
  let skip: QueueSkip | null = f;
  if (!skip && NOT_GOODS.some((w) => k.includes(key(w)))) skip = "NOT_GOODS";
  if (!skip && FASHION.some((w) => k.includes(key(w))) && !FASHION_UNLESS.some((w) => k.includes(w))) skip = "FASHION";
  if (!skip && FOOD.some((w) => k.includes(key(w)))) skip = "HEAVY_CERT";
  let foodContact = false;
  if (!skip) {
    for (const r of COMPLIANCE_RULES) {
      const hit = r.terms.some((t) => k.includes(key(t))) && !(r.unless ?? []).some((t) => k.includes(key(t)));
      if (!hit) continue;
      if (r.area === "PROHIBITED") skip = "RESTRICTED";
      else if (HEAVY_CERT_RULES.has(r.id)) skip = "HEAVY_CERT";
      else if (r.id === "food-contact") foodContact = true;
      if (skip) break;
    }
  }
  const season = seasonOf({ asOf, keyword: c.keyword, productName: null, history: null });
  if (!skip && season?.group && season.sellDaysAfterArrival === 0) skip = "OFF_SEASON";
  if (!skip && (c.searchVolume ?? 0) < 3_000) skip = "LOW_VOLUME";
  if (skip) return { keyword: c.keyword, score: null, skip, notes };

  let score = 0.6 * interpolate(c.searchVolume!, VOLUME_CURVE) + 0.4 * (COMP[c.compIdx ?? ""] ?? 60);
  notes.push(`월 검색량 ${c.searchVolume!.toLocaleString("ko-KR")}`, `네이버 광고 경쟁 ${c.compIdx ?? "모름"}`);
  if (foodContact) {
    score -= 10;
    notes.push("식품용 기구 — 시험성적서 필요 (-10)");
  }
  if (season?.group) {
    const short = (season.sellDaysAfterArrival ?? 0) < 60;
    if (short) score -= 20;
    notes.push(`${season.group.label} 시즌 · 입고 뒤 남은 시즌 약 ${season.sellDaysAfterArrival}일${short ? " (-20)" : ""}`);
  }
  // 두 단어 이상(구체적인 키워드)은 상품 하나로 경쟁하기 쉽다
  if (/\s/.test(c.keyword.trim()) || c.keyword.trim().length >= 5) {
    score += 5;
    notes.push("구체적인 키워드 (+5)");
  }
  return { keyword: c.keyword, score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10, skip: null, notes };
}
