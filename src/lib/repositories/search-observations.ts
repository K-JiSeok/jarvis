import "server-only";

import { normalizeKeyword } from "@/lib/keywords";
import { createClient } from "@/lib/supabase/server";

/*
 * 키워드 검색 결과 관측 (PHASE 12, 읽기 전용).
 *
 * 확장 프로그램이 /api/ingest 로 보낸 검색 결과 1건 = import_jobs 1개 + 칸마다 import_rows 1행 (kind 순위, payload.collected 에 화면 값).
 * 등록하지 않은 상품의 칸도 PRODUCT_NOT_FOUND 행으로 payload 가 남는다 → 새 테이블 없이 "검색 결과 전체"를 다시 보여 줄 수 있다.
 * 순위 테이블(keyword_product_ranks)에는 등록 상품만 있다. 선택 상품 등록(register-v1) job 은 일부 칸만 담으므로 "수집 1회"로 세지 않는다.
 */

export interface SearchObservationItem {
  coupangProductId: string | null;
  productName: string | null;
  rank: number | null;
  isAd: boolean;
  displayPosition: number | null;
  price: number | null;
  reviewCount: number | null;
  rating: number | null;
  badge: string | null;
  deliveryType: string | null;
  /** 수집 당시 JARVIS 등록 상품이었는지 (PRODUCT_NOT_FOUND = 미등록, KEYWORD_NOT_FOUND 면 상품 확인 전에 멈췄으므로 모름 = null) */
  registeredAtCapture: boolean | null;
  /** 지금 등록된 상품이면 그 id */
  productId: string | null;
  result: string;
}

export interface SearchObservation {
  jobId: string;
  capturedAt: string;
  total: number;
  organic: number;
  ads: number;
  uniqueProducts: number;
  registered: number;
  unregistered: number;
  /** 키워드가 미등록이던 수집이라 상품 등록 여부를 모르는 상품 수 */
  unknown: number;
  items: SearchObservationItem[];
}

/**
 * 행 결과 → 수집 당시 등록 여부. 저장(INSERTED · UPDATED) 또는 같은 값 건너뜀 = 등록, PRODUCT_NOT_FOUND = 미등록.
 * 배치 안 반복 칸(DUPLICATE_IN_BATCH)은 상품을 찾기 전에 건너뛰고, KEYWORD_NOT_FOUND 는 상품 확인 전에 멈추므로 이 행만으로는 모름(null).
 */
export function registeredFromRow(result: string, errorCode: string | null): boolean | null {
  if (errorCode === "PRODUCT_NOT_FOUND") return false;
  if (errorCode === "KEYWORD_NOT_FOUND" || errorCode === "DUPLICATE_IN_BATCH") return null;
  return result === "INSERTED" || result === "UPDATED" || result === "SKIPPED" ? true : null;
}

/** 같은 상품의 여러 칸: 하나라도 등록이면 등록, 아니면 하나라도 미등록이면 미등록, 아니면 모름 */
export const mergeRegistered = (a: boolean | null, b: boolean | null): boolean | null => (a === true || b === true ? true : a === false || b === false ? false : null);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 최근 검색 결과 수집 (최대 limit 회, 최신 → 과거). 첫 번째만 칸 목록 포함 */
export async function listSearchObservations(keyword: string, { limit = 10 } = {}): Promise<SearchObservation[]> {
  const supabase = await createClient();
  const prefix = `keyword_product_rank:${normalizeKeyword(keyword)}:`.replace(/[\\%_]/g, (c) => `\\${c}`);

  const { data: jobRows, error: jobError } = await supabase
    .from("import_rows")
    .select("import_job_id, import_jobs!inner(created_at, schema_version, channel)")
    .like("record_key", `${prefix}%`)
    .eq("import_jobs.schema_version", "ingest-v1")
    .eq("import_jobs.channel", "EXTENSION")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (jobError) throw jobError;
  const jobIds = [...new Set((jobRows ?? []).map((r) => r.import_job_id))].slice(0, limit);
  if (jobIds.length === 0) return [];

  const { data: rows, error } = await supabase
    .from("import_rows")
    .select("import_job_id, row_number, result, error_code, payload, created_at")
    .in("import_job_id", jobIds)
    .like("record_key", `${prefix}%`)
    .order("row_number")
    .limit(5000);
  if (error) throw error;

  const ids = [...new Set(rows.map((r) => ((r.payload as { collected?: { coupangProductId?: string } })?.collected?.coupangProductId ?? null)).filter((x): x is string => !!x))];
  const { data: products } = ids.length
    ? await supabase.from("products").select("id, coupang_product_id").in("coupang_product_id", ids)
    : { data: [] as { id: string; coupang_product_id: string }[] };
  const productIdOf = new Map((products ?? []).map((p) => [p.coupang_product_id, p.id]));

  return jobIds.map((jobId, index) => {
    const own = rows.filter((r) => r.import_job_id === jobId);
    const items: SearchObservationItem[] = own.map((r) => {
      const c = ((r.payload as { collected?: Record<string, unknown> })?.collected ?? {}) as Record<string, unknown>;
      const id = (c.coupangProductId as string) ?? null;
      return {
        coupangProductId: id,
        productName: (c.productName as string) ?? null,
        rank: num(c.rank),
        isAd: c.isAd === true,
        displayPosition: num(c.displayPosition),
        price: num(c.price),
        reviewCount: num(c.reviewCount),
        rating: num(c.rating),
        badge: (c.badge as string) ?? null,
        deliveryType: (c.deliveryType as string) ?? null,
        registeredAtCapture: registeredFromRow(r.result, r.error_code),
        productId: id ? (productIdOf.get(id) ?? null) : null,
        result: r.result,
      };
    });
    const unique = new Map<string, boolean | null>();
    for (const it of items) if (it.coupangProductId) unique.set(it.coupangProductId, mergeRegistered(unique.get(it.coupangProductId) ?? null, it.registeredAtCapture));
    const registered = [...unique.values()].filter((v) => v === true).length;
    const unknown = [...unique.values()].filter((v) => v == null).length;
    const ads = items.filter((i) => i.isAd).length;
    return {
      jobId,
      capturedAt: own[0]?.created_at ?? "",
      total: items.length,
      organic: items.length - ads,
      ads,
      uniqueProducts: unique.size,
      registered,
      unregistered: unique.size - registered - unknown,
      unknown,
      items: index === 0 ? items.sort((a, b) => (a.displayPosition ?? 0) - (b.displayPosition ?? 0)) : [],
    };
  });
}
