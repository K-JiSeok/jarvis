import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { FxRate } from "./landed-cost";

/*
 * 환율 (PHASE 18). 유럽중앙은행(ECB) 기준환율 공개 API (frankfurter.app — 키 없음, 영업일 갱신).
 * 하루 한 번만 받아 fx_rates 에 출처 · 기준일과 함께 저장하고, 원가 계산 결과에 그 값을 그대로 남긴다.
 * 받지 못하면 null → 원가 계산은 "환율 없음"으로 멈춘다 (임의 환율을 쓰지 않는다).
 */

export const FX_SOURCE = "ECB 기준환율 (frankfurter.app)";
const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export async function getFxRate(currency: string): Promise<FxRate | null> {
  if (currency === "KRW") return { currency, krw: 1, source: "원화", rateDate: kstToday() };
  const supabase = await createClient();
  const { data: cached } = await supabase
    .from("fx_rates")
    .select("currency, krw, source, rate_date, fetched_at")
    .eq("currency", currency)
    .eq("source", FX_SOURCE)
    .order("fetched_at", { ascending: false })
    .limit(1);
  const c = cached?.[0];
  if (c && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(c.fetched_at)) === kstToday()) {
    return { currency, krw: Number(c.krw), source: c.source, rateDate: c.rate_date };
  }
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=KRW`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { date?: string; rates?: { KRW?: number } };
    const krw = json.rates?.KRW;
    if (!json.date || !(typeof krw === "number" && krw > 0)) throw new Error("응답 형식이 다릅니다");
    await supabase.from("fx_rates").upsert({ currency, krw, source: FX_SOURCE, rate_date: json.date, fetched_at: new Date().toISOString() }, { onConflict: "owner_id,currency,rate_date,source" });
    return { currency, krw, source: FX_SOURCE, rateDate: json.date };
  } catch {
    // 오늘 못 받으면 마지막 저장값 (기준일이 결과에 남는다)
    return c ? { currency, krw: Number(c.krw), source: c.source, rateDate: c.rate_date } : null;
  }
}
