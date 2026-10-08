/**
 * POST /api/ingest 요청 검사 (순수 함수 — Node 테스트에서 직접 실행).
 *
 * 요청 본문
 *   { idempotencyKey: uuid, tool: "jarvis-extension", version: "0.1.0",
 *     records: [{ kind: "product", ...CollectedProduct } | { kind: "search", ...CollectedSearchResult } | { kind: "keyword", ...CollectedKeyword }] }
 *
 * 여기서는 모양 · 크기 · 시각만 본다. 값 변환과 검증은 ingestCollected() → normalize 가 한다 (확장 프로그램 값을 그대로 믿지 않는다).
 */

import type { CollectedKeyword, CollectedProduct, CollectedSearchResult } from "../collectors/types";

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_RECORDS = 2000;
/** 검색 결과 1건 안의 상품 칸 최대 수 (쿠팡 1페이지는 60칸 안팎) */
export const MAX_SEARCH_ITEMS = 200;
/** 확장 프로그램은 화면을 읽은 즉시 보낸다. 이보다 오래된 수집 시각은 받지 않는다 (미래 시각은 normalize 가 거부) */
export const MAX_CAPTURE_AGE_MS = 24 * 3600 * 1000;

/** 고정 확장 프로그램 ID (extension/manifest.base.json 의 key 로 정해진다 — scripts/extension/test.mjs 가 확인) */
export const JARVIS_EXTENSION_ID = "hheghdpjpgggnengckfclfbjklnbgnbf";

export interface IngestRequestBatch {
  idempotencyKey: string;
  tool: string;
  products: CollectedProduct[];
  searches: CollectedSearchResult[];
  keywords: CollectedKeyword[];
}

export type ParseResult = { ok: true; batch: IngestRequestBatch } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL = /^[a-z0-9][a-z0-9._-]{0,47}$/i;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (error: string, status = 400): ParseResult => ({ ok: false, status, error });

/** 허용 Origin: 등록된 확장 프로그램 origin 만. Origin 이 없는 요청(서버 · 스크립트)은 토큰 검사로만 막는다 */
export function allowedOrigins(env: string | undefined): string[] {
  const extra = (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^chrome-extension:\/\/[a-p]{32}$/.test(s));
  return [`chrome-extension://${JARVIS_EXTENSION_ID}`, ...extra];
}

export function isAllowedOrigin(origin: string | null, allowed: string[]): boolean {
  return origin == null || allowed.includes(origin);
}

export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  return m?.[1] ?? null;
}

export function parseIngestRequest(body: unknown, now = Date.now()): ParseResult {
  if (!isObject(body)) return fail("JSON 객체가 필요합니다.");
  const { idempotencyKey, tool, version, records } = body;
  if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) return fail("idempotencyKey 는 UUID 여야 합니다.");
  if (typeof tool !== "string" || !TOOL.test(tool)) return fail("tool 이름이 올바르지 않습니다.");
  if (typeof version !== "string" || !VERSION.test(version)) return fail("version 은 0.1.0 형식이어야 합니다.");
  if (!Array.isArray(records) || records.length === 0) return fail("records 가 비어 있습니다.");
  if (records.length > MAX_RECORDS) return fail(`records 는 최대 ${MAX_RECORDS}건입니다 (${records.length}건).`, 413);

  const batch: IngestRequestBatch = { idempotencyKey, tool: `${tool}/${version}`, products: [], searches: [], keywords: [] };
  for (const [i, r] of records.entries()) {
    if (!isObject(r)) return fail(`records[${i}] 가 객체가 아닙니다.`);
    const { kind, ...rest } = r;
    if (typeof rest.capturedAt !== "string") return fail(`records[${i}].capturedAt 이 없습니다.`);
    const at = Date.parse(rest.capturedAt);
    if (Number.isFinite(at) && now - at > MAX_CAPTURE_AGE_MS) return fail(`records[${i}].capturedAt 이 24시간보다 오래됐습니다 (서버 시각 기준).`);
    if (kind === "product") batch.products.push(rest as unknown as CollectedProduct);
    else if (kind === "search") {
      if (!Array.isArray(rest.items)) return fail(`records[${i}].items 가 없습니다.`);
      if (rest.items.length > MAX_SEARCH_ITEMS) return fail(`records[${i}].items 는 최대 ${MAX_SEARCH_ITEMS}칸입니다.`, 413);
      batch.searches.push(rest as unknown as CollectedSearchResult);
    } else if (kind === "keyword") batch.keywords.push(rest as unknown as CollectedKeyword);
    else return fail(`records[${i}].kind 는 product · search · keyword 중 하나여야 합니다.`);
  }
  return { ok: true, batch };
}

/** 사용자별 요청 제한 (서버 프로세스 메모리 — 여러 인스턴스로 배포하면 인스턴스마다 따로 센다) */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** 허용되면 0, 막히면 다시 시도할 수 있을 때까지 남은 초 */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }
}
