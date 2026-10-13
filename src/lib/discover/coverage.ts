/**
 * Score Engine V1 항목별 결측 현황 (순수 함수, PHASE 19). 점수 · 가중치 · 판정을 바꾸지 않고 엔진 결과만 집계한다.
 *
 * 상품마다 V1 미리 보기 결과(9개 요소)를 받아 요소별로
 *   계산된 상품 수 · NULL 상품 수 · 계산에 쓴 데이터 출처별 건수 · 추정값(ESTIMATED 출처 · 추정 판매량)을 쓴 상품 수 · 최신 수집일
 * 을 센다. 그리고 그 요소를 채우는 경로(자동 · 사용자 작업 · 외부 출처 필요)를 붙인다 — 경로는 지금 시스템 기준 사실이다.
 */

import type { ScoreFactor } from "../../config/scoring-weights";
import type { ScoreResult } from "../scoring/engine";

export interface FactorCoverage {
  factor: ScoreFactor;
  label: string;
  weight: number;
  computed: number;
  missing: number;
  estimatedUsed: number;
  sources: Record<string, number>;
  latest: string | null;
  /** 이 요소가 비는 가장 흔한 이유 (엔진 basis) */
  topReason: string | null;
  path: string;
}

/** 지금 JARVIS 에서 그 요소를 채우는 경로 (PHASE 19 기준) */
export const FILL_PATH: Record<ScoreFactor, string> = {
  demand: "자동 — 네이버 검색광고 API (추적 키워드)",
  salesVolume: "출처 없음 — WING 판매분석(내 상품) 또는 출처 확인된 외부 추정치 /import · 쿠팡 공개 화면에 없음",
  salesGrowth: "출처 없음 — 같은 종류 판매량 7일 이상 간격 2회 (판매량 출처가 먼저 필요)",
  competition: "사용자 작업 — 경쟁상품 연결 (상품 상세) · 키워드 상품 수는 미수집",
  wingEntry: "사용자 작업 — 경쟁상품 연결 + 상품 페이지 수집(판매자 유형)",
  reviewBarrier: "반자동 — 쿠팡 검색 수집(사용자 클릭) 후 키워드 평균 리뷰",
  conversion: "출처 없음 — 실제 전환율은 WING(내 상품)뿐, 경쟁상품은 원천적으로 없음",
  margin: "사용자 작업 — 대표 수익성 시나리오 (공급 원가 이력은 V1 에 연결하지 않음 — 정책 승인 전)",
  marketStability: "반자동 — 날짜를 달리한 가격 기록 3회 (쿠팡 수집 · 사용자 클릭)",
};

export function v1Coverage(results: ScoreResult[]): FactorCoverage[] {
  if (results.length === 0) return [];
  return results[0].factors.map((f0) => {
    const rows = results.map((r) => r.factors.find((f) => f.factor === f0.factor)!).filter(Boolean);
    const sources: Record<string, number> = {};
    let estimatedUsed = 0;
    let latest: string | null = null;
    const reasons = new Map<string, number>();
    for (const f of rows) {
      if (f.score == null) {
        reasons.set(f.basis, (reasons.get(f.basis) ?? 0) + 1);
        continue;
      }
      const seen = new Set<string>();
      let est = false;
      for (const x of f.inputs) {
        if (x.value == null) continue;
        if (x.source && !seen.has(x.source)) {
          seen.add(x.source);
          sources[x.source] = (sources[x.source] ?? 0) + 1;
        }
        if (x.source === "ESTIMATED" || /추정/.test(x.name)) est = true;
        if (x.capturedOn && (!latest || x.capturedOn > latest)) latest = x.capturedOn;
      }
      if (est) estimatedUsed += 1;
    }
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const computed = rows.filter((f) => f.score != null).length;
    return { factor: f0.factor, label: f0.label, weight: f0.weight, computed, missing: rows.length - computed, estimatedUsed, sources, latest, topReason: top, path: FILL_PATH[f0.factor] };
  });
}
