/**
 * 검색 결과 자동 수집 (PHASE 27) — 규칙만 담은 순수 함수. chrome API 를 쓰지 않는다 (테스트에서 직접 실행).
 *
 * 무엇을: 사용자가 JARVIS 에서 "추적"으로 둔 키워드의 쿠팡 검색 결과 1페이지를 정해진 주기에 수집한다.
 *   사용자가 [현재 검색 결과 수집]을 누르는 것과 같은 일을 확장 프로그램이 대신한다.
 *   1~2주 간격으로 모은 리뷰 수 증가가 판매량 추정의 주 근거가 된다 (상품 페이지는 열지 않는다).
 *
 * 사람이 검색하는 속도를 넘지 않도록 막는 규칙 (사용자 승인 2026-10-28, 쿠팡 이용약관상 자동 접근 위험을 알고 선택):
 *   - 검색 결과 1페이지만 연다. 상품 페이지 · 다음 페이지 · 그 밖의 쿠팡 주소는 열지 않는다
 *   - 한 번에 1개 탭, 키워드 사이 30초~2분 무작위 간격
 *   - 한 번 실행에 키워드 최대 20개, 같은 키워드는 6일 안에 다시 수집하지 않는다
 *   - 사용자가 팝업에서 끌 수 있다
 */

export const AUTO_COLLECT_RULES = {
  /** 마지막 실행 완료 뒤 이 시간이 지나야 다음 예약 실행 */
  intervalDays: 7,
  /** 이 시각(KST) 이후에만 예약 실행을 시작한다 */
  startHourKst: 9,
  /** 키워드 하나를 최근 이 일수 안에 수집했으면 이번에는 건너뛴다 */
  skipIfCollectedWithinDays: 6,
  maxKeywords: 20,
  /** 키워드 사이 간격 (분) — chrome.alarms 최소 단위가 30초 */
  minDelayMinutes: 0.5,
  maxDelayMinutes: 2,
  /** 탭 하나를 기다리는 최대 시간 */
  tabTimeoutMs: 60_000,
} as const;

export interface TrackedKeyword {
  keyword: string;
  /** 마지막 검색 결과 수집일 (KST YYYY-MM-DD), 없으면 null */
  lastCollectedOn: string | null;
}

export interface AutoResult {
  keyword: string;
  ok: boolean;
  message: string;
  at: string;
}

export interface AutoRunState {
  startedAt: string;
  trigger: "SCHEDULE" | "MANUAL";
  queue: string[];
  results: AutoResult[];
}

export interface AutoSummary {
  startedAt: string;
  finishedAt: string;
  trigger: AutoRunState["trigger"];
  total: number;
  ok: number;
  failed: number;
  results: AutoResult[];
}

const DAY = 86_400_000;

/** KST 날짜 · 시 */
export function kst(nowMs: number): { date: string; hour: number } {
  const d = new Date(nowMs + 9 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/** 예약 실행을 시작할 때인가 (켜져 있고 · 실행 중이 아니고 · 9시 이후 · 마지막 완료 뒤 7일) */
export function isDue(nowMs: number, opts: { enabled: boolean; running: boolean; lastFinishedAt: string | null }): boolean {
  if (!opts.enabled || opts.running) return false;
  if (kst(nowMs).hour < AUTO_COLLECT_RULES.startHourKst) return false;
  if (!opts.lastFinishedAt) return true;
  return nowMs - Date.parse(opts.lastFinishedAt) >= AUTO_COLLECT_RULES.intervalDays * DAY;
}

/** 이번에 수집할 키워드: 최근 6일 안에 수집한 것은 빼고, 오래된 것부터 최대 20개 */
export function pickKeywords(list: TrackedKeyword[], nowMs: number, force = false): string[] {
  const today = kst(nowMs).date;
  const age = (k: TrackedKeyword) => (k.lastCollectedOn ? Math.round((Date.parse(today) - Date.parse(k.lastCollectedOn)) / DAY) : Infinity);
  const seen = new Set<string>();
  return list
    .filter((k) => k.keyword.trim() && (force || age(k) >= AUTO_COLLECT_RULES.skipIfCollectedWithinDays))
    .sort((a, b) => age(b) - age(a))
    .map((k) => k.keyword.trim())
    .filter((k) => (seen.has(k) ? false : (seen.add(k), true)))
    .slice(0, AUTO_COLLECT_RULES.maxKeywords);
}

/** 다음 키워드까지 기다릴 시간 (분). rand 는 0~1 */
export function nextDelayMinutes(rand: number): number {
  const { minDelayMinutes: lo, maxDelayMinutes: hi } = AUTO_COLLECT_RULES;
  const r = Math.min(1, Math.max(0, rand));
  return Math.round((lo + (hi - lo) * r) * 100) / 100;
}

/** 자동 수집이 여는 유일한 주소: 쿠팡 검색 결과 1페이지 */
export function searchUrl(keyword: string): string {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword.trim())}&page=1`;
}

/** 자동 수집 탭이 열어도 되는 주소인가 (검색 결과 1페이지만) */
export function isAllowedAutoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === "https://www.coupang.com" && u.pathname === "/np/search" && !!u.searchParams.get("q") && (u.searchParams.get("page") ?? "1") === "1";
  } catch {
    return false;
  }
}

export function summarize(state: AutoRunState, finishedAt: string): AutoSummary {
  const ok = state.results.filter((r) => r.ok).length;
  return { startedAt: state.startedAt, finishedAt, trigger: state.trigger, total: state.results.length, ok, failed: state.results.length - ok, results: state.results };
}
