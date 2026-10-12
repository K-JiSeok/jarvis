/**
 * 자동 키워드 발굴 (순수 함수, PHASE 17).
 *
 * 출처: 네이버 검색광고 키워드 도구(공식 API) — 시드 키워드 1개를 hintKeywords 로 보내면 응답 keywordList 에 연관 키워드가 함께 온다.
 *   지금까지(PHASE 13~16)는 요청한 키워드만 쓰고 연관 키워드는 버렸다 → 이제 후보(keyword_candidates)로 남긴다.
 * 후보는 "네이버에서 함께 검색되는 표현"일 뿐이다. 후보가 생겼다고 쿠팡 수요가 있다고 보지 않는다 (등록 · 수집은 별도).
 *
 * 정리 규칙 (점수 · 임계값 아님 — 중복과 의미 없는 문자열만 뺀다)
 *   - 시드 · 이미 등록한 키워드와 같은 표현 (공백 · 대소문자 무시)
 *   - 같은 응답 안의 중복
 *   - 1글자 · 숫자/기호만
 *   검색량 "<10" 은 버리지 않는다 — 값을 모른다는 상태(below_10, 검색량 NULL)로 남긴다
 */

import { matchKey, parseQueryCount, type RelKwdStat } from "../collectors/naver/searchad";

export interface KeywordCandidateDraft {
  keyword: string;
  /** 비교 키 (공백 제거 · 소문자) — 네이버는 공백 없는 형태로 돌려준다 */
  normalized: string;
  seed: string;
  monthlyPc: number | null;
  monthlyMobile: number | null;
  /** PC + 모바일. 어느 쪽이든 "<10" 이면 NULL */
  searchVolume: number | null;
  below10: boolean;
  compIdx: string | null;
}

export type DropReason = "SAME_AS_SEED_OR_REGISTERED" | "DUPLICATE" | "MEANINGLESS";

export const DROP_LABELS: Record<DropReason, string> = {
  SAME_AS_SEED_OR_REGISTERED: "시드 · 등록 키워드와 같음",
  DUPLICATE: "응답 안 중복",
  MEANINGLESS: "1글자 · 숫자/기호만",
};

export function candidatesFromRelated(
  seed: string,
  list: RelKwdStat[],
  known: Iterable<string>,
): { candidates: KeywordCandidateDraft[]; dropped: Record<DropReason, number> } {
  const knownKeys = new Set([...known, seed].map(matchKey));
  const seen = new Set<string>();
  const dropped: Record<DropReason, number> = { SAME_AS_SEED_OR_REGISTERED: 0, DUPLICATE: 0, MEANINGLESS: 0 };
  const candidates: KeywordCandidateDraft[] = [];
  for (const r of list) {
    const keyword = String(r.relKeyword ?? "").trim();
    const key = matchKey(keyword);
    if (key.length < 2 || !/[\p{L}]/u.test(key)) {
      dropped.MEANINGLESS += 1;
      continue;
    }
    if (knownKeys.has(key)) {
      dropped.SAME_AS_SEED_OR_REGISTERED += 1;
      continue;
    }
    if (seen.has(key)) {
      dropped.DUPLICATE += 1;
      continue;
    }
    seen.add(key);
    const pc = parseQueryCount(r.monthlyPcQcCnt);
    const mobile = parseQueryCount(r.monthlyMobileQcCnt);
    const below10 = pc.below10 || mobile.below10;
    candidates.push({
      keyword: keyword.slice(0, 100),
      normalized: key,
      seed,
      monthlyPc: pc.value,
      monthlyMobile: mobile.value,
      searchVolume: !below10 && pc.value != null && mobile.value != null ? pc.value + mobile.value : null,
      below10,
      compIdx: typeof r.compIdx === "string" ? r.compIdx : null,
    });
  }
  return { candidates, dropped };
}
