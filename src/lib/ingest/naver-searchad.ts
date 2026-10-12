import "server-only";

import { hintKeywordsParam, KEYWORDSTOOL_URI, NAVER_SEARCHAD_BASE_URL, type RelKwdStat } from "@/lib/collectors/naver/searchad";
import {
  chunkKeywords,
  classifyNaverHttp,
  keywordsToCollect,
  NAVER_FAILURE_LABELS,
  planNaverResults,
  type ChunkResult,
  type NaverFailure,
} from "@/lib/collectors/naver/plan";
import { naverSignature } from "@/lib/collectors/naver/signature";
import { normalizeKeyword } from "@/lib/keywords";
import { ingestBatch, type JobRow } from "@/lib/repositories/ingest";
import { createClient } from "@/lib/supabase/server";

import type { BatchRow } from "./batch-rows";
import { jobOutcome, type JobOutcome } from "./outcome";
import { collectedToRows } from "./service";

/*
 * 네이버 검색광고 API → 키워드 검색량 (PHASE 13 경계 → PHASE 14 완성)
 *
 *   키: NAVER_SEARCHAD_API_KEY · NAVER_SEARCHAD_SECRET_KEY · NAVER_SEARCHAD_CUSTOMER_ID (.env.local, 서버 전용 — 코드 · 브라우저 · 확장 프로그램에 없음)
 *   흐름: 사용자가 고른 등록 키워드 → 오늘 이미 수집한 키워드 제외(수동 재시도면 포함) → 5개씩 GET /keywordstool
 *         → planNaverResults (성공 = OFFICIAL_API · A 스냅샷, 실패 = 키워드별 사유) → ingest_batch 한 번 (실패도 import_rows 에 기록)
 *   중복: 같은 (키워드, 날짜, OFFICIAL_API) 는 기존 UPSERT — 다시 수집해도 행이 늘지 않는다
 *   증감률: 이전 공식 API 검색량(25~40일 전)이 있을 때만 search_volume_previous → 기존 정규화 공식
 *   예약 실행(스케줄러)은 없다. 나중에 붙일 때 이 함수(collectNaverSearchVolumes)를 부르면 된다 — 단 지금은 로그인 세션(RLS)이 필요하다
 */

export interface NaverSearchAdConfig {
  apiKey: string;
  secretKey: string;
  customerId: string;
  baseUrl: string;
}

export function naverSearchAdConfig(): NaverSearchAdConfig | null {
  const apiKey = process.env.NAVER_SEARCHAD_API_KEY;
  const secretKey = process.env.NAVER_SEARCHAD_SECRET_KEY;
  const customerId = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
  if (!apiKey || !secretKey || !customerId) return null;
  // 개발 중 모의 서버 시험용 주소 바꾸기 — 배포(production)에서는 항상 공식 주소
  const override = process.env.NODE_ENV !== "production" ? process.env.NAVER_SEARCHAD_BASE_URL_DEV : undefined;
  return { apiKey, secretKey, customerId, baseUrl: override || NAVER_SEARCHAD_BASE_URL };
}

export const isNaverMockBaseUrl = (c: NaverSearchAdConfig | null) => !!c && c.baseUrl !== NAVER_SEARCHAD_BASE_URL;

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

async function fetchChunk(config: NaverSearchAdConfig, keywords: string[]): Promise<ChunkResult> {
  const timestamp = String(Date.now());
  const query = new URLSearchParams({ hintKeywords: hintKeywordsParam(keywords), showDetail: "1" });
  let res: Response;
  try {
    // 서명 대상은 쿼리를 뺀 경로 (공식 샘플: uri = '/keywordstool')
    res = await fetch(`${config.baseUrl}${KEYWORDSTOOL_URI}?${query}`, {
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": config.apiKey,
        "X-Customer": config.customerId,
        "X-Signature": naverSignature(config.secretKey, timestamp, "GET", KEYWORDSTOOL_URI),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { keywords, ok: false, code: "NAVER_NETWORK", message: `${NAVER_FAILURE_LABELS.NAVER_NETWORK}: ${(error as Error).message}`.slice(0, 300) };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const { code } = classifyNaverHttp(res.status, body);
    return { keywords, ok: false, code, message: `${NAVER_FAILURE_LABELS[code]} (HTTP ${res.status})` };
  }
  const json = (await res.json().catch(() => null)) as { keywordList?: RelKwdStat[] } | null;
  if (!json || !Array.isArray(json.keywordList)) return { keywords, ok: false, code: "NAVER_API_ERROR", message: "응답 형식이 명세와 다릅니다 (keywordList 없음)" };
  return { keywords, ok: true, list: json.keywordList };
}

/** 키워드별 가장 최근 공식 API 수집일 · 25~40일 전 검색량 */
async function officialHistory(keywords: string[], today: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("keyword_snapshots")
    .select("search_volume, captured_on, keywords!inner(normalized_keyword)")
    .in("keywords.normalized_keyword", keywords.map(normalizeKeyword))
    .eq("source_type", "OFFICIAL_API")
    .eq("is_excluded", false)
    .order("captured_on", { ascending: false })
    .limit(2000);
  const day = (offset: number) => new Date(Date.parse(today) - offset * 86_400_000).toISOString().slice(0, 10);
  const [from, to] = [day(40), day(25)];
  const last: Record<string, string> = {};
  const previous: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = keywords.find((x) => normalizeKeyword(x) === r.keywords?.normalized_keyword);
    if (!k) continue;
    last[k] ??= r.captured_on;
    if (previous[k] == null && r.search_volume != null && r.captured_on >= from && r.captured_on <= to) previous[k] = r.search_volume;
  }
  return { last, previous };
}

export type NaverCollectResult =
  | { status: "NOT_CONFIGURED" }
  | {
      status: "DONE";
      mock: boolean;
      requested: string[];
      skippedToday: string[];
      saved: number;
      failures: NaverFailure[];
      job: JobRow | null;
      outcome: JobOutcome | null;
      systemError: string | null;
    };

/**
 * 고른 등록 키워드들의 네이버 검색량 수집 · 저장. 키가 없으면 호출하지 않는다 (가짜 결과 없음).
 * force = 오늘 이미 수집한 키워드도 다시 (수동 재시도)
 */
export async function collectNaverSearchVolumes(keywords: string[], { force = false }: { force?: boolean } = {}): Promise<NaverCollectResult> {
  const config = naverSearchAdConfig();
  if (!config) return { status: "NOT_CONFIGURED" };
  const requested = [...new Set(keywords.map((k) => k.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const today = kstToday();
  const { last, previous } = await officialHistory(requested, today);
  const { collect, skippedToday } = keywordsToCollect(requested, last, today, force);
  const base = { status: "DONE" as const, mock: isNaverMockBaseUrl(config), requested, skippedToday };
  if (collect.length === 0) return { ...base, saved: 0, failures: [], job: null, outcome: null, systemError: null };

  const chunks: ChunkResult[] = [];
  let stopped: ChunkResult | null = null;
  for (const group of chunkKeywords(collect)) {
    if (stopped && !stopped.ok) {
      // 인증 실패 · 요청 제한이면 남은 묶음은 보내지 않고 같은 사유로 기록
      chunks.push({ keywords: group, ok: false, code: stopped.code, message: `${stopped.message} — 요청하지 않음` });
      continue;
    }
    const r = await fetchChunk(config, group);
    chunks.push(r);
    if (!r.ok && (r.code === "NAVER_AUTH" || r.code === "NAVER_RATE_LIMIT")) stopped = r;
  }

  const capturedAt = new Date().toISOString();
  const { records, failures } = planNaverResults(chunks, capturedAt, previous);
  const { rows } = collectedToRows({ keywords: records });
  // 실패 키워드도 import_rows 에 남긴다 (사유 코드 그대로) — 일부 실패가 전체 성공으로 보이지 않도록
  failures.forEach((f) =>
    rows.push({
      row_number: 0, // 아래에서 다시 번호를 매긴다
      record_key: `keyword_snapshot:${normalizeKeyword(f.keyword)}:${today}:OFFICIAL_API`,
      kind: "KEYWORD_SNAPSHOT",
      status: "FAILED",
      error_code: f.code,
      error_message: f.message.slice(0, 1000),
      payload: { naver: { keyword: f.keyword, code: f.code } },
      data: {},
    } satisfies BatchRow),
  );
  rows.forEach((r, i) => (r.row_number = i + 1));

  const outcome = await ingestBatch(
    {
      channel: "API",
      import_type: "KEYWORD_METRICS",
      source_type: "OFFICIAL_API",
      source_tool: "naver-searchad/keywordstool",
      idempotency_key: null,
      schema_version: "naver-v1",
      column_mapping: { naver: { requested: requested.length, collected: collect.length, skippedToday, force, mock: isNaverMockBaseUrl(config) } },
    },
    rows,
  );
  if (!outcome.ok) {
    return { ...base, saved: 0, failures, job: outcome.failedJob, outcome: "FAILED", systemError: outcome.error };
  }
  return {
    ...base,
    saved: outcome.job.inserted_rows + outcome.job.updated_rows + outcome.job.skipped_rows,
    failures,
    job: outcome.job,
    outcome: jobOutcome(outcome.job),
    systemError: null,
  };
}
