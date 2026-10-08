/** 팝업: 로그인 · 현재 페이지 상태 · [현재 페이지 수집] · 마지막 결과 */

import { PAGE_LABELS, type DetectResponse, type LastRun, type Message } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = "ready" | "blocked" | "busy" | "done" | "error";
const STATE_LABELS: Record<State, string> = { ready: "● 수집 가능", blocked: "● 수집 불가", busy: "● 수집 중", done: "● 완료", error: "● 오류" };

function setState(s: State, note?: string) {
  const el = $("state");
  el.dataset.s = s;
  el.textContent = note ? `${STATE_LABELS[s]} · ${note}` : STATE_LABELS[s];
}

const send = <T>(m: Message) => chrome.runtime.sendMessage(m) as Promise<T>;

let tabId: number | null = null;
let apiBase = "";

async function activeTabMessage<T>(m: Message): Promise<T | null> {
  if (tabId == null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, m)) as T;
  } catch {
    return null; // 콘텐츠 스크립트가 없는 페이지
  }
}

function renderLast(run: LastRun | null) {
  const box = $("last");
  const nf = $("notfound");
  if (!run) {
    box.textContent = "아직 없습니다.";
    nf.hidden = true;
    return;
  }
  const r = run.result;
  const at = new Date(run.at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  const rows: [string, string | number][] = [
    ["시각", at],
    ["페이지", PAGE_LABELS[run.pageType]],
    ["상품 · 순위 · 키워드", `${run.counts.products} · ${run.counts.ranks} · ${run.counts.keywords}`],
  ];
  if (r.ok) {
    rows.push(["전체", r.total ?? 0], ["추가", r.inserted ?? 0], ["업데이트", r.updated ?? 0], ["건너뜀", r.skipped ?? 0], ["실패", r.failed ?? 0]);
    for (const [code, n] of Object.entries(r.failures ?? {})) rows.push([`  ${code}`, n]);
    if (r.replay) rows.push(["", "이미 저장된 수집 (재전송)"]);
    if (r.registered) rows.push(["선택 · 신규 등록 · 기존", `${r.registered.selected} · ${r.registered.created} · ${r.registered.existing}`]);
  } else rows.push(["오류", r.rolledBack ? `${r.error ?? "오류"} (이번 작업은 롤백되었습니다)` : (r.error ?? "알 수 없음")]);

  box.replaceChildren();
  const table = document.createElement("table");
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = String(v);
  }
  box.append(table);
  if (r.jobId) {
    const p = document.createElement("p");
    p.append(`Job ${r.jobId.slice(0, 8)} · `);
    const a = document.createElement("a");
    a.href = `${apiBase}${r.jarvisPath ?? "/import"}`;
    a.target = "_blank";
    a.textContent = "JARVIS 에서 보기";
    p.append(a);
    box.append(p);
  }

  const list = r.notFound ?? [];
  nf.hidden = list.length === 0;
  const ul = $("notfound-list");
  ul.replaceChildren(
    ...list.slice(0, 15).map((x) => {
      const li = document.createElement("li");
      li.textContent = `${x.isAd ? "광고" : "자연"} ${x.rank ?? "-"}위 · ${x.productName ?? x.coupangProductId ?? "?"}`;
      return li;
    }),
  );
  if (list.length > 15) ul.append(Object.assign(document.createElement("li"), { textContent: `외 ${list.length - 15}개` }));
}

async function refresh() {
  const status = await send<{ loggedIn: boolean; email: string | null; apiBase: string; lastRun: LastRun | null }>({ type: "jarvis:status" });
  apiBase = status.apiBase;
  const conn = $("conn");
  conn.textContent = status.loggedIn ? "● 연결됨" : "● 로그인 필요";
  conn.className = `pill ${status.loggedIn ? "ok" : "err"}`;
  $("login").hidden = status.loggedIn;
  $("main").hidden = !status.loggedIn;
  $("who").textContent = status.email ?? "";
  if (!status.loggedIn) return;

  renderLast(status.lastRun);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const d = await activeTabMessage<DetectResponse>({ type: "jarvis:detect" });
  const button = $<HTMLButtonElement>("collect");
  if (!d) {
    $("page").textContent = PAGE_LABELS.other;
    setState("blocked", "쿠팡 상품 · 검색 · WING 화면에서 여세요");
    button.disabled = true;
    return;
  }
  $("page").textContent = PAGE_LABELS[d.pageType];
  $("search-hint").hidden = d.pageType !== "search";
  button.textContent = d.pageType === "search" ? "현재 검색 결과 수집" : d.pageType === "product" ? "현재 상품 수집" : "현재 데이터 수집";
  $("summary").replaceChildren(...d.summary.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  button.disabled = !d.collectable;
  if (d.collectable) setState("ready");
  else setState("blocked", d.reason ?? undefined);
}

$("collect").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("collect");
  button.disabled = true;
  setState("busy");
  // 페이지의 전체 흐름을 콘텐츠 스크립트가 실행한다 (검색 결과: 등록 여부 확인 → 저장 → 쿠팡 화면 패널에 후보 표시)
  const run = await activeTabMessage<LastRun>({ type: "jarvis:run" });
  if (!run) {
    setState("error", "화면을 읽지 못했습니다.");
    button.disabled = false;
    return;
  }
  $("summary").replaceChildren(...run.summary.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  renderLast(run);
  if (run.result.ok) setState("done");
  else setState("error", run.result.error);
  button.disabled = false;
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $<HTMLInputElement>("email").value.trim();
  const password = $<HTMLInputElement>("password");
  $("login-error").textContent = "";
  const r = await send<{ ok: boolean; error?: string }>({ type: "jarvis:login", email, password: password.value });
  password.value = "";
  if (!r.ok) $("login-error").textContent = r.error ?? "로그인 실패";
  await refresh();
});

$("logout").addEventListener("click", async () => {
  await send({ type: "jarvis:logout" });
  await refresh();
});

void refresh();
