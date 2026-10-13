/**
 * 상세 원가 · 수익성 (PHASE 20 · cost-detail-v1). 순수 함수 — 기존 profit-v1 · landed-cost-v1 은 그대로 두고 따로 계산한다.
 *
 * 기준: 쿠팡 판매 1개(판매 단위) · 원. 판매가 = 판매자 할인 적용 후 소비자 판매가 (쿠팡 할인지원 미반영, VAT 포함).
 *   판매 수수료 = 판매가 × 수수료율, 로켓그로스 비용 = 카테고리 비용 분류 × 크기 유형 × 판매가 구간 — 모두 VAT 별도 (+10%)
 *
 * 항목 상태
 *   CONFIRMED  공식 요율(공식 페이지 수기 확인) · 실제 견적 · 사용자가 확정한 값 · 사용자가 확인한 카테고리 · 실측 크기
 *   ESTIMATED  근거가 있는 추정 (카테고리 추정 · 공급 페이지 포장 정보 · 관세율 범위 · 예상 보관일 · 반품률 · 간이과세 가정)
 *   UNKNOWN    값 없음 → 0 으로 넣지 않는다
 *
 * 부가세 (과세 유형)
 *   GENERAL     매출 부가세(판매가 ÷ 11)를 내고, 세금계산서 받은 매입 부가세(쿠팡 수수료 · 물류비 · 수입 부가세 · 국내 용역)는 공제 → 공급가액 기준 이익
 *   SIMPLIFIED  납부세액 = 판매가 × 부가가치율 15%(소매업) × 10% − 매입 공급대가 × 0.5% (추정 — 세무 확인 필요)
 *   UNKNOWN     부가세 처리를 확정하지 않는다 → 확인 비용 기준 이익 산출 불가, 추정 시나리오는 두 방식의 범위
 *
 * 결과
 *   A 확인된 비용 기준: 필수 항목이 모두 CONFIRMED 일 때만 이익 표시 (보관 · 반품은 판매 속도 · 반품률에 따라 달라지는 비용이라 제외하고 표시)
 *   B 추정 포함 시나리오: 항목별 최소 ~ 최대로 좋은 경우 · 나쁜 경우. 값이 없는 항목은 '미포함'으로 따로 표시 (0 으로 보지 않음)
 *   C 산출 불가: 빠진 항목 · 이유 · 입력 방법
 */

import { pickUnitPrice, TARIFF_RANGE, type FxRate } from "../sourcing/landed-cost";
import {
  bandCell,
  cardFreshness,
  pickCard,
  promoActive,
  restockCell,
  salesFeeRate,
  SIZE_LABELS,
  sizeType,
  storageCost,
  type Band,
  type BandTable,
  type RateCard,
  type RateKind,
  type RestockRates,
  type SizeResult,
  type SizeRule,
} from "./rate-cards";
import { resolveSetting, SETTING_DEFS, type SettingItems, type SettingKey, type TaxType } from "./settings";

export const COST_DETAIL_VERSION = "cost-detail-v1";
export const VAT = 0.1;
/** 간이과세자 소매업 부가가치율 (추정 계산용 — 업종에 따라 다름) */
export const SIMPLIFIED_VALUE_ADDED_RATIO = 0.15;
export const SIMPLIFIED_INPUT_CREDIT = 0.005;
/** 판매 수수료율 범위 (WING 수수료 안내 표의 최저 4% ~ 최고 10.9%) — 카테고리를 모를 때 추정 범위로만 */
export const SALES_FEE_RANGE = { min: 0.04, max: 0.109 };
export const STORAGE_SCENARIO_DAYS = [30, 60, 90, 180];

export type Status = "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
export type LineGroup = "SUPPLY" | "IMPORT" | "DOMESTIC" | "COUPANG" | "SALES" | "SCENARIO" | "TAX";

export interface SupplyIn {
  kind: "OFFER" | "MANUAL";
  title: string;
  /** OFFER */
  tiers?: { minQty: number; maxQty: number | null; amount: number; currency: string }[];
  tiersConverted?: boolean;
  basePrice?: { amount: number; currency: string } | null;
  moq?: number | null;
  fx?: FxRate | null;
  unitsPerListing?: number | null;
  matchLevel?: string | null;
  siteShipping?: { perQty: number; amountKrw: number; text: string } | null;
  /** MANUAL — 판매 1개 기준 원 */
  unitCostKrw?: number;
  basis?: "QUOTE" | "USER";
}

export interface DetailInput {
  today: string;
  cards: RateCard[];
  sale: { price: number | null; discount: number | null; source: "USER" | "OBSERVED" | null };
  category: { salesScope: string | null; salesPath: string | null; feeGroup: string | null; confirmed: boolean; basis: string };
  pack: { l: number; w: number; h: number; kg: number; status: "MEASURED" | "SUPPLIER"; basis: string } | null;
  supply: SupplyIn | null;
  orderQty: number | null;
  settings: SettingItems;
  overrides: SettingItems;
  taxType: TaxType;
  tariff: { rate: number | null; hsCode: string | null; basis: string | null; confirmed: boolean };
  storageDays: number | null;
  returnRate: number | null;
  targetMargins?: number[];
}

export interface Line {
  key: string;
  label: string;
  group: LineGroup;
  status: Status;
  /** 판매 1개당 실제로 나가는 돈 (VAT 포함) */
  min: number | null;
  max: number | null;
  /** 그중 부가세 (일반과세자 공제 대상) */
  vatMin: number;
  vatMax: number;
  basis: string;
  /** A(확인 비용) 계산에 꼭 있어야 하는 항목 */
  required: boolean;
  howTo?: string;
}

export interface Outcome {
  revenue: number;
  totalCost: number;
  tax: number;
  profit: number;
  margin: number;
}

export interface DetailResult {
  version: typeof COST_DETAIL_VERSION;
  salePrice: number | null;
  listPrice: number | null;
  discount: number | null;
  size: (SizeResult & { status: Status; source: string }) | null;
  lines: Line[];
  confirmed: { computable: boolean; blocking: string[]; excluded: string[]; outcome: Outcome | null; breakEven: number | null; targets: { margin: number; price: number | null }[] };
  estimated: {
    computable: boolean;
    omitted: string[];
    worst: Outcome | null;
    best: Outcome | null;
    breakEven: { best: number | null; worst: number | null };
    targets: { margin: number; best: number | null; worst: number | null }[];
  };
  insufficient: { key: string; label: string; reason: string; howTo: string }[];
  storageTable: { days: number; cost: number }[] | null;
  qtyTable: { qty: number; unitPrice: string; landedMin: number; landedMax: number; unknown: number }[];
  release: { perUnit: number; freePerMonth: number; source: string } | null;
  usedCards: { kind: RateKind; id: string; scope: string; label: string; checkedOn: string; verification: string; promo: boolean; warnings: string[] }[];
  status: DetailStatus;
  warnings: string[];
}

export type DetailStatus = "NOT_ANALYZABLE" | "ESTIMATE_ONLY" | "CONFIRMED";

const r = (n: number) => Math.round(n);
const worse = (a: Status, b: Status): Status => (a === "UNKNOWN" || b === "UNKNOWN" ? "UNKNOWN" : a === "ESTIMATED" || b === "ESTIMATED" ? "ESTIMATED" : "CONFIRMED");
const fmtRate = (x: number) => `${(x * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

interface Ctx {
  i: DetailInput;
  card: (kind: RateKind, scope: string) => RateCard | null;
  used: Map<string, RateCard>;
}

/** 공급 원가 · 수입 · 국내 준비 비용 (판매가와 무관) — 주문 수량 q 기준 */
function landedLines(c: Ctx, q: number): { lines: Line[]; unitBasis: string } {
  const { i } = c;
  const lines: Line[] = [];
  const s = i.supply;
  let goods: { v: number; status: Status; basis: string } | null = null;
  let units = 1;
  let unitBasis = "-";
  if (s?.kind === "MANUAL" && s.unitCostKrw != null) {
    goods = { v: s.unitCostKrw, status: "CONFIRMED", basis: `직접 입력 (${s.basis === "QUOTE" ? "실제 견적" : "사용자 기준값"})` };
    unitBasis = `${s.unitCostKrw.toLocaleString("ko-KR")}원 (직접 입력)`;
  } else if (s?.kind === "OFFER") {
    const unit = pickUnitPrice({ basePrice: s.basePrice ?? null, tiers: s.tiers ?? [], tiersConverted: s.tiersConverted ?? false, moq: s.moq ?? null }, q);
    units = s.unitsPerListing ?? 1;
    if (unit) {
      const rate = unit.currency === "KRW" ? 1 : s.fx && s.fx.currency === unit.currency ? s.fx.krw : null;
      unitBasis = `${unit.amount} ${unit.currency} · ${unit.basis}`;
      if (rate != null) {
        let st: Status = "CONFIRMED";
        const notes = [unit.basis];
        if (unit.displayConverted) {
          st = "ESTIMATED";
          notes.push("사이트 표시 원화 환산값");
        }
        if (s.unitsPerListing == null) {
          st = "ESTIMATED";
          notes.push("구성 수량 미확인 → 1개로 계산");
        }
        if (rate !== 1 && s.fx) notes.push(`환율 ${s.fx.krw} (${s.fx.source} ${s.fx.rateDate})`);
        goods = { v: unit.amount * rate * units, status: st, basis: `${s.title.slice(0, 40)} · ${notes.join(" · ")}` };
      }
    }
  }
  lines.push(
    goods
      ? { key: "goods", label: `상품 매입가${units !== 1 ? ` (× ${units})` : ""}`, group: "SUPPLY", status: goods.status, min: r(goods.v), max: r(goods.v), vatMin: 0, vatMax: 0, basis: goods.basis, required: true }
      : { key: "goods", label: "상품 매입가", group: "SUPPLY", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: s ? "공급 단가 또는 환율 없음" : "선택한 공급 후보 · 직접 입력 원가 없음", required: true, howTo: "/discover 에서 공급 후보 [선택] 또는 상품 비용 입력의 '공급 원가 직접 입력'" },
  );
  const goodsV = goods?.v ?? null;
  const listingsPerOrder = q / units;

  const setting = (key: SettingKey) => resolveSetting(key, i.settings, i.overrides);
  const statusOf = (basis: string): Status => (basis === "DEFAULT_ESTIMATE" ? "ESTIMATED" : "CONFIRMED");
  const fromTxt = (from: "PRODUCT" | "SETTINGS", basis: string) => `${from === "PRODUCT" ? "상품별 설정" : "기본 설정"} · ${basis === "QUOTE" ? "실제 견적" : basis === "USER" ? "사용자 기준값" : "추정 기본값"}`;
  const vatPart = (key: SettingKey, gross: number, included: boolean | undefined) => (included ?? SETTING_DEFS[key].vatDefault ? gross / 11 : 0);
  const unknownLine = (key: string, label: string, group: LineGroup, howTo: string, required = true): Line => ({ key, label, group, status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "미설정 — 0 으로 넣지 않음", required, howTo });

  const perShipment = (key: SettingKey, group: LineGroup): Line => {
    const v = setting(key);
    const label = SETTING_DEFS[key].label;
    if (!v) return unknownLine(key, label, group, "/profit/rates 비용 설정 (0 원이면 0 입력)");
    const amt = v.item.value / listingsPerOrder;
    return { key, label, group, status: statusOf(v.item.basis), min: r(amt), max: r(amt), vatMin: r(vatPart(key, amt, v.item.vatIncluded)), vatMax: r(vatPart(key, amt, v.item.vatIncluded)), basis: `${v.item.value.toLocaleString("ko-KR")}원 ÷ 주문당 ${Math.round(listingsPerOrder * 100) / 100}개 (주문 ${q}개) · ${fromTxt(v.from, v.item.basis)}`, required: true };
  };
  const perUnit = (key: SettingKey, group: LineGroup, required = true): Line => {
    const v = setting(key);
    const label = SETTING_DEFS[key].label;
    if (!v) return unknownLine(key, label, group, "/profit/rates 비용 설정 (0 원이면 0 입력)", required);
    return { key, label, group, status: statusOf(v.item.basis), min: r(v.item.value), max: r(v.item.value), vatMin: r(vatPart(key, v.item.value, v.item.vatIncluded)), vatMax: r(vatPart(key, v.item.value, v.item.vatIncluded)), basis: fromTxt(v.from, v.item.basis), required };
  };
  const ofGoods = (key: SettingKey): Line => {
    const v = setting(key);
    const label = SETTING_DEFS[key].label;
    if (!v) return unknownLine(key, label, "IMPORT", "/profit/rates 비용 설정 (없으면 0 입력)");
    if (goodsV == null) return { ...unknownLine(key, label, "IMPORT", "상품 매입가 필요"), basis: `${fmtRate(v.item.value)} — 매입가 없음` };
    const amt = goodsV * v.item.value;
    return { key, label, group: "IMPORT", status: worse(statusOf(v.item.basis), goods!.status), min: r(amt), max: r(amt), vatMin: 0, vatMax: 0, basis: `매입가 × ${fmtRate(v.item.value)} · ${fromTxt(v.from, v.item.basis)}`, required: true };
  };

  const china = perShipment("chinaDomesticPerShipment", "IMPORT");
  lines.push(china, ofGoods("agentFeeRate"), ofGoods("paymentFeeRate"));

  // 국제 운송비: 개당 직접 입력 > kg 단가 × 청구 중량 > 공급 사이트 표시 배송비
  const direct = setting("intlFreightPerUnit");
  const perKg = setting("forwarderPerKg");
  const divisor = setting("volumetricDivisor");
  let freight: Line;
  if (direct) {
    freight = { key: "intlFreight", label: "국제 운송비", group: "IMPORT", status: statusOf(direct.item.basis), min: r(direct.item.value), max: r(direct.item.value), vatMin: 0, vatMax: 0, basis: `개당 직접 입력 · ${fromTxt(direct.from, direct.item.basis)}`, required: true };
  } else if (perKg && i.pack) {
    const vol = divisor ? (i.pack.l * i.pack.w * i.pack.h) / divisor.item.value : null;
    const chargeable = Math.max(i.pack.kg, vol ?? 0);
    const amt = chargeable * perKg.item.value;
    let st = statusOf(perKg.item.basis);
    if (i.pack.status !== "MEASURED") st = worse(st, "ESTIMATED");
    if (!divisor) st = worse(st, "ESTIMATED");
    freight = {
      key: "intlFreight",
      label: "국제 운송비",
      group: "IMPORT",
      status: st,
      min: r(amt),
      max: r(amt),
      vatMin: 0,
      vatMax: 0,
      basis: `청구 중량 ${Math.round(chargeable * 1000) / 1000}kg (실중량 ${i.pack.kg}kg${vol != null ? ` · 부피중량 ${Math.round(vol * 1000) / 1000}kg` : " · 부피중량 기준 미설정"}) × ${perKg.item.value.toLocaleString("ko-KR")}원 — 판매 단위 포장 기준 근사${i.pack.status !== "MEASURED" ? " · 포장 크기 추정" : ""}`,
      required: true,
    };
  } else if (i.supply?.kind === "OFFER" && i.supply.siteShipping) {
    const sh = i.supply.siteShipping;
    const amt = (sh.amountKrw / sh.perQty) * units;
    freight = { key: "intlFreight", label: "국제 운송비 (공급 사이트 표시)", group: "IMPORT", status: "ESTIMATED", min: r(amt), max: r(amt), vatMin: 0, vatMax: 0, basis: `"${sh.text.slice(0, 50)}" — 접속 주소 · 시점 기준 표시값, 확정 운임 아님`, required: true };
  } else {
    freight = unknownLine("intlFreight", "국제 운송비", "IMPORT", perKg ? "상품 비용 입력에 포장 크기 · 무게 입력" : "/profit/rates 포워더 kg 단가 또는 개당 운송비 입력");
  }
  lines.push(freight);

  // 관세 · 수입 부가세: 과세가격 = 매입가 + 중국 내 배송 + 국제 운송 (구매대행 수수료 제외)
  if (goodsV != null) {
    const cifMin = goodsV + (china.min ?? 0) + (freight.min ?? 0);
    const cifMax = goodsV + (china.max ?? 0) + (freight.max ?? 0);
    const cifStatus = worse(goods!.status, china.status === "UNKNOWN" || freight.status === "UNKNOWN" ? "ESTIMATED" : worse(china.status, freight.status));
    const rateMin = i.tariff.rate ?? TARIFF_RANGE.min;
    const rateMax = i.tariff.rate ?? TARIFF_RANGE.max;
    const tStatus: Status = i.tariff.rate != null && i.tariff.confirmed ? "CONFIRMED" : "ESTIMATED";
    const tBasis = i.tariff.rate != null ? `관세율 ${fmtRate(i.tariff.rate)}${i.tariff.hsCode ? ` (HS ${i.tariff.hsCode})` : ""} · ${i.tariff.confirmed ? "확인됨" : "사용자 입력 · 미확정"}${i.tariff.basis ? ` · ${i.tariff.basis}` : ""}` : TARIFF_RANGE.basis;
    const cifNote = cifStatus !== "CONFIRMED" ? " · 과세가격에 미확인 운송비가 빠져 낮게 잡힐 수 있음" : "";
    lines.push({ key: "duty", label: "관세", group: "IMPORT", status: worse(tStatus, cifStatus), min: r(cifMin * rateMin), max: r(cifMax * rateMax), vatMin: 0, vatMax: 0, basis: `과세가격 ${r(cifMin).toLocaleString("ko-KR")}${cifMax !== cifMin ? `~${r(cifMax).toLocaleString("ko-KR")}` : ""}원 × ${tBasis}${cifNote}`, required: true });
    const vMin = (cifMin + cifMin * rateMin) * VAT;
    const vMax = (cifMax + cifMax * rateMax) * VAT;
    lines.push({ key: "importVat", label: "수입 부가세 10%", group: "IMPORT", status: worse(tStatus, cifStatus), min: r(vMin), max: r(vMax), vatMin: r(vMin), vatMax: r(vMax), basis: "(과세가격 + 관세) × 10% — 판매용 수입은 소액 면세 대상 아님 · 일반과세자는 매입세액 공제 대상", required: true });
  } else {
    lines.push(unknownLine("duty", "관세", "IMPORT", "상품 매입가 필요"), unknownLine("importVat", "수입 부가세 10%", "IMPORT", "상품 매입가 필요"));
  }
  lines.push(perShipment("customsBrokerPerShipment", "IMPORT"));
  lines.push(perShipment("domesticFreightPerShipment", "DOMESTIC"), perShipment("inboundPrepPerShipment", "DOMESTIC"));
  lines.push(perUnit("inspectionPerUnit", "DOMESTIC"), perUnit("packagingPerUnit", "DOMESTIC"), perUnit("labelingPerUnit", "DOMESTIC"));
  return { lines, unitBasis };
}

function feeGroupsWithCards(c: Ctx, kind: RateKind): RateCard[] {
  const scopes = [...new Set(c.i.cards.filter((x) => x.kind === kind).map((x) => x.scope))];
  return scopes.map((s) => c.card(kind, s)).filter((x): x is RateCard => x != null);
}

/** 쿠팡 판매 비용 (판매가 p 에 따라 달라짐) */
function coupangLines(c: Ctx, p: number, size: (SizeResult & { status: Status }) | null): Line[] {
  const { i } = c;
  const lines: Line[] = [];
  // 판매 수수료
  const feeCard = i.category.salesScope ? c.card("SALES_FEE", i.category.salesScope) : null;
  if (feeCard) {
    const f = salesFeeRate(feeCard, i.category.salesPath);
    c.used.set(feeCard.id, feeCard);
    const fee = p * f.rate;
    lines.push({ key: "salesFee", label: `판매 수수료 ${fmtRate(f.rate)} + VAT`, group: "COUPANG", status: i.category.confirmed ? "CONFIRMED" : "ESTIMATED", min: r(fee * 1.1), max: r(fee * 1.1), vatMin: r(fee * VAT), vatMax: r(fee * VAT), basis: `판매가 × ${fmtRate(f.rate)} (${f.basis}) · ${feeCard.sourceLabel}${i.category.confirmed ? " · 카테고리 확인됨" : ` · 카테고리 추정: ${i.category.basis}`}`, required: true, howTo: i.category.confirmed ? undefined : "상품 비용 입력에서 판매자 등록 카테고리 확인" });
  } else {
    const lo = p * SALES_FEE_RANGE.min;
    const hi = p * SALES_FEE_RANGE.max;
    lines.push({ key: "salesFee", label: "판매 수수료 + VAT", group: "COUPANG", status: "ESTIMATED", min: r(lo * 1.1), max: r(hi * 1.1), vatMin: r(lo * VAT), vatMax: r(hi * VAT), basis: `카테고리 판단 불가 → WING 수수료 안내 표 범위 ${fmtRate(SALES_FEE_RANGE.min)}~${fmtRate(SALES_FEE_RANGE.max)}`, required: true, howTo: "상품 비용 입력에서 수수료 대분류 선택 · 확인" });
  }

  // 입출고비 · 배송비
  for (const [kind, key, label, unitNote] of [
    ["RG_INOUT", "rgInout", "로켓그로스 입출고비 + VAT", "수량 당 · 판매 시 부과"],
    ["RG_DELIVERY", "rgDelivery", "로켓그로스 배송비 + VAT", "주문 상품 당 1회 — 1주문 1개 기준 (합포장 시 개당 낮아짐)"],
  ] as const) {
    if (!size) {
      lines.push({ key, label, group: "COUPANG", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "포장 크기 · 무게 없음 → 크기 유형을 정하지 않음", required: true, howTo: "상품 비용 입력에 포장 후 가로 · 세로 · 높이 · 무게 입력" });
      continue;
    }
    const own = i.category.feeGroup ? c.card(kind, i.category.feeGroup) : null;
    const cards = own ? [own] : feeGroupsWithCards(c, kind);
    const cells = cards.map((cd) => ({ cd, cell: bandCell(cd, p, size.type, i.today) })).filter((x) => x.cell != null);
    if (cells.length === 0) {
      lines.push({ key, label, group: "COUPANG", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: `비용 분류 "${i.category.feeGroup ?? "-"}" 요율표 없음`, required: true, howTo: "/profit/rates 에서 WING 표 붙여 넣기" });
      continue;
    }
    cells.forEach((x) => c.used.set(x.cd.id, x.cd));
    const amts = cells.map((x) => x.cell!.amount);
    const lo = Math.min(...amts);
    const hi = Math.max(...amts);
    const st: Status = own ? worse(i.category.confirmed ? "CONFIRMED" : "ESTIMATED", size.status) : "ESTIMATED";
    const x0 = cells[0];
    const promoTxt = x0.cell!.promo != null && promoActive(x0.cd, i.today) ? `할인가 (기본 ${x0.cell!.base.toLocaleString("ko-KR")}원, ~${x0.cd.promoUntil})` : "기본 비용";
    const basis = own
      ? `${own.scope} · ${SIZE_LABELS[size.type]} · ${bandText(x0.cell!.band)} → ${x0.cell!.amount.toLocaleString("ko-KR")}원 ${promoTxt} · ${unitNote}`
      : `비용 분류 미확정 → 요율표가 있는 분류(${cells.map((x) => x.cd.scope).join(", ")}) 중 최저~최고 · ${SIZE_LABELS[size.type]} · ${unitNote}`;
    lines.push({ key, label, group: "COUPANG", status: st, min: r(lo * 1.1), max: r(hi * 1.1), vatMin: r(lo * VAT), vatMax: r(hi * VAT), basis, required: true, howTo: own && i.category.confirmed && size.status === "CONFIRMED" ? undefined : "카테고리 확인 · 포장 실측" });
  }

  // 보관비 (판매 속도에 따라 달라짐 — 시나리오)
  const stCard = c.card("RG_STORAGE", "*");
  if (stCard && i.pack) {
    c.used.set(stCard.id, stCard);
    const cbm = (i.pack.l * i.pack.w * i.pack.h) / 1_000_000;
    const dMin = i.storageDays ?? STORAGE_SCENARIO_DAYS[0];
    const dMax = i.storageDays ?? STORAGE_SCENARIO_DAYS[STORAGE_SCENARIO_DAYS.length - 1];
    const lo = storageCost(stCard, cbm, dMin, i.today);
    const hi = storageCost(stCard, cbm, dMax, i.today);
    lines.push({ key: "storage", label: "보관비 + VAT", group: "SCENARIO", status: "ESTIMATED", min: r(lo * 1.1), max: r(hi * 1.1), vatMin: r(lo * VAT), vatMax: r(hi * VAT), basis: `${Math.round(cbm * 1e6) / 1e6} CBM × ${i.storageDays != null ? `예상 보관 ${i.storageDays}일 (사용자 예상)` : `보관 ${dMin}~${dMax}일 시나리오 (판매 속도 미확인)`} · 매 입고 30일 무료${promoActive(stCard, i.today) ? "" : " 종료"} · 하루 금액 반올림`, required: false });
  } else {
    lines.push({ key: "storage", label: "보관비", group: "SCENARIO", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "포장 크기 없음 → 부피(CBM) 모름", required: false, howTo: "포장 후 크기 입력" });
  }

  // 반품 회수 · 재입고 (반품률 × 건당 비용)
  const pickCardOwn = i.category.feeGroup ? c.card("RG_RETURN_PICKUP", i.category.feeGroup) : null;
  const pickCards = pickCardOwn ? [pickCardOwn] : feeGroupsWithCards(c, "RG_RETURN_PICKUP");
  const restock = c.card("RG_RESTOCK", "*");
  if (i.returnRate != null && size && pickCards.length && restock) {
    const picks = pickCards.map((cd) => bandCell(cd, p, size.type, i.today)).filter((x) => x != null);
    const rs = restockCell(restock, p, i.today);
    if (picks.length && rs) {
      pickCards.forEach((cd) => c.used.set(cd.id, cd));
      c.used.set(restock.id, restock);
      const lo = i.returnRate * (Math.min(...picks.map((x) => x!.amount)) + rs.amount);
      // 나쁜 경우: 재입고 할인 종료 가능성(판매자 도움말 안내) → 재입고 기본 비용
      const hi = i.returnRate * (Math.max(...picks.map((x) => x!.amount)) + rs.base);
      lines.push({ key: "returns", label: "반품 회수 · 재입고 + VAT", group: "SCENARIO", status: "ESTIMATED", min: r(lo * 1.1), max: r(hi * 1.1), vatMin: r(lo * VAT), vatMax: r(hi * VAT), basis: `예상 반품률 ${fmtRate(i.returnRate)} × (회수비 + 재입고비 ${rs.amount}~${rs.base}원) · 월 20개 무료 미반영 · 반품 시 판매 수수료 · 입출고/배송비는 부과되지 않음`, required: false });
    }
  } else {
    lines.push({ key: "returns", label: "반품 회수 · 재입고", group: "SCENARIO", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: i.returnRate == null ? "예상 반품률 미입력 — 실제 반품률은 판매 후에만 알 수 있음" : "크기 유형 · 요율표 없음", required: false, howTo: "상품 비용 입력에 예상 반품률 (시나리오)" });
  }

  // 광고비 (비율 또는 개당) — 쿠팡 광고비는 VAT 별도 → 미포함으로 입력하면 10% 더함
  const adR = resolveSetting("adRate", i.settings, i.overrides);
  const adU = resolveSetting("adPerUnit", i.settings, i.overrides);
  const ad = adR ?? adU;
  if (ad) {
    const base = adR ? p * adR.item.value : adU!.item.value;
    const gross = ad.item.vatIncluded ? base : base * 1.1;
    const vat = gross / 11;
    lines.push({ key: "ads", label: "광고비", group: "SALES", status: ad.item.basis === "DEFAULT_ESTIMATE" ? "ESTIMATED" : "CONFIRMED", min: r(gross), max: r(gross), vatMin: r(vat), vatMax: r(vat), basis: `${adR ? `판매가 × ${fmtRate(adR.item.value)}` : `개당 ${adU!.item.value.toLocaleString("ko-KR")}원`}${ad.item.vatIncluded ? " (VAT 포함 입력)" : " + VAT"} · ${ad.from === "PRODUCT" ? "상품별 설정" : "기본 설정"} — 광고 계획값`, required: true });
  } else {
    lines.push({ key: "ads", label: "광고비", group: "SALES", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "미설정 — 광고를 하지 않으면 0 입력", required: true, howTo: "/profit/rates 비용 설정 (광고비율 또는 개당 금액)" });
  }
  const other = resolveSetting("otherPerUnit", i.settings, i.overrides);
  lines.push(
    other
      ? { key: "otherPerUnit", label: SETTING_DEFS.otherPerUnit.label, group: "SALES", status: other.item.basis === "DEFAULT_ESTIMATE" ? "ESTIMATED" : "CONFIRMED", min: r(other.item.value), max: r(other.item.value), vatMin: r(other.item.vatIncluded ? other.item.value / 11 : 0), vatMax: r(other.item.vatIncluded ? other.item.value / 11 : 0), basis: other.from === "PRODUCT" ? "상품별 설정" : "기본 설정", required: false }
      : { key: "otherPerUnit", label: SETTING_DEFS.otherPerUnit.label, group: "SALES", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "미설정 (선택 항목)", required: false },
  );
  return lines;
}

function bandText(b: Band): string {
  const f = (n: number) => n.toLocaleString("ko-KR");
  return b[1] == null ? `${f(b[0])}원 이상` : b[0] === 0 ? `${f(b[1])}원 미만` : `${f(b[0])}~${f(b[1])}원 미만`;
}

/** 이익 = 매출 − 비용 − 세금. which = 각 항목 최소(좋은 경우) / 최대(나쁜 경우). tax = 부가세 처리 */
function outcome(p: number, lines: Line[], which: "min" | "max", tax: "GENERAL" | "SIMPLIFIED"): Outcome {
  let cost = 0;
  let vat = 0;
  let grossInvoiced = 0;
  for (const l of lines) {
    const v = which === "min" ? l.min : l.max;
    if (v == null) continue;
    const lv = which === "min" ? l.vatMin : l.vatMax;
    cost += v;
    vat += lv;
    if (lv > 0) grossInvoiced += v;
  }
  if (tax === "GENERAL") {
    const revenue = p / (1 + VAT);
    const totalCost = cost - vat;
    const profit = revenue - totalCost;
    return { revenue: r(revenue), totalCost: r(totalCost), tax: r(p - revenue), profit: r(profit), margin: Math.round((profit / p) * 10000) / 10000 };
  }
  const payable = Math.max(0, p * SIMPLIFIED_VALUE_ADDED_RATIO * VAT - grossInvoiced * SIMPLIFIED_INPUT_CREDIT);
  const profit = p - cost - payable;
  return { revenue: p, totalCost: r(cost), tax: r(payable), profit: r(profit), margin: Math.round((profit / p) * 10000) / 10000 };
}

/** f(p) ≥ 0 이 되는 가장 낮은 정수 판매가. 판매가 구간 경계 사이에서는 f 가 판매가에 1차 → 구간별로 푼다 */
export function solvePrice(f: (p: number) => number, breaks: number[], maxP = 5_000_000): number | null {
  const pts = [...new Set([1, ...breaks.filter((b) => b > 1 && b < maxP), maxP + 1])].sort((a, b) => a - b);
  for (let k = 0; k < pts.length - 1; k += 1) {
    const a = pts[k];
    const b = pts[k + 1] - 1;
    const fa = f(a);
    if (fa >= 0) return a;
    const fb = f(b);
    if (fb < 0) continue;
    let x = Math.min(b, Math.max(a, Math.ceil(a + ((0 - fa) * (b - a)) / (fb - fa))));
    while (x > a && f(x - 1) >= 0) x -= 1;
    while (x <= b && f(x) < 0) x += 1;
    if (x <= b) return x;
  }
  return null;
}

export function calculateCostDetail(i: DetailInput): DetailResult {
  const used = new Map<string, RateCard>();
  const c: Ctx = { i, used, card: (kind, scope) => pickCard(i.cards, kind, scope, i.today) };
  const warnings: string[] = [];
  const price = i.sale.price != null ? i.sale.price - (i.sale.discount ?? 0) : null;
  if (i.sale.discount && i.sale.price) warnings.push(`판매자 할인 ${i.sale.discount.toLocaleString("ko-KR")}원 적용가 ${price!.toLocaleString("ko-KR")}원 기준 (수수료 · 비용 구간 모두 할인 후 가격)`);
  if (i.sale.source === "OBSERVED") warnings.push("판매가 = 최근 관측된 쿠팡 판매가 (내 판매가가 아님 — 직접 정하면 상품 비용 입력에 판매가 입력)");

  // 크기 유형
  const rule = c.card("SIZE_RULE", "*");
  let size: DetailResult["size"] = null;
  if (rule && i.pack) {
    used.set(rule.id, rule);
    const s = sizeType(rule.rates as unknown as SizeRule, { l: i.pack.l, w: i.pack.w, h: i.pack.h, kg: i.pack.kg });
    if (s) size = { ...s, status: i.pack.status === "MEASURED" ? "CONFIRMED" : "ESTIMATED", source: i.pack.basis };
    else warnings.push("세 변의 합 250cm 또는 30kg 초과 — 별도 관리형 상품 요율 대상 (이 표로 계산하지 않음)");
  }

  const orderQty = i.orderQty ?? i.supply?.moq ?? 1;
  if (i.supply?.kind === "OFFER" && i.supply.moq && orderQty < i.supply.moq) warnings.push(`주문 수량 ${orderQty}개가 최소 주문 수량 ${i.supply.moq}개보다 적습니다`);
  if (i.supply?.kind === "OFFER" && i.supply.matchLevel && i.supply.matchLevel !== "HIGH") warnings.push("선택한 공급 후보가 확정 매칭(HIGH)이 아님 — 같은 상품인지 확인 필요");
  const landed = landedLines(c, orderQty);
  const lineAt = (p: number, sz = size) => [...landed.lines, ...coupangLines(c, p, sz), taxLine(i.taxType)];

  const lines = price != null ? lineAt(price) : [...landed.lines, taxLine(i.taxType)];
  const scenarioKeys = new Set(lines.filter((l) => l.group === "SCENARIO").map((l) => l.key));
  const required = lines.filter((l) => l.required);
  const blocking = required.filter((l) => l.status !== "CONFIRMED").map((l) => `${l.label} (${l.status === "UNKNOWN" ? "미확인" : "추정"})`);
  if (price == null) blocking.unshift("판매가 (미확인)");
  const goodsKnown = lines.find((l) => l.key === "goods")?.status !== "UNKNOWN";

  const taxModes: ("GENERAL" | "SIMPLIFIED")[] = i.taxType === "UNKNOWN" ? ["GENERAL", "SIMPLIFIED"] : [i.taxType];
  const breaks = [...new Set(i.cards.flatMap((cd) => ((cd.rates as unknown as BandTable).bands ?? (cd.rates as unknown as RestockRates).bands ?? []).map((b) => b[0])))];

  // A 확인 비용 기준 (보관 · 반품 제외, 모두 CONFIRMED · 과세 유형 확정일 때만)
  const aOk = price != null && blocking.length === 0 && i.taxType !== "UNKNOWN";
  const aLines = (p: number) => lineAt(p).filter((l) => !scenarioKeys.has(l.key));
  const aTax = i.taxType === "UNKNOWN" ? "GENERAL" : i.taxType;
  const confirmed: DetailResult["confirmed"] = {
    computable: aOk,
    blocking,
    excluded: [...lines.filter((l) => scenarioKeys.has(l.key)).map((l) => `${l.label} (판매 속도 · 반품률에 따라 달라짐 → 추정 시나리오에서)`), ...lines.filter((l) => !l.required && l.status === "UNKNOWN" && !scenarioKeys.has(l.key)).map((l) => `${l.label} (선택 항목 · 미설정)`)],
    outcome: aOk ? outcome(price!, aLines(price!), "min", aTax) : null,
    breakEven: aOk ? solvePrice((p) => outcome(p, aLines(p), "min", aTax).profit, breaks) : null,
    targets: (i.targetMargins ?? [0.1, 0.2, 0.3]).map((m) => ({ margin: m, price: aOk ? solvePrice((p) => outcome(p, aLines(p), "min", aTax).profit - m * p, breaks) : null })),
  };

  // B 추정 포함
  const bOk = price != null && goodsKnown;
  const pick = (p: number, which: "min" | "max") => {
    const outs = taxModes.map((t) => outcome(p, lineAt(p), which, t));
    return which === "min" ? outs.reduce((a, b) => (b.profit > a.profit ? b : a)) : outs.reduce((a, b) => (b.profit < a.profit ? b : a));
  };
  const estimated: DetailResult["estimated"] = {
    computable: bOk,
    omitted: lines.filter((l) => l.status === "UNKNOWN").map((l) => l.label),
    best: bOk ? pick(price!, "min") : null,
    worst: bOk ? pick(price!, "max") : null,
    breakEven: {
      best: bOk ? solvePrice((p) => pick(p, "min").profit, breaks) : null,
      worst: bOk ? solvePrice((p) => pick(p, "max").profit, breaks) : null,
    },
    targets: (i.targetMargins ?? [0.1, 0.2, 0.3]).map((m) => ({
      margin: m,
      best: bOk ? solvePrice((p) => pick(p, "min").profit - m * p, breaks) : null,
      worst: bOk ? solvePrice((p) => pick(p, "max").profit - m * p, breaks) : null,
    })),
  };
  if (bOk && estimated.omitted.length) warnings.push(`추정 시나리오에 넣지 못한 비용 ${estimated.omitted.length}개 (${estimated.omitted.join(", ")}) — 실제 이익은 이보다 낮음`);

  // C 산출 불가
  const insufficient: DetailResult["insufficient"] = [];
  if (price == null) insufficient.push({ key: "salePrice", label: "판매가", reason: "관측된 판매가도 입력한 판매가도 없음", howTo: "상품 비용 입력에 판매가" });
  for (const l of lines) {
    if (l.status === "UNKNOWN" || (l.required && l.status === "ESTIMATED")) insufficient.push({ key: l.key, label: l.label, reason: l.status === "UNKNOWN" ? l.basis : `추정값: ${l.basis}`, howTo: l.howTo ?? "-" });
  }

  // 보관 기간별 · 주문 수량별
  const stCard = c.card("RG_STORAGE", "*");
  const storageTable = stCard && i.pack ? STORAGE_SCENARIO_DAYS.map((d) => ({ days: d, cost: r(storageCost(stCard, (i.pack!.l * i.pack!.w * i.pack!.h) / 1_000_000, d, i.today) * 1.1) })) : null;
  const qtys = new Set<number>([orderQty]);
  if (i.supply?.kind === "OFFER") {
    if (i.supply.moq) qtys.add(i.supply.moq);
    for (const t of i.supply.tiers ?? []) qtys.add(t.minQty);
  }
  // 공급 원가를 모르면 수량별 원가 표를 만들지 않는다 (미확인 항목을 뺀 합계가 0원처럼 보이지 않게)
  const qtyTable = !goodsKnown ? [] : [...qtys]
    .sort((a, b) => a - b)
    .slice(0, 6)
    .map((q) => {
      const ll = landedLines(c, q);
      return { qty: q, unitPrice: ll.unitBasis, landedMin: ll.lines.reduce((s, l) => s + (l.min ?? 0), 0), landedMax: ll.lines.reduce((s, l) => s + (l.max ?? 0), 0), unknown: ll.lines.filter((l) => l.status === "UNKNOWN").length };
    });

  const rel = c.card("RG_RELEASE", "*");
  const release = rel ? { perUnit: (rel.rates as { perUnit: number }).perUnit, freePerMonth: (rel.rates as { freePerMonth: number }).freePerMonth, source: rel.sourceLabel } : null;
  if (rel) used.set(rel.id, rel);

  const usedCards = [...used.values()].map((cd) => ({ kind: cd.kind, id: cd.id, scope: cd.scope, label: cd.sourceLabel, checkedOn: cd.checkedOn, verification: cd.verification, promo: promoActive(cd, i.today), warnings: cardFreshness(cd, i.today) }));
  const status: DetailStatus = !bOk ? "NOT_ANALYZABLE" : aOk ? "CONFIRMED" : "ESTIMATE_ONLY";
  return { version: COST_DETAIL_VERSION, salePrice: price, listPrice: i.sale.price, discount: i.sale.discount, size, lines, confirmed, estimated, insufficient, storageTable, qtyTable, release, usedCards, status, warnings };
}

function taxLine(t: TaxType): Line {
  if (t === "GENERAL") return { key: "tax", label: "부가세 처리 (일반과세자)", group: "TAX", status: "CONFIRMED", min: 0, max: 0, vatMin: 0, vatMax: 0, basis: "매출 부가세(판매가 ÷ 11) 납부 · 세금계산서 받은 매입 부가세 공제 → 공급가액 기준 이익 (세금계산서 수취 가정)", required: true };
  if (t === "SIMPLIFIED") return { key: "tax", label: "부가세 처리 (간이과세자)", group: "TAX", status: "ESTIMATED", min: 0, max: 0, vatMin: 0, vatMax: 0, basis: `납부세액 = 판매가 × 부가가치율 ${SIMPLIFIED_VALUE_ADDED_RATIO * 100}%(소매업 가정) × 10% − 매입 공급대가 × 0.5% — 세무 확인 필요`, required: true, howTo: "업종별 부가가치율 · 공제 여부를 세무사와 확인" };
  return { key: "tax", label: "부가세 처리", group: "TAX", status: "UNKNOWN", min: null, max: null, vatMin: 0, vatMax: 0, basis: "사업자 과세 유형 미확인 — 일반/간이 두 방식의 범위로만 추정", required: true, howTo: "/profit/rates 에서 과세 유형 선택" };
}

/** 자동 발굴 · 소싱 화면 상태 (추천 아님) */
export type CostStateKey = "COST_COMPUTABLE" | "ESTIMATE_ONLY" | "REQUIRED_UNKNOWN" | "EXPECTED_LOSS" | "EXPECTED_PROFIT" | "NOT_ANALYZABLE";
export const COST_STATE_LABELS: Record<CostStateKey, string> = {
  COST_COMPUTABLE: "원가 계산 가능",
  ESTIMATE_ONLY: "추정 원가만 존재",
  REQUIRED_UNKNOWN: "필수 비용 미확인",
  EXPECTED_LOSS: "예상 손실",
  EXPECTED_PROFIT: "예상 이익 (추천 아님)",
  NOT_ANALYZABLE: "수익성 분석 불가",
};

export function costStates(d: DetailResult): CostStateKey[] {
  if (d.status === "NOT_ANALYZABLE") return ["NOT_ANALYZABLE"];
  const out: CostStateKey[] = [];
  if (d.status === "CONFIRMED") {
    out.push("COST_COMPUTABLE");
    const p = d.confirmed.outcome!.profit;
    out.push(p < 0 ? "EXPECTED_LOSS" : "EXPECTED_PROFIT");
    return out;
  }
  out.push("ESTIMATE_ONLY");
  if (d.lines.some((l) => l.required && l.status === "UNKNOWN")) out.push("REQUIRED_UNKNOWN");
  if (d.estimated.best && d.estimated.best.profit < 0) out.push("EXPECTED_LOSS");
  else if (d.estimated.worst && d.estimated.worst.profit > 0 && !out.includes("REQUIRED_UNKNOWN")) out.push("EXPECTED_PROFIT");
  return out;
}
