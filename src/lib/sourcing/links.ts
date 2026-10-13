/**
 * 도매 검색 주소 (순수 함수, PHASE 18). 링크는 첫 단계일 뿐 — 실제 공급 상품은 확장 프로그램이 사용자가 연 상품 페이지에서 읽어 저장한다.
 *
 * jarvis_pid: JARVIS 상품 id. 확장 프로그램이 검색 페이지에서 이 값을 읽어 "지금 찾는 쿠팡 상품"으로 기억하고,
 * 이어서 연 상품 페이지를 그 상품의 공급 후보로 저장한다 (사이트는 모르는 파라미터를 무시한다).
 *
 * 확인 상태 (2026-10-12)
 *   Alibaba.com  /trade/search?SearchText=  실제로 열어 결과 확인
 *   1688         s.1688.com/selloffer/offer_search.htm?keywords=&charset=utf8  이 환경에서 접속 시간 초과 — 사용자 Chrome 확인 필요
 *   타오바오     s.taobao.com/search?q=  로그인 요구 가능 — 사용자 Chrome 확인 필요
 *   이미지 검색  공식 URL 파라미터 방식이 확인된 것은 Google 렌즈(이미지 주소)뿐. 1688 · 타오바오 이미지 검색은 사이트에서 직접 업로드
 */

import type { SupplySite } from "../collectors/supplier/page";

export interface SearchLink {
  site: SupplySite | "GOOGLE_LENS";
  label: string;
  url: string;
  query: string;
  lang: "zh" | "en" | "ko";
  verified: boolean;
}

// 쿼리와 # 뒤에 모두 넣는다 — 사이트가 주소를 바꾸며(리다이렉트) 모르는 쿼리를 지워도 # 값은 브라우저가 이어 붙인다
const withPid = (url: string, productId: string | null) => (productId ? `${url}&jarvis_pid=${encodeURIComponent(productId)}#jarvis_pid=${encodeURIComponent(productId)}` : url);

export function searchLinks(q: { zh: string; en: string; koCore: string }, productId: string | null): SearchLink[] {
  const out: SearchLink[] = [];
  if (q.zh) {
    out.push({ site: "1688", label: "1688 (중국어)", query: q.zh, lang: "zh", verified: false, url: withPid(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(q.zh)}&charset=utf8`, productId) });
    out.push({ site: "TAOBAO", label: "타오바오 (중국어)", query: q.zh, lang: "zh", verified: false, url: withPid(`https://s.taobao.com/search?q=${encodeURIComponent(q.zh)}`, productId) });
  }
  if (q.en) out.push({ site: "ALIBABA", label: "Alibaba.com (영어)", query: q.en, lang: "en", verified: true, url: withPid(`https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q.en)}`, productId) });
  // 번역이 틀릴 수 있어 원문(한국어 핵심어) 검색도 같이 — Alibaba 는 한국어 검색을 받는다
  if (q.koCore) out.push({ site: "ALIBABA", label: "Alibaba.com (원문 한국어)", query: q.koCore, lang: "ko", verified: true, url: withPid(`https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q.koCore)}`, productId) });
  return out;
}

export function imageSearchLink(imageUrl: string | null): SearchLink | null {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return null;
  return { site: "GOOGLE_LENS", label: "Google 렌즈 이미지 검색", query: imageUrl, lang: "ko", verified: false, url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}` };
}

/** 검색 페이지 주소의 jarvis_pid (확장 프로그램이 읽는다) */
export function jarvisPidOf(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("jarvis_pid") ?? new URLSearchParams(u.hash.replace(/^#/, "")).get("jarvis_pid");
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}
