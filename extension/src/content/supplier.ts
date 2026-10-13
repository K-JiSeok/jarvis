/**
 * 중국 도매 사이트 콘텐츠 스크립트 (PHASE 18) — Alibaba.com · 1688 · 타오바오.
 *
 *   검색 페이지: JARVIS 가 만든 검색 링크의 jarvis_pid 를 "지금 찾는 JARVIS 상품"으로 기억 (2시간)
 *   상품 페이지: [JARVIS 공급 후보 저장] — 사용자가 누를 때만 지금 화면을 읽어 보낸다
 *     대상 상품이 기억돼 있으면 그 상품의 공급 후보로, 없으면 등록 상품 전체와 자동 매칭
 *
 * 다른 탭 열기 · 자동 이동 · 사이트 내부 API 호출 · 로그인 · 차단 회피 없음. 화면에 보인 값만.
 */

import { jarvisPidOf } from "../../../src/lib/sourcing/links";
import type { Message, SupplyTarget } from "../shared/types";

import { keepAttached } from "./common";
import { readSupplierPage } from "./dom/supplier";

const isProductPage = () =>
  /alibaba\.com$/.test(location.hostname) ? /\/product-detail\/.+_\d+\.html/.test(location.pathname) : /1688\.com$/.test(location.hostname) ? /\/offer\/\d+\.html/.test(location.pathname) : /[?&]id=\d+/.test(location.search);

async function rememberTarget() {
  // 검색 페이지 주소 또는 (상품 페이지를 검색 결과에서 열었다면) 이전 페이지 주소
  const from = jarvisPidOf(location.href) ? location.href : document.referrer && jarvisPidOf(document.referrer) ? document.referrer : null;
  const pid = from ? jarvisPidOf(from) : null;
  if (!pid || !from) return;
  const u = new URL(from);
  const query = u.searchParams.get("SearchText") ?? u.searchParams.get("keywords") ?? u.searchParams.get("q") ?? "";
  await chrome.runtime.sendMessage({ type: "jarvis:set-target", target: { productId: pid, query, at: new Date().toISOString(), site: location.hostname } } satisfies Message);
}

async function mountProductPanel() {
  if (document.getElementById("jarvis-supplier-root")) return;
  const host = document.createElement("div");
  host.id = "jarvis-supplier-root";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box{font:12px/1.45 -apple-system,"Malgun Gothic",sans-serif;background:#111827;color:#f9fafb;border-radius:10px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:300px}
      button{font:inherit;font-weight:600;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
      button:disabled{opacity:.6;cursor:default}
      .msg{margin-top:6px;white-space:pre-wrap;word-break:keep-all}.muted{color:#9ca3af}.ok{color:#34d399}.err{color:#f87171}
      label{display:block;margin:4px 0;cursor:pointer}
      [hidden]{display:none!important}
    </style>
    <div class="box">
      <div class="muted" id="jarvis-target">대상 상품 확인 중…</div>
      <label id="jarvis-use-wrap" hidden><input id="jarvis-use-target" type="checkbox" checked> 이 상품의 공급 후보로 저장</label>
      <button id="jarvis-supply" type="button">JARVIS 공급 후보 저장</button>
      <div class="msg muted" id="jarvis-msg">화면에 보이는 값(가격 · 수량 구간 · 속성 · 공급업체)만 저장합니다.</div>
    </div>`;
  keepAttached(host);
  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  const target = (await chrome.runtime.sendMessage({ type: "jarvis:get-target" } satisfies Message)) as SupplyTarget | null;
  if (target) {
    $("jarvis-target").textContent = `대상: JARVIS 상품 (검색어 "${target.query}", ${new Date(target.at).toLocaleTimeString("ko-KR")})`;
    $("jarvis-use-wrap").hidden = false;
  } else {
    $("jarvis-target").textContent = "대상 상품 없음 — 저장하면 등록 상품 전체와 자동 매칭합니다 (JARVIS 상품 발굴의 검색 링크로 오면 대상이 정해집니다)";
  }
  const button = $<HTMLButtonElement>("jarvis-supply");
  const msg = $("jarvis-msg");
  button.addEventListener("click", async () => {
    button.disabled = true;
    msg.className = "msg muted";
    msg.textContent = "읽는 중 · 전송 중…";
    try {
      const page = readSupplierPage();
      const useTarget = target && ($<HTMLInputElement>("jarvis-use-target").checked ?? false);
      const r = (await chrome.runtime.sendMessage({ type: "jarvis:supply", page, targetProductId: useTarget ? target!.productId : null } satisfies Message)) as {
        ok: boolean;
        error?: string;
        created?: boolean;
        basePrice?: { amount: number; currency: string } | null;
        tiers?: number;
        moq?: number | null;
        issues?: string[];
        target?: { label: string; landed: { min: number; max: number } | null; confidence: string | null } | null;
        auto?: { linked: number; checked: number } | null;
      };
      if (!r.ok) {
        msg.className = "msg err";
        msg.textContent = r.error ?? "저장 실패";
      } else {
        msg.className = "msg ok";
        const price = r.basePrice ? `${r.basePrice.amount} ${r.basePrice.currency}` : "가격 없음";
        const link = r.target
          ? `대상 상품 연결 · ${r.target.label}${r.target.landed ? `\n예상 도착 원가 ${r.target.landed.min.toLocaleString("ko-KR")}~${r.target.landed.max.toLocaleString("ko-KR")}원 (신뢰도 ${r.target.confidence})` : ""}`
          : `자동 매칭 ${r.auto?.linked ?? 0}개 연결 (상품 ${r.auto?.checked ?? 0}개 비교)`;
        msg.textContent = `${r.created ? "새 공급 후보" : "기존 후보 갱신"} · ${price} · 구간 ${r.tiers ?? 0} · MOQ ${r.moq ?? "-"}\n${link}${r.issues?.length ? `\n확인 못 한 값: ${r.issues.slice(0, 3).join(" / ")}` : ""}`;
      }
    } catch (error) {
      msg.className = "msg err";
      msg.textContent = `오류: ${(error as Error).message}`;
    }
    button.disabled = false;
  });
}

// 대상 기억이 끝난 뒤 패널을 그린다 (같은 페이지에서 기억한 대상을 바로 보여 주도록)
void rememberTarget().finally(() => {
  if (isProductPage()) void mountProductPanel();
});
