/**
 * 배경 서비스 워커: 로그인 · 전송 · 마지막 결과 저장.
 * 콘텐츠 스크립트와 팝업은 서버에 직접 요청하지 않고 이곳에 메시지를 보낸다 (토큰은 이곳에서만 쓴다).
 * 다른 탭 이동 · 다음 페이지 · 자동 수집은 하지 않는다 — 사용자가 누른 버튼 1번 = 전송 1번.
 *
 * 예약 자동 발굴 (PHASE 17): chrome.alarms 가 1시간마다 깨어나 JARVIS 서버의 /api/automation/run 만 부른다.
 *   쿠팡 탭을 열거나 쿠팡에 요청하지 않는다. 서버는 마지막 실행 뒤 20시간 안이면 건너뛰므로 실제 실행은 하루 1회.
 *   Chrome 이 켜져 있고 · 확장 프로그램에 로그인돼 있고 · JARVIS 서버가 켜져 있을 때만 실행된다.
 */

import { login, logout, lookup, registerSelected, runAutomation, sendRaw, sendRecords, sendSupply, validSession } from "../shared/api";
import { JARVIS_API_BASE, JARVIS_DEV } from "../shared/constants";
import { getLastAuto, getLastRun, getSupplyTarget, setLastAuto, setLastRun, setSupplyTarget } from "../shared/storage";
import type { LastRun, Message } from "../shared/types";

const AUTO_ALARM = "jarvis-auto-discovery";

async function ensureAlarm() {
  if (!(await chrome.alarms.get(AUTO_ALARM))) await chrome.alarms.create(AUTO_ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
}
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
        return { loggedIn: !!session, email: session?.email ?? null, apiBase: JARVIS_API_BASE, lastRun: await getLastRun(), lastAuto: await getLastAuto() };
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
