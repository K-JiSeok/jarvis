/**
 * WING 화면 DOM. 실제 로그인 화면에서 확인한 지표만 읽는다 (확인하지 않은 selector 는 만들지 않는다).
 *
 * 2026-10-08 실제 WING 확인 결과 (사용자 계정 · 판매 준비 0/2 단계, 등록 상품 0개)
 * - 판매분석 · 유입경로 분석 · 카테고리 분석 · 가격관리: "등록된 상품이 있어야 이 페이지를 사용할 수 있습니다" → 지표 없음
 * - 상품 조회/수정: "등록된 상품이 없습니다" (표 머리에 "쿠팡 전체 판매량 / 지난 30일" 열은 있으나 값 없음)
 * → 확인된 WING 지표 0개. 이 PHASE 에서는 어떤 WING 화면에서도 전송하지 않는다.
 *   상품이 등록된 계정에서 화면을 다시 확인한 뒤 CollectedWingMetrics 에 필드를 추가한다 (PHASE 11 보고서).
 */

import type { IngestRecord } from "../../shared/types";

const LOCKED = /등록된 상품이 있어야 이 페이지를 사용할 수 있습니다|등록된 상품이 없습니다/;

export function wingPageKind(): { supported: boolean; label: string; reason: string } {
  const body = document.body?.innerText ?? "";
  if (LOCKED.test(body)) {
    return { supported: false, label: "WING (등록 상품 없음)", reason: "이 WING 계정에 등록된 상품이 없어 분석 화면에 값이 없습니다. 보낼 데이터가 없습니다." };
  }
  return { supported: false, label: "WING", reason: "이 WING 화면의 지표는 아직 확인하지 않아 수집하지 않습니다." };
}

export function readWingPage(): { records: IngestRecord[]; summary: string[] } | { error: string } {
  return { error: wingPageKind().reason };
}
