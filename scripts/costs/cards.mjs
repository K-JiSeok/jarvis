// 공식 페이지에서 옮겨 적은 요율 JSON → cost_rate_cards 행 (seed-sql.mjs · test.mjs 가 같이 쓴다)

export function buildRows(d) {
  const RG_URL = "https://wing.coupang.com/tenants/rfm/settlements/fee-details";
  const HELP_URL = "https://helpseller.coupangcorp.com/hc/ko/articles/15892116953881";
  const FEE_URL = "https://wing.coupang.com/tenants/seller-web/vendor-inventory/commission-info";
  const PROMO_UNTIL = "2027-01-31";

  const rows = [];
  const add = (kind, scope, rates, o) => rows.push({ kind, scope, rates, vat: "EXCLUDED", promoUntil: null, ...o });

  add("SIZE_RULE", "*", d.sizeRule, { validFrom: "2025-01-06", url: RG_URL, label: "WING 로켓그로스 비용/수수료 · 사이즈 유형 상세 기준", note: "세 변의 합과 무게로 판단 (FAQ). 두 기준 중 큰 유형을 적용하는 것은 표를 읽은 해석" });
  for (const [group, t] of Object.entries(d.fulfillment)) {
    const common = { validFrom: "2025-01-06", promoUntil: PROMO_UNTIL, url: RG_URL, note: `카테고리 예: ${t.example}` };
    add("RG_INOUT", group, { bands: d.bands, sizes: d.sizes, base: t.inout.base, promo: t.inout.promo }, { ...common, label: "WING 입출고/배송 비용 · 입출고비만 보기 (수량 당)" });
    add("RG_DELIVERY", group, { bands: d.bands, sizes: d.sizes, base: t.delivery.base, promo: t.delivery.promo }, { ...common, label: "WING 입출고/배송 비용 · 배송비만 보기 (주문 상품 당 1회)" });
    add("RG_RETURN_PICKUP", group, { bands: d.bands, sizes: d.sizes, base: t.returnPickup.base, promo: t.returnPickup.promo }, { ...common, validFrom: "2025-04-01", label: "WING 반품 회수비 · 2차 프로모션 (상품 당, 매월 20개 무료)" });
  }
  add("RG_RESTOCK", "*", d.restock, { validFrom: "2025-01-06", promoUntil: PROMO_UNTIL, url: RG_URL, label: "WING 반품 재입고비 (수량 당, 매월 20개 무료)", note: "판매자 도움말은 25.07.01 재입고 할인 종료 · 카테고리별 할인율 적용이라 안내 — WING 표(프로모션 적용가)와 다를 수 있음" });
  add("RG_STORAGE", "*", d.storage, { validFrom: "2025-04-01", promoUntil: PROMO_UNTIL, url: HELP_URL, label: "판매자 도움말 · 보관비 (1CBM 당 일 요율, 악세서리/의류/신발 제외 카테고리)", note: "상품 부피(m3) × 보관일수 × 요율. 하루 보관비는 반올림. 매 입고 시 30일 무료(프로모션)" });
  add("RG_RELEASE", "*", d.release, { validFrom: "2025-01-06", promoUntil: PROMO_UNTIL, url: RG_URL, label: "WING 반출비 (개당, 매월 20개 무료)", note: "반출 택배 · 트럭 운송비는 별도" });
  for (const [scope, rate] of Object.entries(d.salesFee.base)) {
    add("SALES_FEE", scope, { rate, exceptions: d.salesFee.exceptions[scope] ?? [] }, { validFrom: "2019-11-25", url: FEE_URL, label: "WING 수수료 안내 (페이지 표기: 2019년 11월 25일 기준)", note: "소비자 판매가(판매자 할인 적용, 쿠팡 할인지원 미적용) × 수수료율. VAT 별도" });
  }

  return rows;
}

/** 테스트용 RateCard (DB 행 모양) */
export function buildCards(d) {
  return buildRows(d).map((r, i) => ({ id: `sys-${i}`, ownerId: null, kind: r.kind, scope: r.scope, rates: r.rates, vatBasis: r.vat, validFrom: r.validFrom, validTo: null, promoUntil: r.promoUntil, sourceUrl: r.url, sourceLabel: r.label, checkedOn: d.checkedAt, verification: "OFFICIAL_MANUAL", note: r.note }));
}
