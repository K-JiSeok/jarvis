/**
 * 쿠팡 상품 ↔ 도매 공급 후보 일치 판단 (순수 함수, PHASE 18 · supply-match-v1). 점수가 아니라 근거별 판정 · 3단계 분류.
 *
 *   HIGH     높은 일치 가능성  — 종류 · 재질 일치 + 이미지 유사(측정값) + 구성 수량 · 규격 충돌 없음
 *   SIMILAR  유사, 추가 확인 필요 — 종류 일치 + (재질 또는 카테고리) 일치
 *   UNCLEAR  일치 여부 불명확
 *
 * 이미지 유사도는 아직 측정하지 않는다 (이미지 비교 기능 없음) → 측정값이 없으면 HIGH 를 주지 않는다.
 * 이미지가 비슷해도 동일로 확정하지 않는다. 구성 수량 · 규격이 다르면 HIGH 불가, 원가는 묶음 수량으로 환산 필요 표시.
 */

import type { CollectedSupplyOffer } from "../collectors/supplier/page";

import { conceptsOf, MATERIAL_CONCEPTS, packQtyOf, TYPE_CONCEPTS } from "./translate";

export const MATCH_RULE_VERSION = "supply-match-v1";
export type MatchLevel = "HIGH" | "SIMILAR" | "UNCLEAR";
export const MATCH_LABELS: Record<MatchLevel, string> = { HIGH: "높은 일치 가능성", SIMILAR: "유사 — 추가 확인 필요", UNCLEAR: "일치 여부 불명확" };

/** 더 구체적인 종류가 있으면 일반 종류를 뺀다 (얼음 트레이 ≠ 서빙 트레이) */
const SPECIFIC: Record<string, string> = { ice_tray: "tray", drying_rack: "tray" };
function types(concepts: string[]): Set<string> {
  const s = new Set(concepts.filter((c) => TYPE_CONCEPTS.includes(c)));
  for (const [spec, gen] of Object.entries(SPECIFIC)) if (s.has(spec)) s.delete(gen);
  return s;
}

export interface MatchInput {
  product: { name: string; categoryPath: string | null };
  offer: Pick<CollectedSupplyOffer, "title" | "categoryPath" | "material" | "sizeText" | "attributes" | "moq">;
  /** 0~1 이미지 유사도. 측정하지 않았으면 null */
  imageSimilarity?: number | null;
}

export interface MatchResult {
  level: MatchLevel;
  ruleVersion: string;
  reasons: string[];
  conflicts: string[];
  unknown: string[];
  productPackQty: number | null;
  offerUnitQty: number | null;
  /** 쿠팡 1개 상품을 만들려면 공급 단위 몇 개가 필요한가 (모르면 null) */
  unitsPerListing: number | null;
}

export function matchSupply(i: MatchInput): MatchResult {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const unknown: string[] = [];
  const pc = conceptsOf(`${i.product.name} ${i.product.categoryPath ?? ""}`);
  const offerText = `${i.offer.title} ${i.offer.attributes["제품 이름"] ?? ""} ${i.offer.material ?? ""}`;
  const oc = conceptsOf(offerText);
  const pt = types(pc);
  const ot = types(oc);
  const typeHit = [...pt].filter((t) => ot.has(t));
  if (typeHit.length) reasons.push(`종류 일치: ${typeHit.join(", ")}`);
  else if (pt.size && ot.size) conflicts.push(`종류 다름: 쿠팡 ${[...pt].join(", ")} / 공급 ${[...ot].join(", ")}`);
  else unknown.push("상품 종류를 사전으로 판단하지 못함");

  const pm = pc.filter((c) => MATERIAL_CONCEPTS.includes(c));
  const om = conceptsOf(`${i.offer.material ?? ""} ${i.offer.title}`).filter((c) => MATERIAL_CONCEPTS.includes(c));
  const matHit = pm.filter((m) => om.includes(m));
  if (matHit.length) reasons.push(`재질 일치: ${matHit.join(", ")}`);
  else if (pm.length && om.length) conflicts.push(`재질 다름: ${pm.join(", ")} / ${om.join(", ")}`);
  else unknown.push("재질 정보가 한쪽에 없음");

  const catHit = i.product.categoryPath && i.offer.categoryPath ? conceptsOf(i.product.categoryPath).some((c) => conceptsOf(i.offer.categoryPath!).includes(c)) || /주방/.test(i.product.categoryPath) === /주방/.test(i.offer.categoryPath) : null;
  if (catHit === true) reasons.push("카테고리 계열 일치");
  if (catHit === null) unknown.push("카테고리 비교 불가 (한쪽 없음)");

  // 규격: 쿠팡 쪽 크기를 수집하지 않으므로 비교할 수 없다
  unknown.push(i.offer.sizeText ? `규격 비교 불가 — 공급 ${i.offer.sizeText} · 쿠팡 크기 미수집` : "규격 정보 없음");

  // 구성 수량
  const productPackQty = packQtyOf(i.product.name);
  const single = /단일 품목|single item|单件/i.test(i.offer.attributes["판매"] ?? i.offer.attributes["Selling Units"] ?? "");
  const offerUnitQty = single ? 1 : null;
  let unitsPerListing: number | null = null;
  if (productPackQty != null && offerUnitQty != null) {
    unitsPerListing = productPackQty / offerUnitQty;
    if (unitsPerListing !== 1) conflicts.push(`구성 수량 다름: 쿠팡 ${productPackQty}개 묶음 / 공급 ${offerUnitQty}개 단위 → 원가 ×${unitsPerListing} 환산 (별도 상품으로 취급)`);
  } else unknown.push(`구성 수량 비교 불가 (쿠팡 ${productPackQty ?? "모름"} · 공급 ${offerUnitQty ?? "모름"})`);

  if (i.imageSimilarity == null) unknown.push("이미지 유사도 미측정 (이미지 비교 기능 없음)");
  else reasons.push(`이미지 유사도 ${Math.round(i.imageSimilarity * 100)}%`);

  const strongImage = i.imageSimilarity != null && i.imageSimilarity >= 0.85;
  const level: MatchLevel =
    typeHit.length && matHit.length && strongImage && conflicts.length === 0 ? "HIGH" : typeHit.length && (matHit.length || catHit === true) && !conflicts.some((c) => c.startsWith("종류")) ? "SIMILAR" : "UNCLEAR";
  return { level, ruleVersion: MATCH_RULE_VERSION, reasons, conflicts, unknown, productPackQty, offerUnitQty, unitsPerListing };
}
