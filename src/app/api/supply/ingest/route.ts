import { adaptSupplierPage, type RawSupplierPageInput } from "@/lib/collectors/supplier/page";
import { apiJson, authenticate, preflight } from "@/lib/ingest/api-auth";
import { autoLinkOffer, linkOffer, saveOffer } from "@/lib/repositories/sourcing";
import { listSourcingScope } from "@/lib/repositories/stage";
import { MATCH_LABELS } from "@/lib/sourcing/matching";
import { withSupabaseClient } from "@/lib/supabase/server";

/*
 * POST /api/supply/ingest — 확장 프로그램: 사용자가 연 도매 상품 페이지를 공급 후보로 저장 (PHASE 18)
 *
 *   { page: RawSupplierPage (화면 · 구조화 데이터 그대로), targetProductId?: JARVIS 상품 id (JARVIS 검색 링크로 찾던 상품) }
 *   → 해석 (adaptSupplierPage — 보인 값만) → supply_offers 갱신 + 오늘 가격 이력 → 대상 상품과 연결(TARGET) 또는 전체 상품과 자동 매칭(AUTO)
 *   기존 확장 프로그램 API 와 같은 검사 (Origin · Bearer · 요청 제한 · 크기). 사용자 RLS — service role 없음
 */

export const OPTIONS = preflight;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

function parsePage(v: unknown): RawSupplierPageInput | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const url = str(p.url, 2000);
  if (!url) return null;
  const arr = <T,>(x: unknown, f: (y: unknown) => T | null, max: number) => (Array.isArray(x) ? x.slice(0, max).map(f).filter((y): y is T => y != null) : []);
  return {
    url,
    host: str(p.host, 200) ?? "",
    title: str(p.title, 500) ?? "",
    h1: str(p.h1, 500),
    jsonLd: arr(p.jsonLd, (x) => str(x, 200_000), 10),
    ogImage: str(p.ogImage, 2000),
    ogTitle: str(p.ogTitle, 500),
    priceTiers: arr(p.priceTiers, (x) => (x && typeof x === "object" ? { price: str((x as Record<string, unknown>).price, 100) ?? "", qty: str((x as Record<string, unknown>).qty, 100) ?? "" } : null), 10),
    attributes: arr(p.attributes, (x) => (Array.isArray(x) && x.length === 2 ? ([str(x[0], 100) ?? "", str(x[1], 300) ?? ""] as [string, string]) : null), 60),
    shippingText: str(p.shippingText, 500),
    supplierCardText: str(p.supplierCardText, 1000),
    supplierUrl: str(p.supplierUrl, 2000),
    skuText: str(p.skuText, 1000),
  };
}

export async function POST(request: Request) {
  const ctx = await authenticate(request);
  if (ctx instanceof Response) return ctx;
  const body = ctx.body as { page?: unknown; targetProductId?: unknown };
  const page = parsePage(body?.page);
  if (!page) return apiJson(ctx.origin, { ok: false, error: "페이지 데이터가 없습니다." }, 400);
  const target = typeof body.targetProductId === "string" && UUID.test(body.targetProductId) ? body.targetProductId : null;

  const { offer, issues } = adaptSupplierPage(page);
  if (!offer) return apiJson(ctx.origin, { ok: false, error: issues[0] ?? "지원하지 않는 페이지입니다." }, 400);
  try {
    const capturedAt = new Date().toISOString();
    const r = await withSupabaseClient(ctx.supabase, async () => {
      const saved = await saveOffer(offer, capturedAt);
      if (target) {
        const l = await linkOffer(target, saved.id, "TARGET");
        return { saved, target: { level: l.level, label: MATCH_LABELS[l.level], landed: l.landed?.landed ?? null, confidence: l.landed?.confidence ?? null }, auto: null };
      }
      // 대상 상품 없이 저장: 소싱 대상(사용자가 [소싱 시작]한 상품)과만 비교 — 없으면 후보만 저장하고 연결하지 않음
      const { scope } = await listSourcingScope();
      return { saved, target: null, auto: await autoLinkOffer(saved.id, scope) };
    });
    return apiJson(ctx.origin, {
      ok: true,
      offerId: r.saved.id,
      created: r.saved.created,
      site: offer.site,
      title: offer.title,
      basePrice: offer.basePrice,
      tiers: offer.tiers.length,
      moq: offer.moq,
      issues,
      target: r.target,
      auto: r.auto,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    return apiJson(ctx.origin, { ok: false, error: /찾을 수 없습니다/.test(msg) ? "대상 상품을 찾을 수 없습니다 (삭제됐거나 다른 사용자)." : "저장 중 오류" }, 500);
  }
}
