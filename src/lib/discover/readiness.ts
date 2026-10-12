/**
 * 데이터 준비 상태 (순수 함수, PHASE 16). 점수 · 판정을 대체하지 않는다.
 *
 * Score Engine V1 이 받은 입력(ScoreInput)과 결과(ScoreResult)를 그대로 읽어 "무엇이 준비됐고 무엇이 없는지 · 다음에 할 일"만 정리한다.
 * 새 기준을 만들지 않는다: 가격 기록 3회 · 180일, 판매 성장의 같은 종류 2회 · 간격 등은 엔진(RULES) 결과를 따른다.
 *
 *   READY    값이 있고 그 요소가 계산됐다
 *   PARTIAL  값은 일부 있지만 요소 계산(또는 최종 판정)에는 부족하다
 *   MISSING  값이 없다 (NULL — 0 으로 채우지 않는다)
 */

import { RULES, type ScoreInput, type ScoreResult } from "../scoring/engine";
import { SOURCE_TYPE_LABELS, type DataPoint, type SourceType } from "../../types/common";

export type ReadyState = "READY" | "PARTIAL" | "MISSING";

export interface ReadinessItem {
  key: string;
  area: string;
  state: ReadyState;
  /** 지금 상태 (값 · 출처 · 기록 수) */
  status: string;
  /** 다음에 할 일 (없으면 null) */
  next: string | null;
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const src = (s: SourceType) => SOURCE_TYPE_LABELS[s] ?? s;
const day = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// ---------------------------------------------------------------------------------------------
// 키워드 단위
// ---------------------------------------------------------------------------------------------

export interface KeywordReadinessInput {
  naverConfigured: boolean;
  /** 네이버 공식 API 최신 값 (없으면 null) */
  naverLatest: { total: number | null; capturedOn: string } | null;
  /** 네이버 마지막 시도 */
  naverLastAttempt: { ok: boolean; code: string | null; label: string | null; at: string } | null;
  /** Score 가 쓰는 월 검색량 (출처 무관 — 네이버가 아니면 따로 표시) */
  searchVolume: DataPoint | null;
  /** 확장 프로그램 검색 결과 수집 (가장 최근 1회) */
  coupangSearch: { capturedAt: string; total: number; registered: number } | null;
}

export function keywordReadiness(i: KeywordReadinessInput): ReadinessItem[] {
  const out: ReadinessItem[] = [];

  // 네이버 월간 검색량: 공식 API 값 · 10 미만 · 수집 실패 · 미수집 (쿠팡 검색량이 아니다)
  const other = i.searchVolume?.value != null && i.searchVolume.source !== "OFFICIAL_API" ? i.searchVolume : null;
  const otherNote = other ? ` · Score 는 ${src(other.source)} 값 ${other.value!.toLocaleString("ko-KR")} 사용 중` : "";
  if (i.naverLatest?.total != null) {
    out.push({ key: "naver", area: "네이버 월간 검색량", state: "READY", status: `공식 API ${i.naverLatest.total.toLocaleString("ko-KR")} (${i.naverLatest.capturedOn}) · 쿠팡 검색량 아님`, next: null });
  } else if (!i.naverConfigured) {
    out.push({ key: "naver", area: "네이버 월간 검색량", state: other ? "PARTIAL" : "MISSING", status: `API 키 없음${otherNote}`, next: ".env.local 에 네이버 검색광고 API 키를 넣거나 /import · 직접 입력" });
  } else if (i.naverLastAttempt && !i.naverLastAttempt.ok && i.naverLastAttempt.code === "NAVER_BELOW_10") {
    out.push({
      key: "naver",
      area: "네이버 월간 검색량",
      state: other ? "PARTIAL" : "MISSING",
      status: `검색량 10 미만 — 정확한 값 모름 (${day(i.naverLastAttempt.at)})${otherNote}`,
      next: "검색 수요가 거의 없는 표현입니다. 띄어쓰기 · 다른 표현의 키워드를 등록해 수집해 보세요",
    });
  } else if (i.naverLastAttempt && !i.naverLastAttempt.ok) {
    out.push({
      key: "naver",
      area: "네이버 월간 검색량",
      state: other ? "PARTIAL" : "MISSING",
      status: `수집 실패 — ${i.naverLastAttempt.label ?? i.naverLastAttempt.code ?? "원인 불명"} (${day(i.naverLastAttempt.at)})${otherNote}`,
      next: "키워드 화면에서 다시 수집 (실패 사유가 인증이면 키 확인)",
    });
  } else {
    out.push({ key: "naver", area: "네이버 월간 검색량", state: other ? "PARTIAL" : "MISSING", status: `미수집${otherNote}`, next: "키워드 화면에서 [선택 키워드 검색량 수집 (네이버)]" });
  }

  // 쿠팡 검색 결과 (확장 프로그램)
  out.push(
    i.coupangSearch
      ? {
          key: "coupangSearch",
          area: "쿠팡 검색 결과",
          state: "READY",
          status: `마지막 수집 ${day(i.coupangSearch.capturedAt)} · 상품 칸 ${i.coupangSearch.total} · 수집 당시 등록 상품 ${i.coupangSearch.registered}`,
          next: "순위 · 가격 변화를 보려면 다른 날짜에 다시 [현재 검색 결과 수집] (같은 날은 1회분만 저장)",
        }
      : { key: "coupangSearch", area: "쿠팡 검색 결과", state: "MISSING", status: "확장 프로그램으로 수집한 기록 없음", next: "쿠팡에서 이 키워드를 검색하고 확장 프로그램 패널의 [현재 검색 결과 수집]" },
  );
  return out;
}

// ---------------------------------------------------------------------------------------------
// 상품 단위
// ---------------------------------------------------------------------------------------------

export interface ProductReadinessInput {
  input: ScoreInput;
  result: ScoreResult;
  /** 리뷰 수 기록 (제외되지 않은 스냅샷, 날짜별) */
  reviewHistory: { capturedOn: string; value: number }[];
  /** 대표 수익성 시나리오 (기존 Profit 엔진 결과) */
  scenario: { netProfitPerUnit: number | null; netMarginRate: number | null; hasCalculation: boolean } | null;
}

const factorOf = (r: ScoreResult, f: string) => r.factors.find((x) => x.factor === f);

export function productReadiness({ input, result, reviewHistory, scenario }: ProductReadinessInput): ReadinessItem[] {
  const m = input.product.metrics;
  const out: ReadinessItem[] = [];

  // 가격: 현재 값 + 시장 안정성에 쓰는 기간의 기록 수 (엔진과 같은 기준)
  const priceDates = new Set(input.priceHistory.filter((p) => daysBetween(p.capturedOn, input.asOf) <= RULES.stabilitySpanDays).map((p) => p.capturedOn));
  const priceOk = factorOf(result, "marketStability")?.score != null;
  out.push({
    key: "price",
    area: "가격",
    state: m?.price?.value == null ? "MISSING" : priceOk ? "READY" : "PARTIAL",
    status: `${m?.price?.value == null ? "현재 가격 없음" : `현재 ${won(m.price.value)}`} · 최근 ${RULES.stabilitySpanDays}일 기록 ${priceDates.size}회${priceOk ? "" : ` (시장 안정성에 ${RULES.stabilityMinPoints}회 필요)`}`,
    next: priceOk ? null : m?.price?.value == null ? "상품 페이지에서 [현재 상품 수집]" : "다른 날짜에 상품 페이지를 다시 수집해 가격 기록을 쌓기 (하루 1회만 기록됨)",
  });

  // 리뷰: 현재 값 + 기록 여부 (리뷰 장벽은 경쟁 리뷰 · 키워드 평균 리뷰로 계산)
  const reviewDates = new Set(reviewHistory.map((r) => r.capturedOn));
  out.push({
    key: "review",
    area: "리뷰",
    state: m?.reviewCount?.value == null ? "MISSING" : "READY",
    status: `${m?.reviewCount?.value == null ? "현재 리뷰 수 없음" : `현재 ${m.reviewCount.value.toLocaleString("ko-KR")}개`} · 기록 ${reviewDates.size}회${reviewDates.size >= 2 ? "" : " (변화 추적은 2회부터)"}`,
    next: m?.reviewCount?.value == null ? "상품 페이지 또는 검색 결과 수집" : reviewDates.size < 2 ? "다른 날짜에 다시 수집하면 리뷰 증가를 볼 수 있음" : null,
  });

  // 판매량: 실제 · 추정 · 없음 (합치지 않는다)
  const sa = m?.salesActual;
  const se = m?.salesEstimated;
  const salesOk = factorOf(result, "salesVolume")?.score != null;
  const kind = sa?.value != null ? `실제값 ${sa.value.toLocaleString("ko-KR")}개 / ${sa.periodDays ?? "?"}일 (${src(sa.source)})` : se?.value != null ? `추정값 ${se.value.toLocaleString("ko-KR")}개 / ${se.periodDays ?? "?"}일 (${src(se.source)})` : "데이터 없음";
  out.push({
    key: "sales",
    area: "판매량",
    state: salesOk ? "READY" : sa?.value != null || se?.value != null ? "PARTIAL" : "MISSING",
    status: kind + (!salesOk && (sa?.value != null || se?.value != null) ? " · 집계 기간이 없어 계산 불가" : ""),
    next: salesOk
      ? null
      : sa?.value != null || se?.value != null
        ? "판매량의 집계 기간(일)을 함께 입력"
        : "쿠팡 공개 화면에는 판매량이 없습니다. WING 판매분석(내 상품) 또는 출처가 확인된 외부 도구 파일을 /import (임의로 만들지 않음)",
  });

  // 판매 성장: 같은 종류 판매량이 여러 시점에
  const growthOk = factorOf(result, "salesGrowth")?.score != null;
  const na = new Set(input.salesHistory.actual.map((p) => p.capturedOn)).size;
  const ne = new Set(input.salesHistory.estimated.map((p) => p.capturedOn)).size;
  out.push({
    key: "growth",
    area: "판매 성장",
    state: growthOk ? "READY" : na + ne > 0 ? "PARTIAL" : "MISSING",
    status: `실제 판매량 기록 ${na}회 · 추정 판매량 기록 ${ne}회 (실제 · 추정은 섞어 비교하지 않음)`,
    next: growthOk ? null : `같은 종류 판매량을 ${RULES.growthMinGapDays}일 이상 간격으로 2회 이상 (최근 ${RULES.growthMaxSpanDays}일)`,
  });

  // 전환율: 실제 출처가 있을 때만
  const cv = m?.conversionRate;
  out.push(
    cv?.value != null
      ? { key: "conversion", area: "전환율", state: "READY", status: `${(cv.value * 100).toFixed(2)}% (${src(cv.source)} · ${cv.confidence})`, next: null }
      : { key: "conversion", area: "전환율", state: "MISSING", status: "신뢰할 수 있는 실제 출처 없음 — 계산 불가 유지 (추정하지 않음)", next: "WING 판매분석의 실제 전환율(내 상품만)을 /import 로 넣을 때만 계산" },
  );

  // 수익성: 기존 Profit 엔진 결과
  out.push(
    scenario?.hasCalculation
      ? {
          key: "profit",
          area: "수익성",
          state: "READY",
          status: `개당 순이익 ${scenario.netProfitPerUnit == null ? "-" : won(scenario.netProfitPerUnit)} · 순이익률 ${scenario.netMarginRate == null ? "-" : `${(scenario.netMarginRate * 100).toFixed(1)}%`}`,
          next: null,
        }
      : scenario
        ? { key: "profit", area: "수익성", state: "PARTIAL", status: "대표 시나리오는 있지만 계산 결과 없음", next: "상품 상세의 수익성 계산기에서 다시 계산 · 저장" }
        : { key: "profit", area: "수익성", state: "MISSING", status: "원가 · 비용 미입력 (대표 시나리오 없음)", next: "상품 상세의 수익성 계산기에 원가 · 배송비 · 수수료 등을 입력해 대표 시나리오 저장" },
  );

  // 최종 판정: 9개 요소가 모두 계산될 때만 (V1)
  const missing = result.factors.filter((f) => f.score == null);
  out.push(
    result.complete
      ? { key: "verdict", area: "최종 판정", state: "READY", status: `9/9 계산 — 최종 판정 가능`, next: null }
      : {
          key: "verdict",
          area: "최종 판정",
          state: missing.length === result.factors.length ? "MISSING" : "PARTIAL",
          status: `${result.factors.length - missing.length}/9 계산 — 부족: ${missing.map((f) => f.label).join(" · ")}`,
          next: "위 항목의 다음 할 일을 채우면 최종 판정이 가능해집니다",
        },
  );
  return out;
}
