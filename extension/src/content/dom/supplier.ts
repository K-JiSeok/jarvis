/**
 * 중국 도매 상품 페이지 화면 읽기 (PHASE 18). chrome API 없음 — 검사용 번들 · 실제 페이지 대조에서 그대로 실행된다.
 *
 * 화면(DOM)과 페이지에 들어 있는 구조화 데이터(JSON-LD · og 메타)만 읽는다. 사이트 내부 API 호출 · 네트워크 가로채기 없음.
 * 해석(가격 · 수량 · 통화)은 src/lib/collectors/supplier/page.ts 의 순수 함수가 한다.
 *
 *   Alibaba.com 상품 상세 (2026-10-12 실제 페이지에서 확인한 구조)
 *     JSON-LD Product: name · image[] · sku · brand.name(공급업체) · offers.price/priceCurrency(최저가, 원래 통화)
 *     JSON-LD BreadcrumbList: 카테고리
 *     [data-testid=pc-purchase-price-tier]: 수량 구간별 가격 (화면 표시 통화 — 사이트가 환산한 값일 수 있음) + "20-99 개"
 *     [data-testid=module-attribute-row]: 주요 속성 (재질 · 크기 · 무게 · 색상 · 브랜드명 · 모델 번호 · 원산지 …) 이름 · 값
 *     .module_shipping: 배송비 문구 (주소 · 시점 기준) · .module_unifed_company_card: 공급업체 카드
 *   1688 · 타오바오: 이 환경에서 페이지를 열어 구조를 확인하지 못했다 → 공통 구조화 데이터(JSON-LD · og 메타 · 제목)만 읽는다
 */

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export interface RawSupplierPage {
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

export function readSupplierPage(doc: Document = document, href: string = location.href): RawSupplierPage {
  const meta = (p: string) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content") ?? null;
  const tiers = [...doc.querySelectorAll('[data-testid="pc-purchase-price-tier"]')]
    .map((t) => {
      const lines = (t as HTMLElement).innerText?.split("\n").map(clean).filter(Boolean) ?? [];
      return { price: lines[0] ?? "", qty: lines[1] ?? "" };
    })
    .filter((t) => t.price && t.qty);
  const attributes: [string, string][] = [...doc.querySelectorAll('[data-testid="module-attribute-row"]')]
    .map((row) => [clean(row.querySelector('[data-testid="module-attribute-name"]')?.textContent), clean(row.querySelector('[data-testid="module-attribute-value"]')?.textContent)] as [string, string])
    .filter(([k, v]) => k && v);
  const ship = doc.querySelector(".module_shipping");
  const card = doc.querySelector(".module_unifed_company_card");
  const sku = doc.querySelector(".module_sku");
  return {
    url: href,
    host: new URL(href).host,
    title: clean(doc.title),
    h1: clean(doc.querySelector("h1")?.textContent) || null,
    jsonLd: [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? "").filter(Boolean).slice(0, 10),
    ogImage: meta("og:image"),
    ogTitle: meta("og:title"),
    priceTiers: tiers.slice(0, 10),
    attributes: attributes.slice(0, 60),
    shippingText: clean((ship as HTMLElement | null)?.innerText) || null,
    supplierCardText: clean((card as HTMLElement | null)?.innerText).slice(0, 600) || null,
    supplierUrl: (card?.querySelector("a[href]") as HTMLAnchorElement | null)?.href ?? null,
    skuText: clean((sku as HTMLElement | null)?.innerText).slice(0, 800) || null,
  };
}
