/**
 * 비용 요율표 (PHASE 20) — 순수 함수. 요율 값은 DB(cost_rate_cards)에 있고 여기에는 읽는 규칙만 있다.
 *
 *   pickCard       종류 · 범위 · 기준일로 적용할 요율 행 고르기 (사용자 행 > 시스템 행, 적용 시작일이 늦은 것)
 *   sizeType       포장 후 세 변의 합 · 무게 → 로켓그로스 크기 유형 (두 기준 중 큰 유형)
 *   bandCell       판매가 구간 × 크기 유형 → 금액 (프로모션 기간이면 할인가, 할인가가 없으면 기본 비용)
 *   storageCost    부피(CBM) × 보관일 × 기간별 일 요율 (하루 금액 반올림)
 *   parseWingTable WING '입출고/배송 비용' 표를 복사해 붙여 넣은 글 → 구간 · 기본 · 할인가
 *   cardFreshness  확인일 · 프로모션 종료일 기준 최신 여부 경고
 */

export type RateKind = "SALES_FEE" | "SIZE_RULE" | "RG_INOUT" | "RG_DELIVERY" | "RG_STORAGE" | "RG_RETURN_PICKUP" | "RG_RESTOCK" | "RG_RELEASE";
export type SizeKey = "XS" | "S" | "M" | "L1" | "L2" | "XL";
export const SIZE_LABELS: Record<SizeKey, string> = { XS: "극소형", S: "소형", M: "중형", L1: "대형1", L2: "대형2", XL: "특대형" };
export const SIZE_ORDER: SizeKey[] = ["XS", "S", "M", "L1", "L2", "XL"];

export const RATE_KIND_LABELS: Record<RateKind, string> = {
  SALES_FEE: "판매 수수료",
  SIZE_RULE: "크기 유형 기준",
  RG_INOUT: "입출고비",
  RG_DELIVERY: "배송비",
  RG_STORAGE: "보관비",
  RG_RETURN_PICKUP: "반품 회수비",
  RG_RESTOCK: "반품 재입고비",
  RG_RELEASE: "반출비",
};

export interface RateCard {
  id: string;
  ownerId: string | null;
  kind: RateKind;
  scope: string;
  rates: Record<string, unknown>;
  vatBasis: "EXCLUDED" | "INCLUDED";
  validFrom: string;
  validTo: string | null;
  promoUntil: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
  checkedOn: string;
  verification: "OFFICIAL_MANUAL" | "USER_ENTERED";
  note: string | null;
}

export type Band = [number, number | null];
export interface BandTable {
  bands: Band[];
  sizes: SizeKey[];
  base: number[];
  promo: (number | null)[][];
}
export interface SizeRule {
  types: { type: SizeKey; label: string; maxSumCm: number; maxKg: number }[];
}
export interface StorageRates {
  tiers: { fromDay: number; toDay: number | null; base: number; promo: number | null }[];
}
export interface RestockRates {
  bands: Band[];
  base: number[];
  promo: number[];
}
export interface SalesFeeRates {
  rate: number;
  exceptions: { path: string; rate: number }[];
}

/** 적용할 요율 행: 기준일에 유효한 것 중 사용자 행 우선, 적용 시작일 · 확인일이 늦은 것 */
export function pickCard(cards: RateCard[], kind: RateKind, scope: string, onDate: string): RateCard | null {
  const ok = cards.filter((c) => c.kind === kind && c.scope === scope && c.validFrom <= onDate && (c.validTo == null || c.validTo >= onDate));
  ok.sort((a, b) => Number(b.ownerId != null) - Number(a.ownerId != null) || b.validFrom.localeCompare(a.validFrom) || b.checkedOn.localeCompare(a.checkedOn));
  return ok[0] ?? null;
}

export interface SizeResult {
  type: SizeKey;
  sumCm: number;
  bySum: SizeKey | null;
  byWeight: SizeKey | null;
  basis: string;
}

/** 세 변의 합 · 무게 각각의 유형 중 큰 쪽. 특대형(250cm · 30kg)을 넘으면 null (별도 관리형 — 이 표로 계산 안 함) */
export function sizeType(rule: SizeRule, dims: { l: number; w: number; h: number; kg: number }): SizeResult | null {
  const sum = Math.round((dims.l + dims.w + dims.h) * 10) / 10;
  const bySum = rule.types.find((t) => sum <= t.maxSumCm)?.type ?? null;
  const byWeight = rule.types.find((t) => dims.kg <= t.maxKg)?.type ?? null;
  if (!bySum || !byWeight) return null;
  const type = SIZE_ORDER.indexOf(bySum) >= SIZE_ORDER.indexOf(byWeight) ? bySum : byWeight;
  return { type, sumCm: sum, bySum, byWeight, basis: `세 변의 합 ${sum}cm → ${SIZE_LABELS[bySum]} · 무게 ${dims.kg}kg → ${SIZE_LABELS[byWeight]} ⇒ ${SIZE_LABELS[type]} (큰 유형)` };
}

export function bandIndex(bands: Band[], price: number): number {
  return bands.findIndex(([lo, hi]) => price >= lo && (hi == null || price < hi));
}

export function bandLabel(b: Band): string {
  const f = (n: number) => n.toLocaleString("ko-KR");
  return b[1] == null ? `${f(b[0])}원 이상` : b[0] === 0 ? `${f(b[1])}원 미만` : `${f(b[0])}~${f(b[1])}원 미만`;
}

export function promoActive(card: Pick<RateCard, "promoUntil">, onDate: string): boolean {
  return card.promoUntil != null && onDate <= card.promoUntil;
}

/** 판매가 구간 × 크기 유형 금액 (프로모션 기간 · 할인가 있으면 할인가) */
export function bandCell(card: RateCard, price: number, size: SizeKey, onDate: string): { amount: number; base: number; promo: number | null; band: Band } | null {
  const t = card.rates as unknown as BandTable;
  const i = bandIndex(t.bands, price);
  const j = t.sizes.indexOf(size);
  if (i < 0 || j < 0) return null;
  const base = t.base[j];
  const promo = t.promo?.[i]?.[j] ?? null;
  return { amount: promo != null && promoActive(card, onDate) ? promo : base, base, promo, band: t.bands[i] };
}

export function restockCell(card: RateCard, price: number, onDate: string): { amount: number; base: number; promo: number | null } | null {
  const t = card.rates as unknown as RestockRates;
  const i = bandIndex(t.bands, price);
  if (i < 0) return null;
  const promo = t.promo?.[i] ?? null;
  return { amount: promo != null && promoActive(card, onDate) ? promo : t.base[i], base: t.base[i], promo };
}

/** 보관비 (개당): 하루 금액 = 부피 × 그날 요율 → 반올림 (판매자 도움말 규칙). 입고일 = onDate 로 보고 프로모션 여부 판단 */
export function storageCost(card: RateCard, cbm: number, days: number, onDate: string): number {
  const t = card.rates as unknown as StorageRates;
  const promo = promoActive(card, onDate);
  let total = 0;
  for (let d = 1; d <= days; d += 1) {
    const tier = t.tiers.find((x) => d >= x.fromDay && (x.toDay == null || d <= x.toDay));
    if (!tier) continue;
    const rate = promo && tier.promo != null ? tier.promo : tier.base;
    total += Math.round(cbm * rate);
  }
  return total;
}

/** 판매 수수료율: 세부 경로가 예외 목록과 맞으면 예외 요율, 아니면 대분류 기본 */
export function salesFeeRate(card: RateCard, path: string | null): { rate: number; basis: string } {
  const r = card.rates as unknown as SalesFeeRates;
  const p = (path ?? "").replace(/\s+/g, " ");
  const hit = [...r.exceptions].sort((a, b) => b.path.length - a.path.length).find((e) => p.includes(e.path));
  return hit ? { rate: hit.rate, basis: `${card.scope} > ${hit.path} 예외 요율` } : { rate: r.rate, basis: `${card.scope} 기본 수수료` };
}

export function cardFreshness(card: RateCard, today: string): string[] {
  const w: string[] = [];
  const days = (Date.parse(today) - Date.parse(card.checkedOn)) / 86_400_000;
  if (days > 30) w.push(`확인한 지 ${Math.floor(days)}일 지남 (${card.checkedOn}) — 최신 요율인지 다시 확인 필요`);
  if (card.promoUntil && today > card.promoUntil) w.push(`프로모션 종료일(${card.promoUntil}) 지남 → 기본 비용으로 계산`);
  else if (card.promoUntil) {
    const left = (Date.parse(card.promoUntil) - Date.parse(today)) / 86_400_000;
    if (left <= 30) w.push(`프로모션 종료 ${Math.ceil(left)}일 전 (${card.promoUntil}) — 이후 기본 비용`);
  }
  if (card.verification === "OFFICIAL_MANUAL") w.push("공식 페이지를 사람이 읽어 옮긴 값 (API 자동 갱신 아님)");
  return w;
}

// ---------------------------------------------------------------------------------
// WING 표 붙여 넣기
// ---------------------------------------------------------------------------------

const BAND_RE = /(~?\s*[\d,]+원\s*미만|[\d,]+원\s*이상\s*~\s*[\d,]+원\s*미만|[\d,]+\s*~\s*[\d,]+원\s*미만|[\d,]+원\s*이상)/g;
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));

function parseBand(label: string): Band | null {
  const s = label.replace(/\s+/g, "");
  let m = s.match(/^~?([\d,]+)원미만$/);
  if (m) return [0, num(m[1])];
  m = s.match(/^([\d,]+)원이상~([\d,]+)원미만$/) ?? s.match(/^([\d,]+)~([\d,]+)원미만$/);
  if (m) return [num(m[1]), num(m[2])];
  m = s.match(/^([\d,]+)원이상$/);
  if (m) return [num(m[1]), null];
  return null;
}

export interface ParsedWingTable {
  bands: Band[];
  base: number[];
  promo: (number | null)[][];
  /** 열 수가 맞지 않거나 기본 비용이 행마다 다른 경우 */
  problems: string[];
}

/**
 * "~5,000원 미만 | 3,850원 할인가 2,450원 | 4,150원 | …" 같은 행들. 칸 = "기본 [할인가 X]".
 * 기본 비용은 열마다 모든 행이 같아야 한다 (WING 표 구조) — 다르면 problems 에 남긴다.
 */
export function parseWingTable(text: string, columns = 6): ParsedWingTable {
  const problems: string[] = [];
  const flat = text.replace(/\r/g, "").replace(/\s+/g, " ");
  const marks = [...flat.matchAll(BAND_RE)].filter((m) => parseBand(m[0]) != null);
  const bands: Band[] = [];
  const rows: { base: number; promo: number | null }[][] = [];
  for (let k = 0; k < marks.length; k += 1) {
    const band = parseBand(marks[k][0])!;
    const start = marks[k].index! + marks[k][0].length;
    const end = k + 1 < marks.length ? marks[k + 1].index! : flat.length;
    const chunk = flat.slice(start, end);
    let cells: { base: number; promo: number | null }[] = [];
    const re = /([\d,]+)\s*원(?:\s*할인가\s*([\d,]+)\s*원)?/g;
    for (const m of chunk.matchAll(re)) cells.push({ base: num(m[1]), promo: m[2] ? num(m[2]) : null });
    // 반품 회수비 표는 "2,200원 1,150원" (기본 · 프로모션 적용가) 처럼 라벨 없이 두 금액씩
    if (!/할인가/.test(chunk) && cells.length === columns * 2) cells = Array.from({ length: columns }, (_, j) => ({ base: cells[2 * j].base, promo: cells[2 * j + 1].base }));
    if (cells.length < columns) {
      problems.push(`${bandLabel(band)}: 칸 ${cells.length}개 (${columns}개 필요)`);
      continue;
    }
    bands.push(band);
    rows.push(cells.slice(0, columns));
  }
  const base = rows[0]?.map((c) => c.base) ?? [];
  rows.forEach((r, i) => r.forEach((c, j) => c.base !== base[j] && problems.push(`${bandLabel(bands[i])} ${j + 1}열 기본 비용 ${c.base} ≠ ${base[j]}`)));
  for (let i = 1; i < bands.length; i += 1) if (bands[i][0] !== bands[i - 1][1]) problems.push(`구간이 이어지지 않음: ${bandLabel(bands[i - 1])} → ${bandLabel(bands[i])}`);
  if (bands.length === 0) problems.push("판매가 구간 행을 찾지 못했습니다");
  return { bands, base, promo: rows.map((r) => r.map((c) => c.promo)), problems };
}
