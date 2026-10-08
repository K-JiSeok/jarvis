/**
 * 배경 서비스 워커: 로그인 · 전송 · 마지막 결과 저장.
 * 콘텐츠 스크립트와 팝업은 서버에 직접 요청하지 않고 이곳에 메시지를 보낸다 (토큰은 이곳에서만 쓴다).
 * 다른 탭 이동 · 다음 페이지 · 자동 수집은 하지 않는다 — 사용자가 누른 버튼 1번 = 전송 1번.
 */

import { login, logout, sendRaw, sendRecords, validSession } from "../shared/api";
import { JARVIS_API_BASE, JARVIS_DEV } from "../shared/constants";
import { getLastRun, setLastRun } from "../shared/storage";
import type { LastRun, Message } from "../shared/types";

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  // 이 확장 프로그램의 팝업 · 콘텐츠 스크립트에서 온 메시지만 받는다
  if (sender.id !== chrome.runtime.id) return false;

  (async () => {
    // 개발 빌드 전용 시험 경로 (배포 빌드에서는 JARVIS_DEV = false 라 코드째 빠진다)
    if (JARVIS_DEV && message.type === "jarvis:dev-raw") return sendRaw(message.body);
    switch (message.type) {
      case "jarvis:status": {
        const session = await validSession();
        return { loggedIn: !!session, email: session?.email ?? null, apiBase: JARVIS_API_BASE, lastRun: await getLastRun() };
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
      default:
        return { ok: false, error: "알 수 없는 요청" };
    }
  })().then(sendResponse);
  return true;
});
