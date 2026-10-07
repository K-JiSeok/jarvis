import type { Confidence, SourceType } from "./common";
import type { LifecycleStatus, ProductMetrics } from "./product";

/**
 * 경쟁상품 = 상품(products) 사이의 관계 (competitors 테이블). 별도 상품 데이터를 만들지 않는다.
 * 방향은 한쪽: "기준 상품 A 를 분석할 때 B 를 경쟁상품으로 본다" (A → B). B → A 는 자동으로 만들지 않는다.
 * 경쟁상품의 수치는 일반 상품과 같은 product_snapshots / v_product_latest 를 쓴다.
 */

/** competitors.relation_type (DB CHECK 와 동일, 추가하지 않는다) */
export const RELATION_TYPES = ["SAME_PRODUCT", "SIMILAR", "SUBSTITUTE"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  SAME_PRODUCT: "동일 상품",
  SIMILAR: "유사 상품",
  SUBSTITUTE: "대체 상품",
};
export const RELATION_TYPE_HINTS: Record<RelationType, string> = {
  SAME_PRODUCT: "같은 상품을 다른 판매자·다른 상품 페이지로 파는 경우 (가격·배송 직접 비교 대상)",
  SIMILAR: "같은 용도·비슷한 사양의 다른 상품",
  SUBSTITUTE: "다른 형태지만 같은 수요를 대신하는 상품",
};

export interface ProductRef {
  id: string;
  productName: string;
  coupangProductId: string;
  lifecycleStatus: LifecycleStatus;
}

/** 경쟁 관계 1건 + 경쟁상품의 현재 지표 */
export interface CompetitorRelation {
  id: string;
  base: ProductRef;
  competitor: ProductRef;
  relationType: RelationType;
  keywordId: string | null;
  keyword: string | null;
  source: SourceType;
  memo: string | null;
  /** false = 해제됨 (행은 보존) */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** 경쟁상품의 v_product_latest 값. 스냅샷이 없으면 지표가 모두 null */
  competitorMetrics: ProductMetrics | null;
  competitorLatestCapturedOn: string | null;
}

/** keyword_product_ranks 기반 경쟁상품 후보 (자동 등록하지 않는다) */
export interface CompetitorCandidate {
  keywordId: string;
  keyword: string;
  rank: number;
  isAd: boolean;
  capturedOn: string;
  source: SourceType;
  confidence: Confidence;
  product: ProductRef;
  metrics: ProductMetrics | null;
  /** 이미 등록된 관계 (해제된 것 포함) */
  existing: { id: string; isActive: boolean; relationType: RelationType } | null;
}

/** 키워드별 후보 묶음 */
export interface CandidateGroup {
  keywordId: string;
  keyword: string;
  /** 기준 상품의 이 키워드 최신 순위 (없으면 null) */
  baseRank: number | null;
  capturedOn: string;
  candidates: CompetitorCandidate[];
}
