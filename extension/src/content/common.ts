/**
 * 콘텐츠 스크립트 공통: 메시지 처리 · 화면 오른쪽 아래 작은 수집 버튼 · DOM 읽기 도우미.
 *
 * 원칙: 지금 화면에 있는 DOM 만 읽는다. 네트워크 요청을 가로채거나 쿠팡 내부 API 를 부르지 않는다.
 *       페이지를 이동 · 스크롤 · 클릭하지 않는다.
 */

import { JARVIS_DEV } from "../shared/constants";
import { previewRecords } from "../shared/normalize";
import type { CollectResponse, DetectResponse, IngestRecord, LastRun, Message, PageType } from "../shared/types";

export interface PageCollector {
  pageType: PageType;
  detect(): DetectResponse;
  /** 화면을 읽어 레코드를 만든다 (전송하지 않음) */
  read(): { records: IngestRecord[]; summary: string[] } | { error: string };
  /** 버튼 1번의 전체 흐름 (기본: 읽기 → 전송). 검색 결과는 등록 여부 확인 → 저장 → 후보 표시 (PHASE 12) */
  run?(): Promise<LastRun>;
  /** 페이지 위 패널을 직접 그리면 기본 작은 버튼을 만들지 않는다 */
  mountPanel?(): void;
}

/** 기본 흐름: 화면 읽기 → /api/ingest */
export async function runCollector(collector: PageCollector): Promise<LastRun> {
  if (collector.run) return collector.run();
  const c = collect(collector);
  if (!c.ok) return { at: new Date().toISOString(), pageType: collector.pageType, counts: c.counts, summary: c.summary, result: { ok: false, error: c.error } };
  return (await chrome.runtime.sendMessage({ type: "jarvis:ingest", collect: c } satisfies Message)) as LastRun;
}

/** 결과 상태 이름 (서버 outcome — src/lib/ingest/outcome.ts 와 같은 이름) */
export const OUTCOME_LABELS: Record<string, string> = {
  COMPLETED: "완료",
  PARTIAL: "일부 미등록",
  PARTIAL_ERROR: "부분 성공 (오류 있음)",
  NO_MATCH: "등록 상품 없음",
  FAILED: "실패",
};

export function collect(collector: PageCollector): CollectResponse {
  const capturedSummary: string[] = [];
  try {
    const r = collector.read();
    if ("error" in r) return { ok: false, pageType: collector.pageType, error: r.error, records: [], counts: { products: 0, ranks: 0, keywords: 0 }, issues: [], summary: capturedSummary };
    const { counts, issues } = previewRecords(r.records);
    const empty = counts.products + counts.ranks + counts.keywords === 0;
    return {
      ok: !empty,
      pageType: collector.pageType,
      error: empty ? `저장할 값을 찾지 못했습니다. ${issues.map((i) => i.message).slice(0, 2).join(" / ")}` : undefined,
      records: r.records,
      counts,
      issues,
      summary: r.summary,
    };
  } catch (error) {
    return { ok: false, pageType: collector.pageType, error: `화면을 읽지 못했습니다: ${(error as Error).message}`, records: [], counts: { products: 0, ranks: 0, keywords: 0 }, issues: [], summary: capturedSummary };
  }
}

export function resultLine(run: LastRun): string {
  const r = run.result;
  if (!r.ok) return `오류: ${r.error ?? "알 수 없음"}`;
  const fails = Object.entries(r.failures ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const label = r.replay ? "이미 보낸 수집(재전송)" : `수집 완료${r.outcome ? ` [${OUTCOME_LABELS[r.outcome] ?? r.outcome}]` : ""}`;
  return `${label} · 전체 ${r.total} · 추가 ${r.inserted} · 갱신 ${r.updated} · 건너뜀 ${r.skipped} · 실패 ${r.failed}${fails ? ` (${fails})` : ""}`;
}

/** 확장 프로그램 메시지 처리 + 페이지 위 작은 버튼 */
export function start(collector: PageCollector) {
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "jarvis:detect") sendResponse(collector.detect());
    else if (message.type === "jarvis:collect") sendResponse(collect(collector));
    else if (message.type === "jarvis:run") {
      void runCollector(collector).then(sendResponse);
      return true;
    } else return false;
    return false;
  });
  if (collector.mountPanel) collector.mountPanel();
  else mountPanel(collector);
  /*
   * 개발 빌드 전용 시험 경로: 페이지에서 window.postMessage({ jarvisDev: "collect" | "ingest" | "raw", id, body? }) →
   * 결과를 window.postMessage({ jarvisDevResult: id, … }) 로 돌려준다. 배포 빌드에서는 JARVIS_DEV = false 라 이 블록이 통째로 빠진다.
   */
  if (JARVIS_DEV) {
    window.addEventListener("message", async (e) => {
      if (e.source !== window || !e.data || typeof e.data.jarvisDev !== "string") return;
      const { jarvisDev, id, body, path } = e.data as { jarvisDev: string; id: string; body?: string; path?: string };
      let result: unknown;
      if (jarvisDev === "collect") result = collect(collector);
      else if (jarvisDev === "raw" && typeof body === "string") result = await chrome.runtime.sendMessage({ type: "jarvis:dev-raw", body, path } satisfies Message);
      else if (jarvisDev === "ingest") {
        const c = collect(collector);
        result = c.ok ? await chrome.runtime.sendMessage({ type: "jarvis:ingest", collect: c } satisfies Message) : c;
      }
      window.postMessage({ jarvisDevResult: id, result }, location.origin);
    });
  }
}

/**
 * 패널을 페이지에 붙이고, 쿠팡이 화면을 다시 그리며 떼어 내면 다시 붙인다 (PHASE 12 실사용: 검색 결과 화면이 뜬 직후 html 아래 낯선 노드를 지움).
 * 같은 요소를 다시 붙이므로 패널 상태(체크한 상품 등)는 그대로다.
 */
export function keepAttached(host: HTMLElement) {
  const attach = () => {
    if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
  };
  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: false });
  if (document.body) new MutationObserver(attach).observe(document.body, { childList: true });
  window.setInterval(attach, 1000);
}

function mountPanel(collector: PageCollector) {
  if (document.getElementById("jarvis-collector-root")) return;
  const host = document.createElement("div");
  host.id = "jarvis-collector-root";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box{font:12px/1.4 -apple-system,"Malgun Gothic",sans-serif;background:#111827;color:#f9fafb;border-radius:10px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:280px}
      button{font:inherit;font-weight:600;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
      button:disabled{opacity:.6;cursor:default}
      .msg{margin-top:6px;white-space:pre-wrap;word-break:keep-all}
      .muted{color:#9ca3af}
    </style>
    <div class="box"><button id="jarvis-collect" type="button">JARVIS 수집</button><div class="msg muted" id="jarvis-msg"></div></div>`;
  keepAttached(host);

  const button = root.getElementById("jarvis-collect") as HTMLButtonElement;
  const msg = root.getElementById("jarvis-msg") as HTMLDivElement;
  button.textContent = collector.pageType === "search" ? "현재 검색 결과 수집" : collector.pageType === "product" ? "현재 상품 수집" : "현재 데이터 수집";

  // 쿠팡 · WING 은 화면이 뜬 뒤에 주소(검색어 자동 수정)나 내용(목록)을 바꾼다 → 버튼 상태를 주기적으로 다시 확인한다.
  // 저장 여부는 어차피 클릭 순간에 다시 검사한다 (collect → detect).
  let busy = false;
  let shownResult = false;
  const refresh = () => {
    if (busy) return;
    const d = collector.detect();
    button.disabled = !d.collectable;
    if (!d.collectable) msg.textContent = d.reason ?? "이 화면은 수집할 수 없습니다.";
    else if (!shownResult) msg.textContent = "";
  };
  refresh();
  window.setInterval(refresh, 2000);

  button.addEventListener("click", async () => {
    busy = true;
    shownResult = true;
    button.disabled = true;
    msg.textContent = "수집 · 전송 중…";
    try {
      const run = await runCollector(collector);
      msg.textContent = `${resultLine(run)}${run.result.jobId ? `\nJob ${run.result.jobId.slice(0, 8)}` : ""}`;
      msg.dataset.state = run.result.ok ? "done" : "error";
      msg.dataset.jobId = run.result.jobId ?? "";
    } catch (error) {
      msg.textContent = `오류: ${(error as Error).message}`;
      msg.dataset.state = "error";
    }
    busy = false;
    button.disabled = false;
  });
}
