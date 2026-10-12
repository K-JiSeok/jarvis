import "server-only";

import {
  hintKeywordsParam,
  KEYWORDSTOOL_URI,
  mapKeywordStats,
  MAX_HINT_KEYWORDS,
  NAVER_SEARCHAD_BASE_URL,
  type RelKwdStat,
} from "@/lib/collectors/naver/searchad";
import { naverSignature } from "@/lib/collectors/naver/signature";
import { normalizeKeyword } from "@/lib/keywords";
import { createClient } from "@/lib/supabase/server";

import { ingestCollected } from "./service";

/*
 * 네이버 검색광고 API → 키워드 검색량 (PHASE 13 — 수집 경계만. 키가 없으면 호출하지 않는다)
 *
 *   키: NAVER_SEARCHAD_API_KEY · NAVER_SEARCHAD_SECRET_KEY · NAVER_SEARCHAD_CUSTOMER_ID (.env.local, 서버 전용 — 코드에 넣지 않는다)
 *   호출: GET /keywordstool?hintKeywords=…&showDetail=1 (5개씩)
 *   저장: CollectedKeyword(OFFICIAL_API · A) → ingestCollected → ingest_batch (로그인 세션 = RLS, channel API)
 *   증감률: 같은 키워드의 이전 OFFICIAL_API 검색량(25~40일 전 스냅샷)이 있으면 search_volume_previous 로 넘긴다 → 기존 정규화 공식
 */

export interface NaverSearchAdConfig {
  apiKey: string;
  secretKey: string;
  customerId: string;
}

export function naverSearchAdConfig(): NaverSearchAdConfig | null {
  const apiKey = process.env.NAVER_SEARCHAD_API_KEY;
  const secretKey = process.env.NAVER_SEARCHAD_SECRET_KEY;
  const customerId = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
  return apiKey && secretKey && customerId ? { apiKey, secretKey, customerId } : null;
}

export class NaverSearchAdError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

async function fetchKeywordTool(config: NaverSearchAdConfig, keywords: string[]): Promise<RelKwdStat[]> {
  const timestamp = String(Date.now());
  const query = new URLSearchParams({ hintKeywords: hintKeywordsParam(keywords), showDetail: "1" });
  // 서명 대상은 쿼리를 뺀 경로 (공식 샘플: uri = '/keywordstool')
  const res = await fetch(`${NAVER_SEARCHAD_BASE_URL}${KEYWORDSTOOL_URI}?${query}`, {
    headers: {
      "X-Timestamp": timestamp,
      "X-API-KEY": config.apiKey,
      "X-Customer": config.customerId,
      "X-Signature": naverSignature(config.secretKey, timestamp, "GET", KEYWORDSTOOL_URI),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NaverSearchAdError(`네이버 검색광고 API 오류 ${res.status}${/1016/.test(body) ? " (요청이 너무 많음 — 잠시 후 다시)" : ""}`, res.status);
  }
  const json = (await res.json()) as { keywordList?: RelKwdStat[] };
  return json.keywordList ?? [];
}

/** 같은 키워드의 이전 공식 API 검색량 (25~40일 전) */
async function previousVolumes(keywords: string[], capturedOn: string): Promise<Record<string, number>> {
  const supabase = await createClient();
  const from = new Date(Date.parse(capturedOn) - 40 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(capturedOn) - 25 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("keyword_snapshots")
    .select("search_volume, captured_on, keywords!inner(keyword, normalized_keyword)")
    .in("keywords.normalized_keyword", keywords.map(normalizeKeyword))
    .eq("source_type", "OFFICIAL_API")
    .eq("is_excluded", false)
    .not("search_volume", "is", null)
    .gte("captured_on", from)
    .lte("captured_on", to)
    .order("captured_on", { ascending: false });
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = keywords.find((x) => normalizeKeyword(x) === r.keywords?.normalized_keyword);
    if (k && out[k] == null && r.search_volume != null) out[k] = r.search_volume;
  }
  return out;
}

/** 등록된 키워드들의 검색량을 가져와 저장. 키가 없으면 호출하지 않고 오류 */
export async function collectNaverSearchVolumes(keywords: string[]) {
  const config = naverSearchAdConfig();
  if (!config) {
    throw new NaverSearchAdError("네이버 검색광고 API 키가 없습니다 (.env.local 의 NAVER_SEARCHAD_API_KEY · NAVER_SEARCHAD_SECRET_KEY · NAVER_SEARCHAD_CUSTOMER_ID).");
  }
  const capturedAt = new Date().toISOString();
  const capturedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const list: RelKwdStat[] = [];
  for (let i = 0; i < keywords.length; i += MAX_HINT_KEYWORDS) list.push(...(await fetchKeywordTool(config, keywords.slice(i, i + MAX_HINT_KEYWORDS))));
  const { records, issues } = mapKeywordStats(keywords, list, capturedAt, await previousVolumes(keywords, capturedOn));
  if (records.length === 0) return { saved: null, issues };
  const saved = await ingestCollected({ keywords: records, tool: "naver-searchad/keywordstool", idempotencyKey: null }, { channel: "API" });
  return { saved, issues };
}
