/**
 * 쿠팡 검색 결과 콘텐츠 스크립트 — 지금 보이는 페이지만 (다음 페이지로 이동하지 않는다)
 *
 * [현재 검색 결과 수집] (PHASE 12)
 *   1. 화면 읽기 (60칸) → 2. JARVIS 등록 여부 확인 (/api/extension/lookup, 읽기 전용)
 *   3. 저장 (/api/ingest): 순위(전체 칸) + 키워드 집계(등록 키워드일 때) + 등록 상품의 검색 칸 값(상품 스냅샷)
 *   4. 화면 패널에 등록 상품 · 미등록 후보 표시 (체크박스)
 * [선택 상품 등록]
 *   사용자가 체크한 상품만 /api/extension/register → 상품 생성 + 그 상품의 순위 · 검색 칸 값 저장 (한 트랜잭션)
 * 자동 등록 없음: 체크하지 않은 상품은 만들지 않는다. 광고 · 순위가 높은 상품도 자동으로 고르지 않는다.
 */

import { EXT_VERSION } from "../shared/constants";
import { adaptSearchPage, correctedQueryOf, previewRecords, searchParamsOf } from "../shared/normalize";
import type { CollectResponse, IngestRecord, LastRun, LookupResult, Message, RegisterResult } from "../shared/types";
import {
  aggregateSearch,
  searchItemToProduct,
  searchToKeywordRecord,
  uniqueSearchProducts,
  type SearchAggregate,
  type SearchProduct,
} from "../../../src/lib/collectors/coupang/search";
import type { CollectedSearchResult } from "../../../src/lib/collectors/types";

import { keepAttached, OUTCOME_LABELS, resultLine, start, type PageCollector } from "./common";
import { productUnits, readSearchPage } from "./dom/search";

interface SearchState {
  result: CollectedSearchResult;
  products: SearchProduct[];
  registered: Set<string>;
  keyword: { keyword: string; registered: boolean };
  agg: SearchAggregate;
  run: LastRun | null;
  register: RegisterResult | null;
}

let state: SearchState | null = null;
let busy = false;
const selected = new Set<string>();

const won = (v: number | null | undefined) => (typeof v === "number" ? `${v.toLocaleString("ko-KR")}원` : "가격 -");
const DELIVERY: Record<string, string> = { ROCKET: "로켓배송", ROCKET_GROWTH: "판매자로켓", NONE: "로켓 아님", UNKNOWN: "배지 확인 못 함" };
const SELLER: Record<string, string> = { ROCKET_GROWTH_SELLER: "로켓그로스 판매자" };

const collector: PageCollector = {
  pageType: "search",
  detect() {
    const { keyword, page } = searchParamsOf(location.href);
    const n = productUnits().length;
    if (!keyword) return { pageType: "search", collectable: false, reason: "검색어(q)가 없는 주소입니다.", summary: [] };
    const corrected = correctedQueryOf(location.href);
    if (corrected) {
      return { pageType: "search", collectable: false, reason: `쿠팡이 검색어를 "${corrected}"(으)로 바꿔 보여 준 결과라 "${keyword}" 순위로 저장하지 않습니다.`, summary: [`"${keyword}"`] };
    }
    if (page !== 1) {
      return { pageType: "search", collectable: false, reason: `${page ?? "?"}페이지입니다. 2페이지 이상은 순위가 이어지는지 확인하지 못해 아직 수집하지 않습니다.`, summary: [`"${keyword}"`] };
    }
    if (n === 0) return { pageType: "search", collectable: false, reason: "검색 결과 상품을 찾지 못했습니다.", summary: [`"${keyword}"`] };
    return { pageType: "search", collectable: true, summary: [`"${keyword}" ${page}페이지 · 상품 ${n}칸`] };
  },
  read() {
    const d = collector.detect();
    if (!d.collectable) return { error: d.reason ?? "수집할 수 없는 화면입니다." };
    const result = readResult();
    const ads = result.items.filter((i) => i.isAd).length;
    const record: IngestRecord = { kind: "search", ...result };
    return { records: [record], summary: [`"${result.keyword}" ${result.page}페이지`, `상품 ${result.items.length}칸 (자연 ${result.items.length - ads} · 광고 ${ads})`] };
  },
  run: runSearch,
  mountPanel,
};

function readResult(): CollectedSearchResult {
  return adaptSearchPage(readSearchPage(), { source: "COUPANG_PAGE", confidence: "A", capturedAt: new Date().toISOString(), tool: `jarvis-extension/${EXT_VERSION}` });
}

const failRun = (error: string, summary: string[] = []): LastRun => ({
  at: new Date().toISOString(),
  pageType: "search",
  counts: { products: 0, ranks: 0, keywords: 0 },
  summary,
  result: { ok: false, error },
});

/** 1~4: 읽기 → 등록 여부 → 저장 → 후보 표시 */
async function runSearch(): Promise<LastRun> {
  const d = collector.detect();
  if (!d.collectable) return failRun(d.reason ?? "수집할 수 없는 화면입니다.");
  const result = readResult();
  const products = uniqueSearchProducts(result);
  const lk = (await chrome.runtime.sendMessage({
    type: "jarvis:lookup",
    keyword: result.keyword,
    coupangProductIds: products.map((p) => p.coupangProductId),
  } satisfies Message)) as LookupResult;
  if (!lk?.ok) return failRun(`등록 여부를 확인하지 못했습니다: ${lk?.error ?? "응답 없음"}`);

  const registered = new Set(lk.registered.map((r) => r.coupangProductId));
  const keyword = { keyword: result.keyword, registered: !!lk.keyword?.registered };
  const agg = aggregateSearch(result);

  // 순위는 전체 칸 (미등록은 서버가 PRODUCT_NOT_FOUND 로 기록 — PHASE 11 과 같음), 상품 값은 등록 상품만, 집계는 등록 키워드만
  const records: IngestRecord[] = [{ kind: "search", ...result }];
  const kwRecord = keyword.registered ? searchToKeywordRecord(result, agg) : null;
  if (kwRecord) records.push({ kind: "keyword", ...kwRecord });
  for (const p of products) if (registered.has(p.coupangProductId)) records.push({ kind: "product", ...searchItemToProduct(result, p) });

  const ads = result.items.filter((i) => i.isAd).length;
  const summary = [
    `"${result.keyword}" ${result.page}페이지 · 상품 ${result.items.length}칸 (자연 ${result.items.length - ads} · 광고 ${ads})`,
    `서로 다른 상품 ${products.length} · 등록 ${registered.size} · 미등록 ${products.length - registered.size}`,
  ];
  const preview = previewRecords(records);
  const collect: CollectResponse = { ok: true, pageType: "search", records, counts: preview.counts, issues: preview.issues, summary };
  const run = (await chrome.runtime.sendMessage({ type: "jarvis:ingest", collect } satisfies Message)) as LastRun;

  state = { result, products, registered, keyword, agg, run, register: null };
  for (const id of [...selected]) if (!products.some((p) => p.coupangProductId === id)) selected.delete(id);
  render();
  return run;
}

/** [선택 상품 등록] — 체크한 상품만 */
async function registerChecked(registerKeyword: boolean): Promise<void> {
  if (!state) return;
  const s = state;
  const picked = s.products.filter((p) => selected.has(p.coupangProductId));
  if (picked.length === 0) return;
  const canRank = s.keyword.registered || registerKeyword;
  if (!canRank) return;
  // 이번에 고른 상품 + (키워드를 새로 등록하면) 이미 등록된 상품의 순위도 이 키워드로 저장
  const keep = new Set([...picked.map((p) => p.coupangProductId), ...(registerKeyword ? s.registered : [])]);
  const records: IngestRecord[] = [{ kind: "search", ...s.result, items: s.result.items.filter((i) => i.coupangProductId && keep.has(i.coupangProductId)) }];
  for (const p of picked) records.push({ kind: "product", ...searchItemToProduct(s.result, p) });
  if (registerKeyword) {
    const kw = searchToKeywordRecord(s.result, s.agg);
    if (kw) records.push({ kind: "keyword", ...kw });
  }
  const preview = previewRecords(records);
  const result = (await chrome.runtime.sendMessage({
    type: "jarvis:register",
    input: {
      records,
      products: picked.map((p) => ({ coupangProductId: p.coupangProductId, productName: p.item.productName ?? null })),
      registerKeyword: registerKeyword ? s.keyword.keyword : null,
    },
    counts: preview.counts,
    summary: [`"${s.keyword.keyword}" 선택 상품 ${picked.length}개 등록`],
  } satisfies Message)) as RegisterResult;
  s.register = result;
  if (result.ok) {
    for (const p of picked) s.registered.add(p.coupangProductId);
    if (registerKeyword) s.keyword.registered = true;
    selected.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// 화면 패널 (Shadow DOM — 쿠팡 페이지 스타일과 섞이지 않는다)
// ---------------------------------------------------------------------------------------------

let root: ShadowRoot | null = null;
let onlyUnregistered = false;
let collapsed = false;

function mountPanel() {
  if (document.getElementById("jarvis-collector-root")) return;
  const host = document.createElement("div");
  host.id = "jarvis-collector-root";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  root = host.attachShadow({ mode: "open" });
  keepAttached(host);
  render();
  // 쿠팡이 화면을 띄운 뒤 주소(검색어 수정)를 바꾸므로 버튼 상태를 다시 확인한다
  window.setInterval(() => {
    if (!busy && !state) render();
  }, 2000);
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render() {
  if (!root) return;
  const d = collector.detect();
  const s = state;
  const rows = s
    ? s.products
        .filter((p) => !onlyUnregistered || !s.registered.has(p.coupangProductId))
        .sort((a, b) => (a.organicRank ?? 999 + (a.adRank ?? 0)) - (b.organicRank ?? 999 + (b.adRank ?? 0)))
    : [];
  const unregistered = s ? s.products.filter((p) => !s.registered.has(p.coupangProductId)).length : 0;
  const ads = s ? s.result.items.filter((i) => i.isAd).length : 0;
  const needKeyword = s && !s.keyword.registered;

  root.innerHTML = `
    <style>
      .box{font:12px/1.45 -apple-system,"Malgun Gothic",sans-serif;background:#111827;color:#f9fafb;border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.3);width:${s && !collapsed ? "420px" : "auto"};max-width:calc(100vw - 32px)}
      button{font:inherit;font-weight:600;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      button.ghost{background:transparent;color:#9ca3af;font-weight:400;padding:2px 4px}
      .muted{color:#9ca3af}.ok{color:#34d399}.err{color:#f87171}.warn{color:#fbbf24}
      .msg{margin-top:6px;white-space:pre-wrap;word-break:keep-all}
      .grid{display:grid;grid-template-columns:auto auto;gap:1px 12px;margin:6px 0}
      .list{max-height:42vh;overflow:auto;margin:6px 0;border-top:1px solid #374151}
      .row{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #1f2937}
      .row input{margin-top:3px}
      .name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .tag{display:inline-block;border:1px solid #4b5563;border-radius:4px;padding:0 4px;margin-right:4px;font-size:11px}
      .tag.reg{border-color:#34d399;color:#34d399}.tag.ad{border-color:#fbbf24;color:#fbbf24}
      .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
      label{cursor:pointer}
    </style>
    <div class="box">
      <div class="head">
        <button id="jarvis-collect" type="button" ${d.collectable && !busy ? "" : "disabled"}>현재 검색 결과 수집</button>
        ${s ? `<button id="jarvis-toggle" class="ghost" type="button">${collapsed ? "펼치기" : "접기"}</button>` : ""}
      </div>
      <div class="msg muted" id="jarvis-msg">${esc(!d.collectable ? d.reason : busy ? "처리 중…" : s?.run ? resultLine(s.run) : "")}</div>
      ${
        s && !collapsed
          ? `
        <div class="grid">
          <span class="muted">검색어 · 페이지</span><span>${esc(s.keyword.keyword)} · ${s.result.page}페이지 ${s.keyword.registered ? '<span class="tag reg">등록 키워드</span>' : '<span class="tag">미등록 키워드</span>'}</span>
          <span class="muted">상품 칸</span><span>${s.result.items.length} (자연 ${s.result.items.length - ads} · 광고 ${ads})</span>
          <span class="muted">서로 다른 상품</span><span id="jarvis-counts" data-total="${s.products.length}" data-registered="${s.registered.size}" data-unregistered="${unregistered}">${s.products.length} · 등록 상품 <b>${s.registered.size}</b> · 미등록 후보 <b>${unregistered}</b></span>
          <span class="muted">1페이지 집계</span><span id="jarvis-agg">평균가 ${won(s.agg.averagePrice)} · 평균 리뷰 ${s.agg.averageReviews ?? "-"} · 로켓 ${s.agg.rocketRatio == null ? "-" : `${Math.round(s.agg.rocketRatio * 1000) / 10}%`} <span class="muted">(광고 · 중복 제외 ${s.agg.sampleSize}개${s.keyword.registered ? "" : " · 키워드 미등록이라 저장 안 됨"})</span></span>
        </div>
        ${registerBlock(s, needKeyword)}
        <label><input id="jarvis-only-unreg" type="checkbox" ${onlyUnregistered ? "checked" : ""}> 미등록만 보기</label>
        <div class="list">
          ${rows.map((p) => candidateRow(p, s.registered.has(p.coupangProductId))).join("")}
        </div>`
          : ""
      }
    </div>`;
  bind();
}

function registerBlock(s: SearchState, needKeyword: boolean | null): string {
  const r = s.register;
  const res = r
    ? r.ok
      ? `<div id="jarvis-reg-result" class="msg ok" data-state="done" data-created="${r.createdProducts}" data-existing="${r.existingProducts}">선택 ${r.selected} · 신규 등록 ${r.createdProducts} · 기존 상품 ${r.existingProducts}${r.keywordCreated ? " · 키워드 등록" : ""}
순위 저장 ${kindLine(r, "rank")} · 상품 데이터 ${kindLine(r, "product")}${r.kinds?.keyword && sumKind(r, "keyword") ? ` · 키워드 집계 ${kindLine(r, "keyword")}` : ""}
${r.replay ? "이미 처리한 요청 (재전송) · " : ""}[${OUTCOME_LABELS[r.outcome ?? ""] ?? r.outcome}] Job ${String(r.jobId ?? "").slice(0, 8)}</div>`
      : `<div id="jarvis-reg-result" class="msg err" data-state="error">선택 ${r.selected ?? selected.size}개 등록 실패${r.rolledBack ? " — 이번 작업은 롤백되었습니다 (상품 등록 · 데이터 저장 모두 취소)" : ""}
${esc(r.error)}${r.detail ? `\n${esc(r.detail)}` : ""}</div>`
    : "";
  return `
    <div style="margin:6px 0">
      ${needKeyword ? `<label><input id="jarvis-reg-keyword" type="checkbox" checked> 키워드 "${esc(s.keyword.keyword)}"도 등록 (등록해야 검색 순위를 저장할 수 있습니다)</label><br>` : ""}
      <button id="jarvis-register" type="button" ${selected.size && !busy ? "" : "disabled"}>선택 상품 등록 (${selected.size})</button>
      <span class="muted"> 체크한 상품만 JARVIS 상품으로 만듭니다</span>
      ${res}
    </div>`;
}

const sumKind = (r: RegisterResult, k: "rank" | "product" | "keyword") => {
  const c = r.kinds?.[k];
  return c ? c.inserted + c.updated + c.skipped + c.failed : 0;
};
const kindLine = (r: RegisterResult, k: "rank" | "product" | "keyword") => {
  const c = r.kinds?.[k];
  return c ? `${c.inserted + c.updated + c.skipped}/${sumKind(r, k)}` : "-";
};

function candidateRow(p: SearchProduct, isRegistered: boolean): string {
  const i = p.item;
  const ranks = [p.organicRank != null ? `자연 #${p.organicRank}` : "", p.adRank != null ? `<span class="tag ad">광고 #${p.adRank}</span>` : ""].filter(Boolean).join(" ");
  return `
    <label class="row" data-pid="${esc(p.coupangProductId)}">
      <input type="checkbox" class="jarvis-pick" data-pid="${esc(p.coupangProductId)}" ${selected.has(p.coupangProductId) ? "checked" : ""}>
      <span>
        <b>${ranks}</b> ${isRegistered ? '<span class="tag reg">등록됨</span>' : '<span class="tag">미등록</span>'}${p.appearances > 1 ? `<span class="muted">${p.appearances}번 노출</span>` : ""}
        <span class="name">${esc(i.productName ?? "(상품명 없음)")}</span>
        <span class="muted">ID ${esc(p.coupangProductId)} · ${won(i.price)} · 리뷰 ${i.reviewCount ?? "-"} · ★${i.rating ?? "-"} · ${DELIVERY[i.badge ?? ""] ?? "-"}${i.sellerType ? ` · ${SELLER[i.sellerType] ?? i.sellerType}` : " · 판매자 유형 모름"}</span>
      </span>
    </label>`;
}

function bind() {
  if (!root) return;
  root.getElementById("jarvis-collect")?.addEventListener("click", async () => {
    busy = true;
    render();
    try {
      const run = await runSearch();
      if (!state) {
        busy = false;
        render();
        const msg = root?.getElementById("jarvis-msg");
        if (msg) msg.textContent = resultLine(run);
        return;
      }
    } finally {
      busy = false;
    }
    render();
  });
  root.getElementById("jarvis-toggle")?.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
  });
  root.getElementById("jarvis-only-unreg")?.addEventListener("change", (e) => {
    onlyUnregistered = (e.target as HTMLInputElement).checked;
    render();
  });
  for (const box of root.querySelectorAll<HTMLInputElement>(".jarvis-pick")) {
    box.addEventListener("change", () => {
      const id = box.dataset.pid ?? "";
      if (box.checked) selected.add(id);
      else selected.delete(id);
      const b = root?.getElementById("jarvis-register") as HTMLButtonElement | null;
      if (b) {
        b.disabled = selected.size === 0 || busy;
        b.textContent = `선택 상품 등록 (${selected.size})`;
      }
    });
  }
  root.getElementById("jarvis-reg-keyword")?.addEventListener("change", (e) => {
    const b = root?.getElementById("jarvis-register") as HTMLButtonElement | null;
    if (b) b.disabled = !(e.target as HTMLInputElement).checked || selected.size === 0;
  });
  root.getElementById("jarvis-register")?.addEventListener("click", async () => {
    const kwBox = root?.getElementById("jarvis-reg-keyword") as HTMLInputElement | null;
    busy = true;
    render();
    try {
      await registerChecked(!!kwBox?.checked);
    } finally {
      busy = false;
    }
    render();
  });
}

start(collector);
