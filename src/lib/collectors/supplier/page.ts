/**
 * 중국 도매 상품 페이지 → 공급 후보 (순수 함수, PHASE 18). DB · 브라우저와 무관 — Node 테스트에서 실제 페이지 고정값으로 검증한다.
 *
 * 원칙
 *   - 페이지에 보인 값만. 못 읽은 값은 null (가격 · 수량 · 무게 · 배송비를 추정해 채우지 않는다)
 *   - 가격 통화를 구분한다: JSON-LD offers.price 는 사이트 기준 통화(Alibaba = USD), 화면 구간 가격은 "표시 통화"
 *     (Alibaba 는 접속 지역에 맞춰 원화로 환산해 보여 준다 → 원가 계산에는 원래 통화 값을 우선 쓰고, 표시 값은 참고)
 *   - 수량 구간(20-99 개 · ≥10,000 개)의 최소 수량 = 최소 주문 수량(MOQ). 속성의 "MOQ" 는 교차 확인용
 *   - 배송비 문구는 "그 주소 · 그 시점 기준 사이트 표시값" — 확정 운임이 아니다
 */

export type SupplySite = "ALIBABA" | "1688" | "TAOBAO";

export const SUPPLY_SITE_LABELS: Record<SupplySite, string> = { ALIBABA: "Alibaba.com", "1688": "1688", TAOBAO: "타오바오" };

export interface PriceTier {
  minQty: number;
  maxQty: number | null;
  amount: number;
  currency: string;
}

export interface CollectedSupplyOffer {
  site: SupplySite;
  siteProductId: string;
  url: string;
  title: string;
  imageUrls: string[];
  categoryPath: string | null;
  /** 사이트 기준 통화의 가격 (JSON-LD offers) — 보통 최저 구간 가격 */
  basePrice: { amount: number; currency: string } | null;
  /** 화면 수량 구간 가격 (표시 통화) */
  tiers: PriceTier[];
  /** 화면 표시 통화가 사이트가 환산한 값인가 (Alibaba 원화 표시) */
  tiersConverted: boolean;
  moq: number | null;
  supplierName: string | null;
  supplierUrl: string | null;
  supplierMeta: { years: number | null; rating: number | null; location: string | null };
  attributes: Record<string, string>;
  material: string | null;
  sizeText: string | null;
  colors: string[];
  brand: string | null;
  model: string | null;
  /** kg — 총중량(포장 포함) 우선, 없으면 제품 무게 */
  weightKg: number | null;
  packageSizeText: string | null;
  /** 사이트 표시 배송비 (N개당 금액). 숫자로 못 읽으면 원문만 (perQty · amount · currency = null) */
  shipping: { perQty: number | null; amount: number | null; currency: string | null; text: string } | null;
  issues: string[];
}

export interface RawSupplierPageInput {
  url: string;
  host: string;
  title: string;
  h1: string | null;
  jsonLd: string[];
  ogImage: string | null;
  ogTitle: string | null;
  priceTiers: { price: string; qty: string }[];
  attributes: [string, string][];
  shippingText: string | null;
  supplierCardText: string | null;
  supplierUrl: string | null;
  skuText: string | null;
}

const SYMBOLS: [RegExp, string][] = [
  [/₩|원|KRW/i, "KRW"],
  [/US\$|USD|\$/i, "USD"],
  [/¥|￥|CNY|RMB|元/i, "CNY"],
  [/€|EUR/i, "EUR"],
];

export function currencyOf(text: string): string | null {
  for (const [re, code] of SYMBOLS) if (re.test(text)) return code;
  return null;
}

/** "₩1,772" · "US$0.99-1.20" · "¥3.50" → 첫 금액 */
export function parseMoney(text: string): { amount: number; currency: string | null } | null {
  const m = text.replace(/\s/g, "").match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? { amount, currency: currencyOf(text) } : null;
}

/** "20-99 개" → 20~99 · "≥10,000 개" → 10000~ · "100 개 이상" → 100~ */
export function parseQtyRange(text: string): { min: number; max: number | null } | null {
  const t = text.replace(/,/g, "");
  const range = t.match(/(\d+)\s*[-~–]\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const ge = t.match(/(?:≥|>=|>)\s*(\d+)/) ?? t.match(/(\d+)\s*(?:개|pcs|pieces|件|个)?\s*(?:이상|\+|及以上|以上)/i);
  if (ge) return { min: Number(ge[1]), max: null };
  return null;
}

/** "126g" · "0.152 kg" → kg */
export function parseWeightKg(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(kg|g|킬로그램|그램)\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  const kg = /^(kg|킬로그램)$/i.test(m[2]) ? v : v / 1000;
  return kg > 0 && kg < 1000 ? Math.round(kg * 10000) / 10000 : null;
}

export function siteOf(url: string): { site: SupplySite; id: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (/(^|\.)alibaba\.com$/.test(u.hostname)) {
    const m = u.pathname.match(/_(\d{6,})\.html$/);
    return m ? { site: "ALIBABA", id: m[1] } : null;
  }
  if (/(^|\.)1688\.com$/.test(u.hostname)) {
    const m = u.pathname.match(/\/offer\/(\d{6,})\.html/);
    return m ? { site: "1688", id: m[1] } : null;
  }
  if (/(^|\.)(taobao|tmall)\.com$/.test(u.hostname)) {
    const id = u.searchParams.get("id");
    return id && /^\d{6,}$/.test(id) ? { site: "TAOBAO", id } : null;
  }
  return null;
}

/** 추적 파라미터를 뺀 상품 주소 (타오바오는 id 만 남김) */
export function canonicalUrl(url: string, site: SupplySite, id: string): string {
  const u = new URL(url);
  return site === "TAOBAO" ? `${u.origin}${u.pathname}?id=${id}` : `${u.origin}${u.pathname}`;
}

type Json = Record<string, unknown>;
function ldNodes(blocks: string[]): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      out.push(v as Json);
      const g = (v as Json)["@graph"];
      if (g) walk(g);
    }
  };
  for (const b of blocks) {
    try {
      walk(JSON.parse(b));
    } catch {
      // 깨진 JSON-LD 는 건너뛴다
    }
  }
  return out;
}

const SUFFIX = /\s*-\s*Buy\s+.*on Alibaba\.com\s*$/i;

export function adaptSupplierPage(raw: RawSupplierPageInput): { offer: CollectedSupplyOffer | null; issues: string[] } {
  const issues: string[] = [];
  const s = siteOf(raw.url);
  if (!s) return { offer: null, issues: ["지원하는 도매 상품 주소가 아닙니다 (Alibaba.com · 1688 · 타오바오 상품 상세)"] };

  const nodes = ldNodes(raw.jsonLd);
  const product = nodes.find((n) => n["@type"] === "Product") ?? null;
  const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList") ?? null;

  const title = (raw.h1 || (product?.name as string | undefined) || raw.ogTitle || raw.title || "").replace(SUFFIX, "").trim();
  if (!title) issues.push("상품명을 읽지 못했습니다");

  const images = new Set<string>();
  const img = product?.image;
  for (const x of Array.isArray(img) ? img : img ? [img] : []) if (typeof x === "string" && /^https?:\/\//.test(x)) images.add(x);
  if (raw.ogImage && /^https?:\/\//.test(raw.ogImage)) images.add(raw.ogImage);

  const offers = product?.offers as Json | Json[] | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const base = offer ? parseMoney(String(offer.price ?? offer.lowPrice ?? "")) : null;
  const baseCurrency = offer && typeof offer.priceCurrency === "string" ? offer.priceCurrency.toUpperCase() : null;
  const basePrice = base && baseCurrency ? { amount: base.amount, currency: baseCurrency } : null;

  const tiers: PriceTier[] = [];
  for (const t of raw.priceTiers) {
    const money = parseMoney(t.price);
    const qty = parseQtyRange(t.qty);
    if (!money || !qty || !money.currency) {
      issues.push(`가격 구간을 읽지 못함: ${t.price} / ${t.qty}`);
      continue;
    }
    tiers.push({ minQty: qty.min, maxQty: qty.max, amount: money.amount, currency: money.currency });
  }
  tiers.sort((a, b) => a.minQty - b.minQty);
  const tierCurrency = tiers[0]?.currency ?? null;
  const tiersConverted = !!(tierCurrency && baseCurrency && tierCurrency !== baseCurrency);

  const attributes: Record<string, string> = {};
  for (const [k, v] of raw.attributes) if (k && v && !(k in attributes)) attributes[k] = v.slice(0, 300);
  const attr = (...keys: string[]) => keys.map((k) => attributes[k]).find(Boolean) ?? null;

  const attrMoq = parseQtyRange(`${attr("MOQ", "최소 주문", "최소 주문량") ?? ""} 이상`)?.min ?? null;
  const moq = tiers[0]?.minQty ?? attrMoq;
  if (tiers[0] && attrMoq && attrMoq !== tiers[0].minQty) issues.push(`최소 주문 수량이 서로 다름: 가격 구간 ${tiers[0].minQty} · 속성 ${attrMoq} (가격 구간 값을 씀)`);

  let shipping: CollectedSupplyOffer["shipping"] = null;
  if (raw.shippingText) {
    const m = raw.shippingText.replace(/,/g, "").match(/(\d+)\s*개당\s*([₩$¥￥]|US\$)?\s*(\d+(?:\.\d+)?)/);
    const cur = m ? currencyOf(m[2] ?? raw.shippingText) : null;
    if (m && cur) shipping = { perQty: Number(m[1]), amount: Number(m[3]), currency: cur, text: raw.shippingText.slice(0, 200) };
    else {
      shipping = { perQty: null, amount: null, currency: null, text: raw.shippingText.slice(0, 200) };
      issues.push("배송비 문구를 숫자로 읽지 못함 (원문만 보관)");
    }
  }

  const card = raw.supplierCardText ?? "";
  const brandNode = product?.brand as Json | undefined;
  const supplierName =
    (typeof brandNode?.name === "string" && /co\.|ltd|company|factory|公司|厂|有限/i.test(brandNode.name) ? brandNode.name : null) ??
    card.match(/([A-Z][\w&.,'()\- ]+?(?:Co\.?,? ?Ltd\.?|Company|Factory|Limited))/)?.[1]?.trim() ??
    null;
  const years = card.match(/(\d+)\s*(?:년|years?|年)/i);
  const rating = card.match(/\b([0-5]\.\d)\b/);
  const location = card.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)?)에 위치/)?.[1] ?? null;

  const colorsText = attr("색상", "颜色", "Color");
  const result: CollectedSupplyOffer = {
    site: s.site,
    siteProductId: s.id,
    url: canonicalUrl(raw.url, s.site, s.id),
    title,
    imageUrls: [...images].slice(0, 10),
    categoryPath: crumbs
      ? ((crumbs.itemListElement as Json[] | undefined) ?? [])
          .map((x) => String(x.name ?? ""))
          .filter(Boolean)
          .join(" > ") || null
      : null,
    basePrice,
    tiers,
    tiersConverted,
    moq,
    supplierName,
    supplierUrl: raw.supplierUrl,
    supplierMeta: { years: years ? Number(years[1]) : null, rating: rating ? Number(rating[1]) : null, location },
    attributes,
    material: attr("재질", "材质", "Material"),
    sizeText: attr("크기", "규격", "尺寸", "Size"),
    colors: colorsText ? colorsText.split(/[,，/]/).map((x) => x.trim()).filter(Boolean) : [],
    brand: attr("브랜드명", "品牌", "Brand Name"),
    model: attr("모델 번호", "型号", "Model Number"),
    weightKg: parseWeightKg(attr("단일 총중량", "毛重", "Single gross weight")) ?? parseWeightKg(attr("무게", "重量", "Weight")),
    packageSizeText: attr("하나의 패키지 크기", "包装尺寸", "Single package size"),
    shipping,
    issues,
  };
  if (!basePrice && tiers.length === 0) issues.push("가격을 읽지 못했습니다 (로그인 · 지역 · 페이지 구조에 따라 숨겨질 수 있음)");
  return { offer: result, issues };
}
