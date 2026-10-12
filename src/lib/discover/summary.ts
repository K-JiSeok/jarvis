/**
 * 상품 발굴 화면 정리 (순수 함수, PHASE 15). 점수는 계산하지 않는다 — Score Engine V1 결과(ScoreResult)를 분류 · 정렬만 한다.
 *
 *   FINAL        9개 요소가 모두 계산됨 → 기존 V1 총점 · 판정 (80+ STRONG_BUY · 60~79 REVIEW · <60 EXCLUDE)
 *   PROVISIONAL  일부만 계산됨 → "잠정 분석": 확보 점수 / 확보 가중치 · 가능 범위만 (최종 판정 아님)
 *   INSUFFICIENT 계산된 요소가 없음 → 분석 불가
 * 데이터가 없다는 이유로 상품을 빼지 않는다 (목록에 그대로 두고 부족한 데이터를 보여 준다).
 */

import type { ScoreResult } from "../scoring/engine";

export type DiscoverStatus = "FINAL" | "PROVISIONAL" | "INSUFFICIENT";

export function discoverStatus(r: ScoreResult): DiscoverStatus {
  if (r.complete) return "FINAL";
  return r.missingFactors.length < r.factors.length ? "PROVISIONAL" : "INSUFFICIENT";
}

const ORDER: Record<DiscoverStatus, number> = { FINAL: 0, PROVISIONAL: 1, INSUFFICIENT: 2 };

/** 최종 판정 상품 (총점 순) → 잠정 분석 (계산된 요소 수 · 확보 점수 순) → 분석 불가. 잠정끼리의 순서는 판정이 아니다 */
export function sortForDiscover<T extends { preview: ScoreResult; productName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = discoverStatus(a.preview);
    const sb = discoverStatus(b.preview);
    if (sa !== sb) return ORDER[sa] - ORDER[sb];
    if (sa === "FINAL") return b.preview.total! - a.preview.total!;
    const ka = a.preview.factors.length - a.preview.missingFactors.length;
    const kb = b.preview.factors.length - b.preview.missingFactors.length;
    return kb - ka || b.preview.knownPoints - a.preview.knownPoints || a.productName.localeCompare(b.productName);
  });
}

export interface ShortageInput {
  /** 키워드 월 검색량이 있는가 (어떤 출처든) */
  hasSearchVolume: boolean;
  naverConfigured: boolean;
  naverLastAttempt: { ok: boolean; label: string | null } | null;
  products: { preview: ScoreResult }[];
}

const missingIn = (products: ShortageInput["products"], factor: string) => products.filter((p) => p.preview.factors.find((f) => f.factor === factor)?.score == null).length;

/** 키워드 단위로 "왜 부족한가" — 검색량 · 판매량 · 가격 · 리뷰 */
export function shortageReasons(i: ShortageInput): { area: string; reason: string }[] {
  const out: { area: string; reason: string }[] = [];
  const n = i.products.length;
  if (!i.hasSearchVolume) {
    const why = !i.naverConfigured
      ? "네이버 검색광고 API 키가 설정되지 않았고, /import · 직접 입력한 월 검색량도 없습니다"
      : i.naverLastAttempt && !i.naverLastAttempt.ok
        ? `네이버 검색량 마지막 수집이 실패했습니다 (${i.naverLastAttempt.label ?? "원인 불명"})`
        : i.naverLastAttempt
          ? "네이버 검색량 수집 기록은 있지만 저장된 월 검색량이 없습니다"
          : "이 키워드의 검색량을 아직 수집하지 않았습니다 (키워드 화면에서 네이버 검색량 수집)";
    out.push({ area: "검색량", reason: `${why}. 네이버 검색량은 쿠팡 검색 수요의 대리 지표입니다.` });
  }
  if (n === 0) return out;
  const noSales = missingIn(i.products, "salesVolume");
  if (noSales > 0) {
    out.push({ area: "판매량", reason: `${noSales}/${n}개 상품에 실제 · 추정 판매량(집계 기간 포함)이 없습니다. 쿠팡 공개 화면에는 판매량이 없어 WING 판매분석이나 출처가 확인된 추정치를 /import 로 넣어야 합니다 (임의로 만들지 않음).` });
  }
  const noGrowth = missingIn(i.products, "salesGrowth");
  if (noGrowth > 0) out.push({ area: "판매 성장", reason: `${noGrowth}/${n}개 상품에 7일 이상 간격의 같은 종류 판매량 기록이 2회 이상 없습니다.` });
  const noConversion = missingIn(i.products, "conversion");
  if (noConversion > 0) out.push({ area: "전환율", reason: `${noConversion}/${n}개 상품에 실제 출처가 확인된 전환율이 없습니다 (추정하지 않음).` });
  const noStability = missingIn(i.products, "marketStability");
  if (noStability > 0) out.push({ area: "가격", reason: `${noStability}/${n}개 상품의 최근 180일 가격 기록이 3회 미만입니다 (확장 프로그램으로 날짜를 달리해 수집).` });
  const noReview = missingIn(i.products, "reviewBarrier");
  if (noReview > 0) out.push({ area: "리뷰", reason: `${noReview}/${n}개 상품에 경쟁상품 리뷰 · 키워드 평균 리뷰가 없습니다 (쿠팡 검색 결과 수집 또는 경쟁상품 연결).` });
  return out;
}
