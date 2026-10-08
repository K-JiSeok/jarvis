import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import type { BatchRow } from "@/lib/ingest/batch-rows";
import { IngestInputError, ingestCollected, type CollectedBatch } from "@/lib/ingest/service";
import { ingestBatch, type BatchJob } from "@/lib/repositories/ingest";
import { createClient } from "@/lib/supabase/server";

/*
 * 개발 전용 내부 테스트 경로 (PHASE 10). production 에서는 404.
 * 확장 프로그램 없이 mock 수집 데이터로 대량 저장 경로 전체를 시험한다 (로그인 세션 · RLS 그대로).
 *
 * POST { mode: "collected", products?, searches?, keywords?, idempotencyKey?, tool? }  → ingestCollected()
 * POST { mode: "legacy", records: [{ coupangProductId, capturedAt, price }] }          → PHASE 9 방식(행마다 RPC) 속도 비교용
 * POST { mode: "rows", job, rows }                                                     → ingest_batch 에 배치 행을 그대로 (트랜잭션 실패 시험용)
 *
 * PHASE 11 의 POST /api/ingest 는 이 경로를 그대로 두지 않고, 인증 방식(확장 프로그램 토큰 등)을 정한 뒤 따로 만든다.
 */

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: CollectedBatch & {
    mode?: string;
    records?: { coupangProductId: string; capturedAt: string; price: number }[];
    job?: BatchJob;
    rows?: BatchRow[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  if (body.mode === "rows" && body.job && body.rows) {
    return NextResponse.json(await ingestBatch(body.job, body.rows));
  }

  if (body.mode === "legacy") {
    // 비교용: 상품 스냅샷을 한 건씩 upsert_product_snapshot 으로 (import_rows · job 없음)
    const supabase = await createClient();
    const ids = [...new Set((body.records ?? []).map((r) => r.coupangProductId))];
    const { data: products } = await supabase.from("products").select("id, coupang_product_id").in("coupang_product_id", ids);
    const idMap = new Map((products ?? []).map((p) => [p.coupang_product_id, p.id]));
    const started = performance.now();
    let ok = 0;
    for (const r of body.records ?? []) {
      const { error } = await supabase.rpc("upsert_product_snapshot", {
        p: { product_id: idMap.get(r.coupangProductId)!, captured_at: r.capturedAt, source_type: "MANUAL", confidence: "C", price: r.price },
      });
      if (!error) ok += 1;
    }
    return NextResponse.json({ mode: "legacy", ok, total: body.records?.length ?? 0, elapsedMs: Math.round(performance.now() - started) });
  }

  try {
    const started = performance.now();
    const outcome = await ingestCollected(body);
    return NextResponse.json({ ...outcome, totalMs: Math.round(performance.now() - started) });
  } catch (error) {
    if (error instanceof IngestInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
