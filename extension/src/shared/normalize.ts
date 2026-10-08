/**
 * 확장 프로그램 쪽 미리보기 정규화. JARVIS 본체의 순수 함수(src/lib/collectors)를 그대로 쓴다 → 규칙이 하나다.
 * 서버(/api/ingest)는 받은 값을 같은 함수로 다시 정규화한다 (여기 결과를 믿지 않는다).
 */

import { normalizeKeyword, normalizeProduct, normalizeSearch } from "../../../src/lib/collectors/normalize";
import type { NormalizeIssue } from "../../../src/lib/collectors/types";

import type { CollectCounts, IngestRecord } from "./types";

export function previewRecords(records: IngestRecord[]): { counts: CollectCounts; issues: NormalizeIssue[] } {
  const counts: CollectCounts = { products: 0, ranks: 0, keywords: 0 };
  const issues: NormalizeIssue[] = [];
  for (const r of records) {
    if (r.kind === "product") {
      const n = normalizeProduct(r);
      if (n.record) counts.products += 1;
      issues.push(...n.issues);
    } else if (r.kind === "search") {
      const n = normalizeSearch(r);
      counts.ranks += n.records.length;
      issues.push(...n.issues);
    } else {
      const n = normalizeKeyword(r);
      if (n.record) counts.keywords += 1;
      issues.push(...n.issues);
    }
  }
  return { counts, issues };
}

export { adaptProductPage, badgeFromImageName, pickPrice, ratingFromStarWidth, type PriceLeaf } from "../../../src/lib/collectors/coupang/product";
export { adaptSearchPage, correctedQueryOf, isAdLabel, searchParamsOf } from "../../../src/lib/collectors/coupang/search";
