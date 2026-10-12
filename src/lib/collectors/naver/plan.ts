/**
 * 네이버 검색광고 검색량 수집 계획 · 결과 정리 (순수 함수, PHASE 14). 서버 서비스(src/lib/ingest/naver-searchad.ts)가 쓴다.
 *
 * 실패 구분 (키워드마다 하나)
 *   NAVER_AUTH          401 · 403 — 키 · 서명 · 고객 ID 문제. 이후 요청을 보내지 않는다
 *   NAVER_RATE_LIMIT    429 또는 응답에 오류 코드 1016 ("너무 많은 접속") — 이후 요청을 보내지 않는다
 *   NAVER_API_ERROR     그 밖의 HTTP 오류 (5xx 등) — 그 묶음(최대 5개)만 실패, 다음 묶음은 계속
 *   NAVER_NETWORK       연결 실패 · 시간 초과
 *   NAVER_NOT_IN_RESPONSE  요청한 키워드가 응답에 없음
 *   NAVER_BELOW_10      PC 또는 모바일이 "<10" — 정확한 값을 모르므로 저장하지 않음 (0 으로 만들지 않는다)
 *   NAVER_UNREADABLE    검색량을 숫자로 읽을 수 없음
 */

import type { CollectedKeyword } from "../types";

import { MAX_HINT_KEYWORDS, matchKey, parseQueryCount, type RelKwdStat } from "./searchad";

export type NaverFailureCode =
  | "NAVER_AUTH"
  | "NAVER_RATE_LIMIT"
  | "NAVER_API_ERROR"
  | "NAVER_NETWORK"
  | "NAVER_NOT_IN_RESPONSE"
  | "NAVER_BELOW_10"
  | "NAVER_UNREADABLE";

export const NAVER_FAILURE_LABELS: Record<NaverFailureCode, string> = {
  NAVER_AUTH: "인증 실패 (API 키 · 비밀키 · 고객 ID 확인)",
  NAVER_RATE_LIMIT: "요청 제한 초과 (잠시 후 다시)",
  NAVER_API_ERROR: "네이버 API 오류",
  NAVER_NETWORK: "연결 실패",
  NAVER_NOT_IN_RESPONSE: "응답에 키워드 없음",
  NAVER_BELOW_10: "검색량 10 미만 (\"<10\" — 정확한 값 모름)",
  NAVER_UNREADABLE: "검색량을 읽을 수 없음",
};

/** 묶음(최대 5개) 요청 실패를 분류. stop = 이후 묶음을 보내지 않아야 하는가 */
export function classifyNaverHttp(status: number, body: string): { code: NaverFailureCode; stop: boolean } {
  if (status === 401 || status === 403) return { code: "NAVER_AUTH", stop: true };
  if (status === 429 || /\b1016\b/.test(body)) return { code: "NAVER_RATE_LIMIT", stop: true };
  return { code: "NAVER_API_ERROR", stop: false };
}

export function chunkKeywords(keywords: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keywords.length; i += MAX_HINT_KEYWORDS) out.push(keywords.slice(i, i + MAX_HINT_KEYWORDS));
  return out;
}

/**
 * 같은 날 중복 수집 방지: 오늘(KST) 이미 공식 API 로 수집한 키워드는 빼고, force(수동 재시도)면 다시 수집한다.
 * 다시 수집해도 같은 (키워드, 날짜, 출처) 스냅샷이 갱신될 뿐 새 행이 생기지 않는다 (기존 UPSERT).
 */
export function keywordsToCollect(keywords: string[], lastCollectedOn: Record<string, string | null | undefined>, today: string, force: boolean) {
  const collect: string[] = [];
  const skippedToday: string[] = [];
  for (const k of keywords) {
    if (!force && lastCollectedOn[k] === today) skippedToday.push(k);
    else collect.push(k);
  }
  return { collect, skippedToday };
}

export type ChunkResult = { keywords: string[]; ok: true; list: RelKwdStat[] } | { keywords: string[]; ok: false; code: NaverFailureCode; message: string };

export interface NaverFailure {
  keyword: string;
  code: NaverFailureCode;
  message: string;
}

/**
 * 묶음 결과 → 저장할 키워드 스냅샷 + 키워드별 실패.
 * previous: 같은 키워드의 이전 공식 API 검색량 (있을 때만 기존 정규화가 증감률 계산)
 */
export function planNaverResults(
  chunks: ChunkResult[],
  capturedAt: string,
  previous: Record<string, number | null | undefined> = {},
): { records: CollectedKeyword[]; failures: NaverFailure[] } {
  const records: CollectedKeyword[] = [];
  const failures: NaverFailure[] = [];
  for (const chunk of chunks) {
    if (!chunk.ok) {
      for (const keyword of chunk.keywords) failures.push({ keyword, code: chunk.code, message: chunk.message });
      continue;
    }
    const byKey = new Map(chunk.list.map((r) => [matchKey(r.relKeyword), r]));
    for (const keyword of chunk.keywords) {
      const r = byKey.get(matchKey(keyword));
      if (!r) {
        failures.push({ keyword, code: "NAVER_NOT_IN_RESPONSE", message: NAVER_FAILURE_LABELS.NAVER_NOT_IN_RESPONSE });
        continue;
      }
      const pc = parseQueryCount(r.monthlyPcQcCnt);
      const mobile = parseQueryCount(r.monthlyMobileQcCnt);
      if (pc.value == null || mobile.value == null) {
        const code = pc.below10 || mobile.below10 ? "NAVER_BELOW_10" : "NAVER_UNREADABLE";
        failures.push({ keyword, code, message: `${NAVER_FAILURE_LABELS[code]} · PC ${r.monthlyPcQcCnt} / 모바일 ${r.monthlyMobileQcCnt}` });
        continue;
      }
      const volume = pc.value + mobile.value;
      const prev = previous[keyword];
      records.push({
        source: "OFFICIAL_API",
        confidence: "A",
        capturedAt,
        tool: "naver-searchad/keywordstool",
        keyword,
        searchVolume: volume,
        searchVolumePrevious: prev != null && prev > 0 ? prev : null,
        // PC · 모바일 · 광고 지표는 컬럼이 없어 수집 기록(payload)에만 — Score V1 입력이 아니다
        observedOnly: {
          pcQueries: pc.value,
          mobileQueries: mobile.value,
          compIdx: r.compIdx ?? null,
          pcClicks: r.monthlyAvePcClkCnt != null ? String(r.monthlyAvePcClkCnt) : null,
          mobileClicks: r.monthlyAveMobileClkCnt != null ? String(r.monthlyAveMobileClkCnt) : null,
          pcCtr: r.monthlyAvePcCtr != null ? String(r.monthlyAvePcCtr) : null,
          mobileCtr: r.monthlyAveMobileCtr != null ? String(r.monthlyAveMobileCtr) : null,
          previousOfficialVolume: prev ?? null,
        },
      });
    }
  }
  return { records, failures };
}
