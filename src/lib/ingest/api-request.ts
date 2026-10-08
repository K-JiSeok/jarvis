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

// ---------------------------------------------------------------------------------------------
// PHASE 12: 확장 프로그램 검색 결과 → 등록 여부 확인 · 선택 상품 등록
// ---------------------------------------------------------------------------------------------

/** 등록 여부 확인 1회 최대 상품 수 (검색 1페이지 60칸 · 중복 제외면 충분) */
export const MAX_LOOKUP_IDS = 300;
/** 선택 상품 등록 1회 최대 상품 수 (DB 함수 한도와 같음) */
export const MAX_REGISTER_PRODUCTS = 100;

const PRODUCT_ID = /^\d{1,20}$/;
const cleanKeyword = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export type LookupParse = { ok: true; keyword: string | null; coupangProductIds: string[] } | { ok: false; status: number; error: string };

export function parseLookupRequest(body: unknown): LookupParse {
  if (!isObject(body)) return { ok: false, status: 400, error: "JSON 객체가 필요합니다." };
  const keyword = body.keyword == null ? null : cleanKeyword(body.keyword);
  if (keyword !== null && (keyword.length === 0 || keyword.length > 100)) return { ok: false, status: 400, error: "keyword 는 1~100자입니다." };
  const ids = body.coupangProductIds;
  if (!Array.isArray(ids)) return { ok: false, status: 400, error: "coupangProductIds 배열이 필요합니다." };
  if (ids.length > MAX_LOOKUP_IDS) return { ok: false, status: 413, error: `coupangProductIds 는 최대 ${MAX_LOOKUP_IDS}개입니다.` };
  if (!ids.every((id) => typeof id === "string" && PRODUCT_ID.test(id))) return { ok: false, status: 400, error: "쿠팡 상품 ID 는 숫자 문자열이어야 합니다." };
  return { ok: true, keyword, coupangProductIds: [...new Set(ids as string[])] };
}

export interface RegisterRequest {
  batch: IngestRequestBatch;
  /** 사용자가 고른 상품 (이 목록만 products 에 만든다) */
  products: { coupang_product_id: string; product_name: string | null }[];
  /** 사용자가 [키워드도 등록] 을 고른 경우만 */
  keyword: { keyword: string; memo: string | null } | null;
}

export type RegisterParse = { ok: true; request: RegisterRequest } | { ok: false; status: number; error: string };

/**
 * 선택 상품 등록 요청. records 는 /api/ingest 와 같은 형식 · 같은 검사 (parseIngestRequest).
 * 자동 등록 방지: products 는 사용자가 고른 목록이어야 하고, 그 상품들은 보내는 검색 결과(records) 안에 있어야 한다.
 */
export function parseRegisterRequest(body: unknown, now = Date.now()): RegisterParse {
  if (!isObject(body)) return { ok: false, status: 400, error: "JSON 객체가 필요합니다." };
  const base = parseIngestRequest({ idempotencyKey: body.idempotencyKey, tool: body.tool, version: body.version, records: body.records }, now);
  if (!base.ok) return base;
  const products = body.products;
  if (!Array.isArray(products) || products.length === 0) return { ok: false, status: 400, error: "선택한 상품이 없습니다." };
  if (products.length > MAX_REGISTER_PRODUCTS) return { ok: false, status: 413, error: `한 번에 최대 ${MAX_REGISTER_PRODUCTS}개까지 등록합니다.` };
  const out: RegisterRequest["products"] = [];
  const seen = new Set<string>();
  for (const [i, p] of products.entries()) {
    if (!isObject(p) || typeof p.coupangProductId !== "string" || !PRODUCT_ID.test(p.coupangProductId)) {
      return { ok: false, status: 400, error: `products[${i}].coupangProductId 가 올바르지 않습니다.` };
    }
    if (seen.has(p.coupangProductId)) continue;
    seen.add(p.coupangProductId);
    const name = typeof p.productName === "string" ? p.productName.trim().replace(/\s+/g, " ").slice(0, 300) : "";
    out.push({ coupang_product_id: p.coupangProductId, product_name: name || null });
  }
  // 고른 상품은 이번 검색 결과에 있는 상품이어야 한다 (화면에 없던 상품을 몰래 만들지 않음)
  const inSearch = new Set(
    base.batch.searches.flatMap((s) => (s.items ?? []).map((it) => it.coupangProductId ?? it.productUrl?.match(/\/products\/(\d+)/)?.[1] ?? null)),
  );
  const outside = out.filter((p) => !inSearch.has(p.coupang_product_id));
  if (base.batch.searches.length === 0 || outside.length > 0) {
    return { ok: false, status: 400, error: `선택한 상품이 보낸 검색 결과에 없습니다 (${outside.map((p) => p.coupang_product_id).slice(0, 3).join(", ")}).` };
  }
  let keyword: RegisterRequest["keyword"] = null;
  if (body.registerKeyword != null) {
    const k = cleanKeyword(body.registerKeyword);
    if (!k || k.length > 100) return { ok: false, status: 400, error: "registerKeyword 는 1~100자입니다." };
    // 등록할 키워드는 이번 검색어여야 한다
    if (!base.batch.searches.some((s) => cleanKeyword(s.keyword).toLowerCase() === k.toLowerCase())) {
      return { ok: false, status: 400, error: "registerKeyword 가 검색어와 다릅니다." };
    }
    keyword = { keyword: k, memo: null };
  }
  return { ok: true, request: { batch: base.batch, products: out, keyword } };
}
