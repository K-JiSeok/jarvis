/** 쿠팡 상품 상세 페이지 콘텐츠 스크립트: [현재 상품 수집] */

import { adaptProductPage } from "../shared/normalize";
import type { IngestRecord } from "../shared/types";

import { start, type PageCollector } from "./common";
import { productTitle, readProductPage } from "./dom/product";

/** 판매량 추정용 리뷰 날짜 안내 (PHASE 22) — 최신순이어야 서버가 판매 속도 계산에 쓴다 */
function reviewLine(joined: string): string {
  const d = joined ? joined.split(",") : [];
  if (d.length === 0) return "리뷰 날짜 0개 — 리뷰 목록까지 내려 [최신순]을 누른 뒤 다시 수집하면 판매량을 추정합니다";
  const newest = d.every((x, i) => i === 0 || x <= d[i - 1]);
  return newest ? `리뷰 날짜 ${d.length}개 (최신순 ${d[d.length - 1]} ~ ${d[0]}) — 판매량 추정에 사용` : `리뷰 날짜 ${d.length}개가 최신순이 아님 — [최신순]을 누른 뒤 다시 수집`;
}

const won = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("ko-KR")}원` : "-");

const collector: PageCollector = {
  pageType: "product",
  detect() {
    if (!/\/vp\/products\/\d+/.test(location.pathname)) return { pageType: "product", collectable: false, reason: "상품 ID 가 없는 주소입니다.", summary: [] };
    const title = productTitle();
    if (!title) return { pageType: "product", collectable: false, reason: "상품 정보를 아직 불러오지 않았습니다. 잠시 후 다시 여세요.", summary: [] };
    return { pageType: "product", collectable: true, summary: [title.slice(0, 60)] };
  },
  read() {
    const raw = readProductPage();
    if (!raw.title) return { error: "상품명을 찾지 못했습니다." };
    const product = adaptProductPage(raw, { source: "COUPANG_PAGE", confidence: "A", capturedAt: new Date().toISOString() });
    const record: IngestRecord = { kind: "product", ...product };
    return {
      records: [record],
      summary: [
        `상품 ID ${product.coupangProductId}`,
        raw.title.slice(0, 60),
        `가격 ${won(product.price)}${product.originalPrice ? ` (정가 ${won(product.originalPrice)})` : ""}`,
        `리뷰 ${product.reviewCount ?? "-"} · 평점 ${product.rating ?? "-"}`,
        `배송 ${product.deliveryType ?? "확인 못 함"} · 판매자 ${product.sellerType ?? "확인 못 함"}`,
        reviewLine(String(raw.observedOnly?.reviewDates ?? "")),
      ],
    };
  },
};

start(collector);
