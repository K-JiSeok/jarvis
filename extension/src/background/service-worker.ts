/**
 * 배경 서비스 워커: 로그인 · 전송 · 마지막 결과 저장.
 * 콘텐츠 스크립트와 팝업은 서버에 직접 요청하지 않고 이곳에 메시지를 보낸다 (토큰은 이곳에서만 쓴다).
 * 사용자 화면에서는 다른 탭 이동 · 다음 페이지 · 자동 수집을 하지 않는다 — 사용자가 누른 버튼 1번 = 전송 1번.
 *
 * 예약 자동 발굴 (PHASE 17): chrome.alarms 가 1시간마다 깨어나 JARVIS 서버의 /api/automation/run 만 부른다.
 *   쿠팡 탭을 열거나 쿠팡에 요청하지 않는다. 서버는 마지막 실행 뒤 20시간 안이면 건너뛰므로 실제 실행은 하루 1회.
 *   Chrome 이 켜져 있고 · 확장 프로그램에 로그인돼 있고 · JARVIS 서버가 켜져 있을 때만 실행된다.
 *
 * 검색 결과 자동 수집 (PHASE 27, 사용자 승인 2026-10-28): 유일하게 쿠팡 탭을 여는 기능.
 *   1시간마다 확인 → 마지막 완료 뒤 7일 · 9시(KST) 이후면 추적 키워드의 쿠팡 검색 결과 1페이지를 뒤쪽 탭으로 하나씩 열어
 *   [현재 검색 결과 수집]과 같은 흐름을 실행하고 탭을 닫는다. 키워드 사이 30초~2분 무작위 간격, 최대 20개.
 *   여는 주소는 searchUrl() 하나뿐이고 isAllowedAutoUrl() 로 다시 확인한다. 상품 페이지 · 다음 페이지는 열지 않는다.
 *   진행 상태는 chrome.storage 에 두고 키워드 1개 = 알람 1번으로 처리한다 (서비스 워커가 잠들어도 이어서).
 */

import { login, logout, lookup, registerSelected, runAutomation, sendRaw, sendRecords, sendSupply, trackedKeywords, validSession } from "../shared/api";
import { AUTO_COLLECT_RULES, isAllowedAutoUrl, isDue, nextDelayMinutes, pickKeywords, searchUrl, summarize, type AutoResult } from "../shared/auto-collect";
import { JARVIS_API_BASE, JARVIS_DEV } from "../shared/constants";
import {
  getAutoCollectEnabled,
  getAutoRun,
  getAutoSummary,
  getLastAuto,
  getLastRun,
  getSupplyTarget,
  setAutoCollectEnabled,
  setAutoRun,
  setAutoSummary,
  setLastAuto,
  setLastRun,
  setSupplyTarget,
} from "../shared/storage";
import type { LastRun, Message } from "../shared/types";

const AUTO_ALARM = "jarvis-auto-discovery";
const COLLECT_CHECK = "jarvis-auto-collect-check";
const COLLECT_STEP = "jarvis-auto-collect-step";
/** 이보다 오래된 진행 상태는 멈춘 것으로 본다 (Chrome 이 실행 중에 꺼진 경우) */
const STALE_RUN_MS = 6 * 3_600_000;

async function ensureAlarm() {
  if (!(await chrome.alarms.get(AUTO_ALARM))) await chrome.alarms.create(AUTO_ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
  if (!(await chrome.alarms.get(COLLECT_CHECK))) await chrome.alarms.create(COLLECT_CHECK, { delayInMinutes: 2, periodInMinutes: 60 });
  // 실행 중에 Chrome 이 꺼졌다 켜졌으면 다음 키워드부터 이어서
  if ((await getAutoRun()) && !(await chrome.alarms.get(COLLECT_STEP))) await chrome.alarms.create(COLLECT_STEP, { delayInMinutes: 1 });
}

// 검색 결과 자동 수집 (PHASE 27) ---------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runningState() {
  const run = await getAutoRun();
  if (run && Date.now() - Date.parse(run.startedAt) > STALE_RUN_MS) {
    await setAutoSummary(summarize({ ...run, results: [...run.results, ...run.queue.map((keyword) => ({ keyword, ok: false, message: "중단됨 (Chrome 종료 등)", at: new Date().toISOString() }))] }, new Date().toISOString()));
    await setAutoRun(null);
    return null;
  }
  return run;
}

async function startAutoCollect(trigger: "SCHEDULE" | "MANUAL"): Promise<{ ok: boolean; message: string }> {
  if (await runningState()) return { ok: false, message: "이미 실행 중입니다." };
  if (!(await validSession())) return { ok: false, message: "확장 프로그램에 로그인하지 않았습니다." };
  const r = await trackedKeywords();
  if (!r.ok) return { ok: false, message: r.error ?? "키워드 목록을 받지 못했습니다." };
  const now = new Date().toISOString();
  const queue = pickKeywords(r.keywords ?? [], Date.now());
  if (queue.length === 0) {
    const message = (r.keywords ?? []).length === 0 ? "추적 중인 키워드가 없습니다 (JARVIS 키워드 화면에서 추적 켜기)." : `모든 추적 키워드를 최근 ${AUTO_COLLECT_RULES.skipIfCollectedWithinDays}일 안에 수집했습니다.`;
    if (trigger === "SCHEDULE") await setAutoSummary({ startedAt: now, finishedAt: now, trigger, total: 0, ok: 0, failed: 0, results: [] });
    return { ok: true, message };
  }
  await setAutoRun({ startedAt: now, trigger, queue, results: [] });
  await chrome.alarms.create(COLLECT_STEP, { delayInMinutes: AUTO_COLLECT_RULES.minDelayMinutes });
  return { ok: true, message: `키워드 ${queue.length}개 수집을 시작합니다 (키워드 사이 30초~2분).` };
}

/** 탭이 다 뜰 때까지 (최대 tabTimeoutMs) */
async function waitComplete(tabId: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") return true;
    await sleep(1000);
  }
  return false;
}

/** 키워드 1개: 검색 결과 1페이지를 뒤쪽 탭으로 열고 → 수집 요청 → 탭 닫기 */
async function collectKeyword(keyword: string): Promise<AutoResult> {
  const at = () => new Date().toISOString();
  const url = searchUrl(keyword);
  if (!isAllowedAutoUrl(url)) return { keyword, ok: false, message: "허용되지 않은 주소", at: at() };
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId == null) return { keyword, ok: false, message: "탭을 열지 못했습니다.", at: at() };
    const deadline = Date.now() + AUTO_COLLECT_RULES.tabTimeoutMs;
    if (!(await waitComplete(tabId, deadline))) return { keyword, ok: false, message: "검색 화면이 시간 안에 뜨지 않았습니다.", at: at() };
    const opened = await chrome.tabs.get(tabId);
    if (!opened.url || !isAllowedAutoUrl(opened.url)) return { keyword, ok: false, message: `검색 화면이 아닌 곳으로 이동됨 (${opened.url ?? "?"})`, at: at() };
    // 콘텐츠 스크립트가 준비될 때까지 몇 번 다시 묻는다
    for (let i = 0; i < 10; i += 1) {
      try {
        const r = (await chrome.tabs.sendMessage(tabId, { type: "jarvis:auto-search", keyword } satisfies Message)) as { ok: boolean; message: string } | undefined;
        if (r) return { keyword, ok: r.ok, message: r.message, at: at() };
      } catch {
        // 아직 콘텐츠 스크립트 없음
      }
      await sleep(2000);
    }
    return { keyword, ok: false, message: "JARVIS 패널이 응답하지 않았습니다.", at: at() };
  } catch (error) {
    return { keyword, ok: false, message: `오류: ${(error as Error).message}`, at: at() };
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function autoStep() {
  const run = await runningState();
  if (!run) return;
  const [keyword, ...rest] = run.queue;
  if (keyword) run.results.push(await collectKeyword(keyword));
  run.queue = rest;
  if (rest.length > 0 && (await getAutoCollectEnabled())) {
    await setAutoRun(run);
    await chrome.alarms.create(COLLECT_STEP, { delayInMinutes: nextDelayMinutes(Math.random()) });
  } else {
    const finished = { ...run, results: [...run.results, ...rest.map((k) => ({ keyword: k, ok: false, message: "자동 수집을 꺼서 건너뜀", at: new Date().toISOString() }))] };
    await setAutoRun(null);
    await setAutoSummary(summarize(finished, new Date().toISOString()));
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COLLECT_STEP) void autoStep();
  if (alarm.name !== COLLECT_CHECK) return;
  void (async () => {
    const [enabled, run, summary] = await Promise.all([getAutoCollectEnabled(), runningState(), getAutoSummary()]);
    if (isDue(Date.now(), { enabled, running: !!run, lastFinishedAt: summary?.finishedAt ?? null })) await startAutoCollect("SCHEDULE");
  })();
});
chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
void ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_ALARM) return;
  void (async () => {
    const at = new Date().toISOString();
    if (!(await validSession())) {
      await setLastAuto({ at, ok: false, status: "NOT_LOGGED_IN", message: "확장 프로그램에 로그인하지 않아 예약 실행을 하지 않았습니다." });
      return;
    }
    const r = await runAutomation();
    if (r.skipped) {
      // 20시간 안 · 실행 중이면 마지막 실제 실행 기록을 덮지 않는다
      const prev = await getLastAuto();
      if (!prev || prev.status === "NOT_LOGGED_IN" || prev.status === "OFFLINE") await setLastAuto({ at, ok: true, status: "SKIPPED", message: r.message ?? "건너뜀", runId: r.runId ?? null });
      return;
    }
    const failed = (r.steps ?? []).filter((s) => s.status === "FAILED").map((s) => s.name);
    await setLastAuto({
      at,
      ok: r.ok,
      status: r.status ?? (r.ok ? "SUCCEEDED" : "OFFLINE"),
      message: r.error ?? (failed.length ? `실패 단계: ${failed.join(", ")}` : "자동 발굴 완료"),
      runId: r.runId ?? null,
    });
  })();
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  // 이 확장 프로그램의 팝업 · 콘텐츠 스크립트에서 온 메시지만 받는다
  if (sender.id !== chrome.runtime.id) return false;

  (async () => {
    // 개발 빌드 전용 시험 경로 (배포 빌드에서는 JARVIS_DEV = false 라 코드째 빠진다)
    if (JARVIS_DEV && message.type === "jarvis:dev-raw") return sendRaw(message.body, message.path);
    switch (message.type) {
      case "jarvis:status": {
        const session = await validSession();
        const run = await getAutoRun();
        return {
          loggedIn: !!session,
          email: session?.email ?? null,
          apiBase: JARVIS_API_BASE,
          lastRun: await getLastRun(),
          lastAuto: await getLastAuto(),
          autoCollect: { enabled: await getAutoCollectEnabled(), running: run ? { done: run.results.length, remaining: run.queue.length } : null, summary: await getAutoSummary() },
        };
      }
      case "jarvis:login":
        try {
          const s = await login(message.email, message.password);
          return { ok: true, email: s.email };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      case "jarvis:logout":
        await logout();
        return { ok: true };
      case "jarvis:ingest": {
        const { collect } = message;
        const result = collect.ok && collect.records.length > 0 ? await sendRecords(collect.records) : { ok: false, error: collect.error ?? "보낼 데이터가 없습니다." };
        const run: LastRun = { at: new Date().toISOString(), pageType: collect.pageType, counts: collect.counts, summary: collect.summary, result };
        await setLastRun(run);
        return run;
      }
      case "jarvis:lookup":
        return lookup(message.keyword, message.coupangProductIds);
      case "jarvis:register": {
        const result = await registerSelected(message.input);
        const run: LastRun = {
          at: new Date().toISOString(),
          pageType: "search",
          counts: message.counts,
          summary: message.summary,
          result: { ...result, registered: { selected: result.selected ?? message.input.products.length, created: result.createdProducts ?? 0, existing: result.existingProducts ?? 0 } },
        };
        await setLastRun(run);
        return result;
      }
      case "jarvis:set-target":
        await setSupplyTarget(message.target);
        return { ok: true };
      case "jarvis:auto-start":
        return startAutoCollect("MANUAL");
      case "jarvis:auto-enable":
        await setAutoCollectEnabled(message.enabled);
        return { ok: true };
      case "jarvis:get-target":
        return getSupplyTarget();
      case "jarvis:supply":
        return sendSupply(message.page, message.targetProductId);
      default:
        return { ok: false, error: "알 수 없는 요청" };
    }
  })().then(sendResponse);
  return true;
});
