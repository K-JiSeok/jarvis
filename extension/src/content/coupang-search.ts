/** 쿠팡 검색 결과 콘텐츠 스크립트: [현재 검색 결과 수집] — 지금 보이는 페이지만 (다음 페이지로 이동하지 않는다) */

import { adaptSearchPage, correctedQueryOf, searchParamsOf } from "../shared/normalize";
import type { IngestRecord } from "../shared/types";

import { start, type PageCollector } from "./common";
import { productUnits, readSearchPage } from "./dom/search";

const collector: PageCollector = {
  pageType: "search",
  detect() {
    const { keyword, page } = searchParamsOf(location.href);
    const n = productUnits().length;
    if (!keyword) return { pageType: "search", collectable: false, reason: "검색어(q)가 없는 주소입니다.", summary: [] };
    const corrected = correctedQueryOf(location.href);
    if (corrected) {
      return { pageType: "search", collectable: false, reason: `쿠팡이 검색어를 "${corrected}"(으)로 바꿔 보여 준 결과라 "${keyword}" 순위로 저장하지 않습니다.`, summary: [`"${keyword}"`] };
    }
    if (page !== 1) {
      return { pageType: "search", collectable: false, reason: `${page ?? "?"}페이지입니다. 2페이지 이상은 순위가 이어지는지 확인하지 못해 아직 수집하지 않습니다.`, summary: [`"${keyword}"`] };
    }
    if (n === 0) return { pageType: "search", collectable: false, reason: "검색 결과 상품을 찾지 못했습니다.", summary: [`"${keyword}"`] };
    return { pageType: "search", collectable: true, summary: [`"${keyword}" ${page}페이지 · 상품 ${n}칸`] };
  },
  read() {
    const d = collector.detect();
    if (!d.collectable) return { error: d.reason ?? "수집할 수 없는 화면입니다." };
    const result = adaptSearchPage(readSearchPage(), { source: "COUPANG_PAGE", confidence: "A", capturedAt: new Date().toISOString() });
    const ads = result.items.filter((i) => i.isAd).length;
    const record: IngestRecord = { kind: "search", ...result };
    return {
      records: [record],
      summary: [`"${result.keyword}" ${result.page}페이지`, `상품 ${result.items.length}칸 (자연 ${result.items.length - ads} · 광고 ${ads})`],
    };
  },
};

start(collector);
