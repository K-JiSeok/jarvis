/**
 * 상품 후보 자동 선정 (순수 함수, PHASE 17).
 *
 * 입력: 확장 프로그램이 저장한 쿠팡 검색 결과 수집 기록 (import_rows.payload.collected = 화면에서 읽은 칸 그대로, 미등록 상품 포함)
 * 출력: 그 화면의 서로 다른 상품 중 아직 JARVIS 에 없는 상품 전부 — 사람이 체크박스로 고르던 단계를 대신한다.
 *   선정 기준은 "같은 검색 결과 1페이지에 보인 상품 · 아직 미등록"뿐이다 (가격 · 리뷰 · 순위로 거르는 새 기준을 만들지 않는다).
 *   같은 상품의 여러 칸(옵션 반복 · 광고+자연)은 기존 uniqueSearchProducts 가 가장 앞 칸 하나로 합친다.
 * 값은 화면에서 읽은 것만 (searchItemToProduct — PHASE 12 와 같은 변환). 판매량 · 판매자 유형처럼 검색 화면에 없는 값은 비운다.
 */

import { searchItemToProduct, uniqueSearchProducts, type SearchProduct } from "../collectors/coupang/search";
import type { CollectedProduct, CollectedSearchItem, CollectedSearchResult } from "../collectors/types";

/** register_products_and_ingest 한 번의 상품 수 상한 (DB 검사와 같음) */
export const MAX_AUTO_REGISTER = 100;

export interface ObservationRow {
  payload: unknown;
}

/** 수집 기록 행 → 검색 결과 (화면 값 그대로). 키워드 · 페이지가 다른 행은 섞지 않는다 */
export function searchResultFromRows(rows: ObservationRow[], meta: { keyword: string; capturedAt: string; tool: string }): CollectedSearchResult | null {
  const items: CollectedSearchItem[] = [];
  let page: number | null = null;
  for (const r of rows) {
    const c = (r.payload as { collected?: CollectedSearchItem & { keyword?: string; page?: number | null } } | null)?.collected;
    if (!c || !c.coupangProductId) continue;
    if (c.keyword && c.keyword !== meta.keyword) continue;
    page ??= c.page ?? null;
    if ((c.page ?? null) !== page) continue;
    const { keyword: _k, page: _p, ...item } = c;
    void _k;
    void _p;
    items.push(item);
  }
  if (items.length === 0) return null;
  return { source: "COUPANG_PAGE", confidence: "A", capturedAt: meta.capturedAt, tool: meta.tool, keyword: meta.keyword, page, items };
}

export interface AutoSelection {
  picked: SearchProduct[];
  alreadyRegistered: number;
  /** 같은 상품의 반복 칸 (하나로 합침) */
  duplicateSlots: number;
  overLimit: number;
}

export function selectUnregistered(result: CollectedSearchResult, registeredIds: Set<string>): AutoSelection {
  const unique = uniqueSearchProducts(result);
  const fresh = unique.filter((p) => !registeredIds.has(p.coupangProductId));
  return {
    picked: fresh.slice(0, MAX_AUTO_REGISTER),
    alreadyRegistered: unique.length - fresh.length,
    duplicateSlots: result.items.filter((i) => i.coupangProductId).length - unique.length,
    overLimit: Math.max(0, fresh.length - MAX_AUTO_REGISTER),
  };
}

/** 등록 요청 배치: 고른 상품의 순위 칸 + 상품 값 (PHASE 12 선택 등록과 같은 형태) */
export function autoRegisterBatch(result: CollectedSearchResult, picked: SearchProduct[]): { searches: CollectedSearchResult[]; products: CollectedProduct[] } {
  const keep = new Set(picked.map((p) => p.coupangProductId));
  return {
    searches: [{ ...result, items: result.items.filter((i) => i.coupangProductId && keep.has(i.coupangProductId)) }],
    products: picked.map((p) => searchItemToProduct(result, p)),
  };
}
