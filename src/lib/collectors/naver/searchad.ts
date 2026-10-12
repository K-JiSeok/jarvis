/**
 * 네이버 검색광고 API — 키워드 도구(RelKwdStat) 응답 → CollectedKeyword (순수 함수, PHASE 13).
 *
 * 공식 명세에서 확인한 것 (github.com/naver/searchad-apidoc, gh-pages/assets/json/ncc-keywordstool.json · python-sample)
 *   GET https://api.searchad.naver.com/keywordstool?hintKeywords=a,b&showDetail=1   (hintKeywords 최대 5개, 쉼표 구분)
 *   응답 keywordList[]: relKeyword · monthlyPcQcCnt · monthlyMobileQcCnt (최근 30일 PC/모바일 조회수 합, 10 미만이면 "<10")
 *                       monthlyAvePcClkCnt · monthlyAveMobileClkCnt · monthlyAvePcCtr · monthlyAveMobileCtr · plAvgDepth · compIdx(low/mid/high)
 *   인증 헤더: X-Timestamp(ms) · X-API-KEY · X-Customer · X-Signature = Base64(HMAC-SHA256(secret, "{timestamp}.{METHOD}.{uri}"))
 *   요청 제한: 숫자로 공개된 한도 없음. 초과하면 오류 코드 1016 "너무 많은 접속을 시도 하였습니다"
 *
 * JARVIS 매핑
 *   search_volume = PC + 모바일 (최근 30일). 어느 쪽이든 "<10" 이면 정확한 값을 모르므로 NULL (0 으로 만들지 않는다)
 *   source = OFFICIAL_API · confidence = A (공식 API 의 값 그대로). 단 "네이버 검색" 수요이지 쿠팡 검색 수요가 아니다 (보고서에 명시)
 *   이전 달 값은 응답에 없다 → 검색량 증감률은 이전에 저장한 같은 출처 스냅샷을 search_volume_previous 로 넘길 때만 (기존 정규화 공식)
 *   클릭 수 · CTR · compIdx 는 대응 컬럼이 없어 payload 에만 남긴다
 */

import type { CollectedKeyword, NormalizeIssue } from "../types";

export const NAVER_SEARCHAD_BASE_URL = "https://api.searchad.naver.com";
export const KEYWORDSTOOL_URI = "/keywordstool";
export const MAX_HINT_KEYWORDS = 5;

export interface RelKwdStat {
  relKeyword: string;
  monthlyPcQcCnt: string | number;
  monthlyMobileQcCnt: string | number;
  monthlyAvePcClkCnt?: string | number;
  monthlyAveMobileClkCnt?: string | number;
  monthlyAvePcCtr?: string | number;
  monthlyAveMobileCtr?: string | number;
  plAvgDepth?: string | number;
  compIdx?: string;
}

/** "1,234" · 1234 → 1234, "<10" · "< 10" → below10 (값 모름) */
export function parseQueryCount(v: string | number | null | undefined): { value: number | null; below10: boolean } {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? { value: v, below10: false } : { value: null, below10: false };
  const s = String(v ?? "").replace(/\s/g, "");
  if (/^<10$/.test(s)) return { value: null, below10: true };
  const n = Number(s.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 ? { value: n, below10: false } : { value: null, below10: false };
}

/** 응답 키워드와 요청 키워드 비교: 네이버는 공백을 없애고 영문을 대문자로 돌려준다 → 공백 제거 · 소문자로 비교 */
export const matchKey = (k: string) => k.replace(/\s+/g, "").toLowerCase();

/** 서명 문자열 (공식 샘플과 같은 형식) */
export const signatureMessage = (timestamp: string, method: string, uri: string) => `${timestamp}.${method.toUpperCase()}.${uri}`;

/** hintKeywords 값 (최대 5개). 공백은 빼서 보낸다 — 응답도 공백 없는 형태로 온다 */
export function hintKeywordsParam(keywords: string[]): string {
  if (keywords.length === 0 || keywords.length > MAX_HINT_KEYWORDS) throw new Error(`hintKeywords 는 1~${MAX_HINT_KEYWORDS}개입니다.`);
  return keywords.map((k) => k.replace(/\s+/g, "")).join(",");
}

/**
 * 요청한 키워드마다 응답에서 같은 키워드를 찾아 CollectedKeyword 로. 연관 키워드(요청하지 않은 것)는 버린다.
 * previous: 같은 키워드의 이전 검색량 (같은 출처로 저장된 값, 25~40일 전) — 있으면 기존 정규화가 증감률을 계산한다.
 */
export function mapKeywordStats(
  keywords: string[],
  list: RelKwdStat[],
  capturedAt: string,
  previous: Record<string, number | null | undefined> = {},
): { records: CollectedKeyword[]; issues: NormalizeIssue[]; raw: Record<string, RelKwdStat | null> } {
  const byKey = new Map(list.map((r) => [matchKey(r.relKeyword), r]));
  const records: CollectedKeyword[] = [];
  const issues: NormalizeIssue[] = [];
  const raw: Record<string, RelKwdStat | null> = {};
  for (const keyword of keywords) {
    const r = byKey.get(matchKey(keyword)) ?? null;
    raw[keyword] = r;
    if (!r) {
      issues.push({ field: keyword, message: "네이버 응답에 이 키워드가 없습니다 (저장하지 않음)" });
      continue;
    }
    const pc = parseQueryCount(r.monthlyPcQcCnt);
    const mobile = parseQueryCount(r.monthlyMobileQcCnt);
    const volume = pc.value != null && mobile.value != null ? pc.value + mobile.value : null;
    if (volume == null) {
      issues.push({ field: keyword, message: pc.below10 || mobile.below10 ? "검색량이 10 미만(\"<10\")이라 정확한 값을 모릅니다 (비워 둠)" : "검색량을 읽을 수 없습니다" });
    }
    const prev = previous[keyword];
    records.push({
      source: "OFFICIAL_API",
      confidence: "A",
      capturedAt,
      tool: "naver-searchad/keywordstool",
      keyword,
      searchVolume: volume,
      searchVolumePrevious: volume != null && prev != null && prev > 0 ? prev : null,
    });
  }
  return { records, issues, raw };
}
