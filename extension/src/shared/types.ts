import type { CollectedKeyword, CollectedProduct, CollectedSearchResult, NormalizeIssue } from "../../../src/lib/collectors/types";

export type PageType = "product" | "search" | "wing" | "other";

export const PAGE_LABELS: Record<PageType, string> = {
  product: "상품 페이지",
  search: "검색 결과",
  wing: "WING",
  other: "지원하지 않는 페이지",
};

/** /api/ingest 로 보내는 레코드 (서버가 다시 정규화한다) */
export type IngestRecord =
  | ({ kind: "product" } & CollectedProduct)
  | ({ kind: "search" } & CollectedSearchResult)
  | ({ kind: "keyword" } & CollectedKeyword);

export interface CollectCounts {
  products: number;
  ranks: number;
  keywords: number;
}

/** 콘텐츠 스크립트 → 팝업: 현재 페이지 상태 */
export interface DetectResponse {
  pageType: PageType;
  collectable: boolean;
  /** 수집할 수 없는 이유 (collectable = false) */
  reason?: string | null;
  /** 화면에서 읽은 요약 (예: 상품명 · 가격) */
  summary: string[];
}

/** 콘텐츠 스크립트 → 팝업 · 배경: 수집 결과 (아직 전송 전) */
export interface CollectResponse {
  ok: boolean;
  pageType: PageType;
  error?: string;
  records: IngestRecord[];
  counts: CollectCounts;
  /** 로컬 정규화(미리보기)에서 나온 주의 사항 */
  issues: NormalizeIssue[];
  summary: string[];
}

/** /api/ingest 응답 */
export interface IngestResult {
  ok: boolean;
  replay?: boolean;
  jobId?: string | null;
  status?: string;
  total?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  failures?: Record<string, number>;
  notFound?: { coupangProductId: string | null; productName: string | null; rank: number | null; isAd: boolean | null }[];
  issues?: NormalizeIssue[];
  jarvisPath?: string;
  error?: string;
  httpStatus?: number;
}

export interface LastRun {
  at: string;
  pageType: PageType;
  counts: CollectCounts;
  summary: string[];
  result: IngestResult;
}

export type Message =
  | { type: "jarvis:detect" }
  | { type: "jarvis:collect" }
  | { type: "jarvis:ingest"; collect: CollectResponse }
  | { type: "jarvis:status" }
  | { type: "jarvis:login"; email: string; password: string }
  | { type: "jarvis:logout" }
  /** 개발 빌드 전용: 본문을 그대로 /api/ingest 로 (잘못된 요청 · 재전송 시험) */
  | { type: "jarvis:dev-raw"; body: string };
