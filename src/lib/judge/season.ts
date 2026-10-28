/**
 * 계절성 판단 (PHASE 28 · season-v1) — 순수 함수.
 *
 * 문제 (10-28 실제 데이터): 방풍비닐 월 검색량이 15일 만에 13,150 → 26,960 으로 두 배가 됐다.
 *   성수기 검색량을 그대로 믿으면 수요 점수가 부풀고, 수입 상품은 입고될 때 시즌이 끝나 있을 수 있다.
 *
 * 두 가지로 본다
 *   1. 시즌 단어 사전: 키워드 · 상품명에 시즌 단어가 있으면 그 시즌의 달을 안다
 *   2. 검색량 급증: 우리가 모은 네이버 검색량 기록에서 60일 안 최저값보다 50% 넘게 올랐는가
 *
 * 1년치 추세(네이버 데이터랩)는 키가 없어 쓰지 않는다. 사전에 없는 시즌은 급증으로만 잡힌다.
 */

import { JUDGE_ASSUMPTIONS } from "../../config/judge-assumptions";

export const SEASON_VERSION = "season-v1";

export interface SeasonGroup {
  id: string;
  label: string;
  /** 성수기 달 (1~12, 이어진 달) */
  months: number[];
  terms: string[];
}

export const SEASON_GROUPS: SeasonGroup[] = [
  { id: "winter-draft", label: "겨울 외풍 · 단열", months: [10, 11, 12, 1], terms: ["방풍", "외풍", "문풍지", "뽁뽁이", "단열시트", "단열재", "창문단열", "풍지판", "웃풍"] },
  { id: "winter-heat", label: "겨울 난방 · 방한", months: [11, 12, 1, 2], terms: ["핫팩", "손난로", "발난로", "전기요", "전기장판", "온수매트", "난로", "히터", "방한", "넥워머", "귀마개", "털장갑", "수면양말"] },
  { id: "summer-cool", label: "여름 냉방 · 물놀이", months: [5, 6, 7, 8], terms: ["선풍기", "써큘레이터", "손풍기", "넥쿨러", "냉풍기", "쿨매트", "냉감", "쿨토시", "아이스팩", "모기장", "모기퇴치", "물놀이", "래쉬가드", "수영복", "튜브", "워터슈즈"] },
  { id: "rainy", label: "장마", months: [6, 7, 8], terms: ["장마", "레인부츠", "장화", "우비", "레인코트"] },
  { id: "christmas", label: "크리스마스", months: [11, 12], terms: ["크리스마스", "성탄", "산타", "루돌프", "트리장식", "크리스마스트리"] },
  { id: "halloween", label: "할로윈", months: [10], terms: ["할로윈", "핼러윈"] },
  { id: "valentine", label: "발렌타인 · 화이트데이", months: [2, 3], terms: ["발렌타인", "밸런타인", "화이트데이"] },
  { id: "family-month", label: "가정의 달", months: [4, 5], terms: ["어버이날", "카네이션", "스승의날", "어린이날"] },
  { id: "graduation", label: "졸업 · 입학", months: [1, 2, 3], terms: ["졸업", "입학"] },
];

export interface VolumePoint {
  on: string;
  value: number;
}

export interface VolumeSpike {
  base: number;
  baseOn: string;
  latest: number;
  latestOn: string;
  ratio: number;
}

export interface SeasonResult {
  group: SeasonGroup | null;
  /** 사전에서 찾은 단어 */
  term: string | null;
  spike: VolumeSpike | null;
  /** 입고 예정일 (asOf + 입고 기간) */
  arrivalOn: string | null;
  /** 입고 뒤 남은 성수기 일수 (사전 시즌일 때만, 입고 시점이 비시즌이면 0) */
  sellDaysAfterArrival: number | null;
  /** 다음 성수기 시작 달 (입고 시점이 비시즌일 때) */
  nextSeasonMonth: number | null;
}

const DAY = 86_400_000;
const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function seasonGroupOf(text: string): { group: SeasonGroup; term: string } | null {
  const t = key(text);
  for (const g of SEASON_GROUPS) {
    const term = g.terms.find((x) => t.includes(key(x)));
    if (term) return { group: g, term };
  }
  return null;
}

/** 가장 최근 값이 그 전 60일 안의 최저값보다 기준(50%) 넘게 높은가. 7일 넘게 떨어진 기록이 있어야 본다 */
export function volumeSpike(history: VolumePoint[], ratio = JUDGE_ASSUMPTIONS.volumeSpikeRatio.value): VolumeSpike | null {
  const h = history.filter((p) => p.value > 0).sort((a, b) => a.on.localeCompare(b.on));
  if (h.length < 2) return null;
  const latest = h[h.length - 1];
  const t = Date.parse(latest.on);
  const prior = h.filter((p) => t - Date.parse(p.on) >= 7 * DAY && t - Date.parse(p.on) <= 60 * DAY);
  if (!prior.length) return null;
  const base = prior.reduce((m, p) => (p.value < m.value ? p : m));
  const r = latest.value / base.value - 1;
  return r >= ratio ? { base: base.value, baseOn: base.on, latest: latest.value, latestOn: latest.on, ratio: Math.round(r * 1000) / 1000 } : null;
}

/** 입고일이 성수기 안이면 그 성수기 끝(마지막 달 말일)까지 남은 일수 */
function sellDays(arrivalMs: number, months: number[]): { days: number; next: number | null } {
  const d = new Date(arrivalMs);
  const m = d.getUTCMonth() + 1;
  if (!months.includes(m)) {
    // 다음 성수기 시작 달: 앞 달이 성수기가 아닌 첫 달
    const starts = months.filter((x) => !months.includes(((x + 10) % 12) + 1));
    const ahead = starts.map((s) => ({ s, gap: (s - m + 12) % 12 })).sort((a, b) => a.gap - b.gap);
    const next = ahead[0]?.s ?? months[0];
    // 시즌 시작 30일 안에 입고되면 시즌 전체를 팔 수 있다 (미리 준비한 경우)
    const startMs = Date.UTC(d.getUTCFullYear() + (next < m ? 1 : 0), next - 1, 1);
    if (startMs - arrivalMs <= 30 * DAY) return { days: sellDays(startMs, months).days, next: null };
    return { days: 0, next };
  }
  let y = d.getUTCFullYear();
  let cur = m;
  while (months.includes((cur % 12) + 1) && (cur % 12) + 1 !== m) {
    cur += 1;
    if (cur > 12) {
      cur = 1;
      y += 1;
    }
  }
  const end = Date.UTC(y, cur, 1); // cur 달 말일 다음날 (월은 0부터라 cur 가 곧 다음 달)
  return { days: Math.round((end - arrivalMs) / DAY), next: null };
}

export function seasonOf(i: { asOf: string; keyword: string | null; productName: string | null; history: VolumePoint[] | null }): SeasonResult | null {
  const hit = seasonGroupOf(`${i.keyword ?? ""} ${i.productName ?? ""}`);
  const spike = i.history ? volumeSpike(i.history) : null;
  if (!hit && !spike) return null;
  const arrivalMs = Date.parse(i.asOf) + JUDGE_ASSUMPTIONS.importLeadDays.value * DAY;
  const s = hit ? sellDays(arrivalMs, hit.group.months) : null;
  return {
    group: hit?.group ?? null,
    term: hit?.term ?? null,
    spike,
    arrivalOn: iso(arrivalMs),
    sellDaysAfterArrival: s?.days ?? null,
    nextSeasonMonth: s?.next ?? null,
  };
}
