import "server-only";

import { normalizeKeyword } from "@/lib/keywords";
import { v1Coverage } from "@/lib/discover/coverage";
import { discoverStatus } from "@/lib/discover/summary";
import { registerSelected } from "@/lib/ingest/service";
import { collectNaverSearchVolumes, fetchRelatedKeywords } from "@/lib/ingest/naver-searchad";
import { recordJudgePredictions } from "@/lib/repositories/validation";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getDiscoverAnalysis } from "@/lib/repositories/discover";
import { listKeywords } from "@/lib/repositories/keywords";
import { listSearchObservations } from "@/lib/repositories/search-observations";
import { recordAllDetails } from "@/lib/repositories/costs";
import { ensureQueries, refreshLinks } from "@/lib/repositories/sourcing";
import { listSourcingScope } from "@/lib/repositories/stage";
import { getFxRate } from "@/lib/sourcing/fx";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import { COMPLIANCE_RULE_VERSION, screenCompliance, type ComplianceStatus } from "./compliance";
import { candidatesFromRelated, type DropReason } from "./discovery";
import { autoRegisterBatch, searchResultFromRows, selectUnregistered } from "./selection";

/*
 * 자동 발굴 파이프라인 (PHASE 17). 기존 기능을 순서대로 묶는다 — 새 점수 · 판정 · 임계값 없음.
 *
 *   1. naver-volume     추적 중 키워드의 네이버 검색량 (오늘 수집한 키워드는 건너뜀 — PHASE 14 함수 그대로)
 *   2. keyword-discovery 추적 중 키워드를 시드로 연관 키워드 → keyword_candidates (시드별 하루 1회)
 *   3. auto-register    추적 중 키워드의 가장 최근 쿠팡 검색 수집 기록에서 미등록 상품 전부 등록 (사람의 체크박스 단계 대신)
 *                       같은 수집 기록은 같은 멱등 키 → 다시 실행해도 중복 생성 없음
 *   4. compliance       모든 상품의 판매 가능성 사전 검토 (사용자 판단은 덮어쓰지 않음)
 *   5. analysis         키워드별 Score V1 미리 보기 · 대표 수익성 · 준비 상태 집계 (점수 저장 안 함 — 기존 정책)
 *   7. predictions      (PHASE 30) 판정 · 판매 추정 예측 기록 — 검증 루프용, 상품 · 버전 · 데이터 기준일마다 1행
 *
 * 실행 안정성
 *   - 사용자당 RUNNING 1개 (DB 부분 UNIQUE). 15분 넘게 RUNNING 이면 비정상 종료로 보고 FAILED 로 정리한 뒤 새로 시작
 *   - 확장 프로그램 예약 실행은 마지막 예약 실행 뒤 20시간 안이면 건너뛴다 (하루 1회 — 네이버 · DB 요청 간격)
 *   - 단계마다 try/catch: 한 단계 · 한 키워드의 실패가 다음 단계를 막지 않는다. 결과는 단계마다 바로 저장 (부분 성공 보존)
 *   - 인증: 쿠키 세션(웹) 또는 확장 프로그램 토큰(/api/automation/run → withSupabaseClient). 둘 다 사용자 RLS — service role 없음
 *   - 재시도: 상태 기반이라 다음 실행이 실패한 일만 다시 한다 (네이버 실패 키워드는 오늘 저장이 없으니 다시 요청됨)
 */

export type RunTrigger = "MANUAL" | "EXTENSION_ALARM";
export const STALE_RUN_MS = 15 * 60_000;
export const ALARM_MIN_INTERVAL_MS = 20 * 3_600_000;

export interface StepResult {
  name: string;
  status: "OK" | "SKIPPED" | "FAILED";
  counts: Record<string, Json>;
  note?: string;
  error?: string;
  ms: number;
}

type StepOut = { counts: Record<string, Json>; status?: StepResult["status"]; note?: string };

export type RunOutcome =
  | { ok: true; runId: string; status: "SUCCEEDED" | "PARTIAL" | "FAILED"; steps: StepResult[]; summary: Record<string, Json> }
  | { ok: false; reason: "ALREADY_RUNNING" | "TOO_SOON"; runId: string | null; message: string };

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** 오류 문구. Supabase 오류는 Error 가 아닌 객체라 String() 하면 "[object Object]" 가 된다 (10-29 자동 발굴 analysis 실패) */
const errText = (e: unknown) => {
  if (e instanceof Error) return e.message.slice(0, 500);
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [o.message, o.code && `code ${o.code}`, o.details, o.hint].filter((x) => typeof x === "string" && x);
    if (parts.length) return parts.join(" · ").slice(0, 500);
    try {
      return JSON.stringify(e).slice(0, 500);
    } catch {
      /* 순환 참조 */
    }
  }
  return String(e).slice(0, 500);
};

async function acquire(userId: string, trigger: RunTrigger): Promise<{ id: string } | Extract<RunOutcome, { ok: false }>> {
  const supabase = await createClient();
  if (trigger === "EXTENSION_ALARM") {
    // 기준은 마지막 "예약" 실행 — 수동 실행이 그날의 예약 실행을 막지 않는다 (같은 날 반복분은 단계마다 오늘 수집분을 건너뜀)
    const { data: last } = await supabase
      .from("automation_runs")
      .select("id, started_at")
      .eq("triggered_by", "EXTENSION_ALARM")
      .neq("status", "RUNNING")
      .order("started_at", { ascending: false })
      .limit(1);
    if (last?.[0] && Date.now() - Date.parse(last[0].started_at) < ALARM_MIN_INTERVAL_MS) {
      return { ok: false, reason: "TOO_SOON", runId: last[0].id, message: "마지막 예약 실행 뒤 20시간이 지나지 않아 건너뜁니다." };
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.from("automation_runs").insert({ owner_id: userId, triggered_by: trigger }).select("id").single();
    if (data) return { id: data.id };
    if (error?.code !== "23505") throw new Error(`실행 기록을 만들 수 없습니다: ${error?.message ?? "알 수 없음"}`);
    const { data: running } = await supabase.from("automation_runs").select("id, started_at").eq("status", "RUNNING").limit(1);
    const r = running?.[0];
    if (r && Date.now() - Date.parse(r.started_at) > STALE_RUN_MS) {
      await supabase.from("automation_runs").update({ status: "FAILED", finished_at: new Date().toISOString(), error: "15분 넘게 끝나지 않아 비정상 종료로 정리" }).eq("id", r.id).eq("status", "RUNNING");
      continue;
    }
    return { ok: false, reason: "ALREADY_RUNNING", runId: r?.id ?? null, message: "이미 실행 중인 자동 발굴이 있습니다." };
  }
  return { ok: false, reason: "ALREADY_RUNNING", runId: null, message: "이미 실행 중인 자동 발굴이 있습니다." };
}

export async function runDiscoveryPipeline(userId: string, trigger: RunTrigger): Promise<RunOutcome> {
  const lock = await acquire(userId, trigger);
  if ("ok" in lock) return lock;
  const runId = lock.id;
  const supabase = await createClient();
  const steps: StepResult[] = [];
  const summary: Record<string, Json> = {};
  const today = kstToday();

  const save = async (patch: Record<string, unknown> = {}) => {
    await supabase
      .from("automation_runs")
      .update({ steps: steps as unknown as Json, summary: summary as Json, ...patch })
      .eq("id", runId);
  };
  const step = async (name: string, fn: () => Promise<StepOut>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ name, status: r.status ?? "OK", counts: r.counts, note: r.note, ms: Date.now() - t0 });
    } catch (e) {
      steps.push({ name, status: "FAILED", counts: {}, error: errText(e), ms: Date.now() - t0 });
    }
    await save();
  };

  try {
    const keywords = await listKeywords();
    const tracked = keywords.filter((k) => k.isTracking);
    summary.trackedKeywords = tracked.length;

    // 1. 네이버 검색량 ------------------------------------------------------------
    await step("naver-volume", async (): Promise<StepOut> => {
      if (tracked.length === 0) return { status: "SKIPPED", counts: {}, note: "추적 중인 키워드 없음" };
      const r = await collectNaverSearchVolumes(tracked.map((k) => k.keyword));
      if (r.status === "NOT_CONFIGURED") return { status: "SKIPPED", counts: {}, note: "네이버 검색광고 API 키 없음 (.env.local)" };
      const counts = { requested: r.requested.length, skippedToday: r.skippedToday.length, saved: r.saved, failed: r.failures.length, mock: r.mock };
      if (r.systemError) throw new Error(r.systemError);
      return { counts, note: r.failures.map((f) => `${f.keyword}: ${f.message}`).join(" / ") || undefined };
    });

    // 2. 연관 키워드 → 후보 --------------------------------------------------------
    await step("keyword-discovery", async (): Promise<StepOut> => {
      // 시드: 추적 키워드 + 등록 상품의 쿠팡 카테고리 끝 단계 (상품 페이지에서 읽은 값 — 연결된 상품군으로 탐색 범위를 넓힌다)
      // PHASE 29: 1,000행 넘으면 끝까지 나눠 읽는다
      const catRows = await fetchAllRows((a, b) =>
        supabase
          .from("import_rows")
          .select("category:payload->collected->observedOnly->>category")
          .like("record_key", "product\\_snapshot:%")
          .not("payload->collected->observedOnly->>category", "is", null)
          .order("id")
          .range(a, b),
      );
      const trackedKeys = new Set(tracked.map((k) => k.keyword.replace(/\s+/g, "").toLowerCase()));
      const categorySeeds = [
        ...new Set(
          (catRows ?? [])
            .map((r) => (typeof r.category === "string" ? r.category.split(">").pop()?.trim() ?? "" : ""))
            .flatMap((leaf) => leaf.split("/").map((x) => x.trim()))
            .filter((x) => x.length >= 2 && !trackedKeys.has(x.replace(/\s+/g, "").toLowerCase())),
        ),
      ];
      const allSeeds: { id: string | null; keyword: string; kind: "KEYWORD" | "CATEGORY" }[] = [
        ...tracked.map((k) => ({ id: k.id, keyword: k.keyword, kind: "KEYWORD" as const })),
        ...categorySeeds.map((c) => ({ id: null, keyword: c, kind: "CATEGORY" as const })),
      ];
      if (allSeeds.length === 0) return { status: "SKIPPED", counts: {}, note: "시드로 쓸 추적 키워드 · 상품 카테고리 없음" };
      // 시드별 하루 1회 — 오늘 이 시드로 찾은 후보가 있으면 다시 요청하지 않는다
      const { data: doneToday } = await supabase.from("keyword_candidates").select("seed_keyword").eq("last_seen_on", today);
      const done = new Set((doneToday ?? []).map((r) => r.seed_keyword));
      const seeds = allSeeds.filter((k) => !done.has(k.keyword));
      const known = keywords.map((k) => k.keyword);
      let inserted = 0;
      let updated = 0;
      let failed = 0;
      let mock = false;
      const dropped: Record<DropReason, number> = { SAME_AS_SEED_OR_REGISTERED: 0, DUPLICATE: 0, MEANINGLESS: 0 };
      const failures: string[] = [];
      for (const seed of seeds) {
        const res = await fetchRelatedKeywords(seed.keyword);
        if (res.status === "NOT_CONFIGURED") return { status: "SKIPPED", counts: {}, note: "네이버 검색광고 API 키 없음 — 자동 키워드 발굴 출처 없음" };
        mock ||= res.mock;
        if (!res.result.ok) {
          failed += 1;
          failures.push(`${seed.keyword}: ${res.result.message}`);
          if (res.result.code === "NAVER_AUTH" || res.result.code === "NAVER_RATE_LIMIT") break; // 남은 시드는 다음 실행에
          continue;
        }
        const { candidates, dropped: d } = candidatesFromRelated(seed.keyword, res.result.list, known);
        for (const k of Object.keys(d) as DropReason[]) dropped[k] += d[k];
        if (candidates.length === 0) continue;
        // 기존 후보 조회는 100개씩 (in 목록이 길면 요청 주소 한도를 넘는다 — 실패를 신규로 착각하지 않도록 오류는 멈춤)
        const existing: { id: string; normalized_keyword: string; seen_count: number; status: string; first_seen_at: string; seed_keyword_id: string | null; seed_keyword: string; promoted_keyword_id: string | null; last_seen_on: string }[] = [];
        for (let i = 0; i < candidates.length; i += 100) {
          const { data, error } = await supabase
            .from("keyword_candidates")
            .select("id, normalized_keyword, seen_count, status, first_seen_at, seed_keyword_id, seed_keyword, promoted_keyword_id, last_seen_on")
            .in("normalized_keyword", candidates.slice(i, i + 100).map((c) => c.normalized));
          if (error) throw new Error(`기존 후보 조회 실패: ${error.message}`);
          existing.push(...data);
        }
        const byKey = new Map(existing.map((e) => [e.normalized_keyword, e]));
        const now = new Date().toISOString();
        const rows = candidates.map((c) => {
          const e = byKey.get(c.normalized);
          if (e) updated += 1;
          else inserted += 1;
          // id 는 보내지 않는다: 새 후보 · 기존 후보가 한 요청에 섞이면 새 행에 id NULL 이 들어가 실패한다 (PHASE 22 수정)
          // 기존 행은 onConflict(owner_id, normalized_keyword) 로 찾아 갱신된다
          return {
            owner_id: userId,
            keyword: c.keyword,
            normalized_keyword: c.normalized,
            source_type: "OFFICIAL_API",
            source_tool: "naver-searchad/keywordstool",
            // 처음 발견한 시드를 유지한다 (다른 시드에서 다시 나와도 출처 이력은 seen_count 로)
            seed_keyword_id: e ? e.seed_keyword_id : seed.id,
            seed_keyword: e ? e.seed_keyword : seed.keyword,
            monthly_pc: c.monthlyPc,
            monthly_mobile: c.monthlyMobile,
            search_volume: c.searchVolume,
            below_10: c.below10,
            comp_idx: c.compIdx,
            status: e?.status ?? "NEW",
            promoted_keyword_id: e?.promoted_keyword_id ?? null,
            first_seen_at: e?.first_seen_at ?? now,
            last_seen_at: now,
            last_seen_on: today,
            seen_count: e ? e.seen_count + (e.last_seen_on === today ? 0 : 1) : 1,
            run_id: runId,
          };
        });
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from("keyword_candidates").upsert(rows.slice(i, i + 500), { onConflict: "owner_id,normalized_keyword" });
          if (error) throw new Error(`후보 저장 실패: ${error.message}`);
        }
      }
      summary.newKeywordCandidates = inserted;
      return {
        counts: {
          seeds: seeds.length,
          keywordSeeds: seeds.filter((x) => x.kind === "KEYWORD").length,
          categorySeeds: seeds.filter((x) => x.kind === "CATEGORY").length,
          seedsSkippedToday: allSeeds.length - seeds.length,
          inserted,
          updated,
          failed,
          dropped: dropped as unknown as Json,
          mock,
        },
        note: failures.join(" / ") || undefined,
      };
    });

    // 3. 검색 수집 기록 → 미등록 상품 자동 등록 ----------------------------------------
    await step("auto-register", async (): Promise<StepOut> => {
      const { data: prods, error } = await supabase.from("products").select("coupang_product_id");
      if (error) throw error;
      const registered = new Set(prods.map((p) => p.coupang_product_id));
      let created = 0;
      let existing = 0;
      let duplicateSlots = 0;
      let replays = 0;
      const noObservation: string[] = [];
      const failures: string[] = [];
      for (const k of tracked) {
        try {
          const [obs] = await listSearchObservations(k.keyword, { limit: 1 });
          if (!obs) {
            noObservation.push(k.keyword);
            continue;
          }
          const prefix = escLike(`keyword_product_rank:${normalizeKeyword(k.keyword)}:`);
          const { data: rows, error: rowsError } = await supabase.from("import_rows").select("payload, row_number").eq("import_job_id", obs.jobId).like("record_key", `${prefix}%`).order("row_number").limit(5000);
          if (rowsError) throw rowsError;
          const result = searchResultFromRows(rows, { keyword: k.keyword, capturedAt: obs.capturedAt, tool: "jarvis-automation/1" });
          if (!result) continue;
          const sel = selectUnregistered(result, registered);
          duplicateSlots += sel.duplicateSlots;
          existing += sel.alreadyRegistered;
          if (sel.picked.length === 0) continue;
          const batch = autoRegisterBatch(result, sel.picked);
          const r = await registerSelected(
            { ...batch, idempotencyKey: `auto-register:${obs.jobId}`, tool: "jarvis-automation/1" },
            { products: sel.picked.map((p) => ({ coupang_product_id: p.coupangProductId, product_name: p.item.productName ?? null })), keyword: null },
            supabase,
          );
          if (!r.ok) {
            failures.push(`${k.keyword}: ${r.detail ?? r.error}`);
            continue;
          }
          if (r.replay) replays += 1;
          created += r.createdProducts;
          for (const p of sel.picked) registered.add(p.coupangProductId);
        } catch (e) {
          failures.push(`${k.keyword}: ${errText(e)}`);
        }
      }
      summary.newProducts = created;
      summary.duplicatesRemoved = existing + duplicateSlots;
      const counts = { created, alreadyRegistered: existing, duplicateSlots, replays, keywordsWithoutSearch: noObservation.length, failed: failures.length };
      const notes = [noObservation.length ? `쿠팡 검색 수집 기록 없음: ${noObservation.join(", ")}` : "", ...failures].filter(Boolean);
      if (failures.length && failures.length === tracked.length) throw new Error(notes.join(" / "));
      return { counts, note: notes.join(" / ") || undefined };
    });

    // 4. 판매 가능성 사전 검토 -------------------------------------------------------
    await step("compliance", async (): Promise<StepOut> => {
      // PHASE 29: 상품 · 판매 가능성 · 카테고리 모두 1,000행 넘으면 끝까지 나눠 읽는다
      const [prods, current, cats] = await Promise.all([
        fetchAllRows((a, b) => supabase.from("products").select("id, coupang_product_id, product_name, brand").order("id").range(a, b)),
        fetchAllRows((a, b) => supabase.from("product_compliance").select("product_id, decided_by, status").order("product_id").range(a, b)),
        fetchAllRows((a, b) =>
          supabase
            .from("import_rows")
            .select("record_key, created_at, category:payload->collected->observedOnly->>category")
            .like("record_key", "product\\_snapshot:%")
            .not("payload->collected->observedOnly->>category", "is", null)
            .order("created_at", { ascending: false })
            .order("id")
            .range(a, b),
        ),
      ]);
      const userDecided = new Set((current ?? []).filter((c) => c.decided_by === "USER").map((c) => c.product_id));
      const categoryOf = new Map<string, string>();
      for (const c of cats ?? []) {
        const id = c.record_key?.split(":")[1];
        if (id && typeof c.category === "string" && !categoryOf.has(id)) categoryOf.set(id, c.category);
      }
      const now = new Date().toISOString();
      const rows = prods
        .filter((p) => !userDecided.has(p.id))
        .map((p) => {
          const r = screenCompliance({ productName: p.product_name, brand: p.brand, category: categoryOf.get(p.coupang_product_id) ?? null }, now);
          return { owner_id: userId, product_id: p.id, status: r.status, findings: r.findings as unknown as Json, decided_by: "AUTO", rule_version: COMPLIANCE_RULE_VERSION, checked_at: now };
        });
      for (let i = 0; i < rows.length; i += 500) {
        const { error: upErr } = await supabase.from("product_compliance").upsert(rows.slice(i, i + 500), { onConflict: "owner_id,product_id" });
        if (upErr) throw new Error(`판매 가능성 저장 실패: ${upErr.message}`);
      }
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      for (const c of current ?? []) if (userDecided.has(c.product_id)) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      summary.compliance = byStatus;
      return { counts: { screened: rows.length, keptUserDecision: userDecided.size, withCategory: prods.filter((p) => categoryOf.has(p.coupang_product_id)).length, byStatus } };
    });

    // 5. 중국 도매 소싱 (PHASE 18): 검색어 · 환율 · 공급 후보 매칭 · 도착 원가 재계산 ------------------
    //    공급 상품 자체는 서버가 찾지 않는다 (사이트 공식 API 승인 전) — 사용자가 연 페이지에서 저장한 후보만 다시 계산
    //    PHASE 21: 사용자가 [소싱 시작]한 상품만 (검색어 · 연결 재계산 · 상세 원가). 0개면 건너뛴다 — 다른 상품의 기존 기록은 그대로
    await step("sourcing", async (): Promise<StepOut> => {
      const { scope, total } = await listSourcingScope();
      summary.sourcingScope = scope.length;
      if (scope.length === 0) {
        return { status: "SKIPPED", counts: { products: total, scope: 0, skippedNotSelected: total }, note: "소싱 대상 상품 0개 — 상품을 후보로 선택한 뒤 [소싱 시작]해야 공급 후보 · 원가 계산을 합니다 (발굴은 그대로 진행)" };
      }
      const q = await ensureQueries(scope);
      const fx = await Promise.all(["USD", "CNY"].map(async (c) => [c, await getFxRate(c)] as const));
      const l = await refreshLinks(scope);
      // 상세 원가 (PHASE 20 · cost-detail-v1): 소싱 대상 중 공급 후보를 선택했거나 비용 입력이 있는 상품만 · 같은 입력이면 이력 그대로
      const d = await recordAllDetails(scope);
      const { count: selected } = await supabase.from("product_supply_links").select("id", { count: "exact", head: true }).eq("user_status", "SELECTED");
      const { count: costSnapshots } = await supabase.from("supply_cost_snapshots").select("id", { count: "exact", head: true });
      const { count: offers } = await supabase.from("supply_offers").select("id", { count: "exact", head: true });
      summary.supplyOffers = offers ?? 0;
      summary.supplyLinks = l.refreshed;
      return {
        counts: {
          products: total,
          scope: scope.length,
          skippedNotSelected: total - scope.length,
          linksSkippedOutOfScope: l.skipped,
          detailOutOfScope: d.outOfScope,
          queriesCreated: q.created,
          queriesUpdated: q.updated,
          queriesKept: q.kept,
          offers: offers ?? 0,
          linksRecalculated: l.refreshed,
          linksFailed: l.failed,
          selected: selected ?? 0,
          costSnapshotsCreated: l.snapshotsCreated,
          costSnapshotsUnchanged: l.snapshotsUnchanged,
          costSnapshotsTotal: costSnapshots ?? 0,
          detailProducts: d.products,
          detailCreated: d.created,
          detailUnchanged: d.unchanged,
          detailConfirmed: d.confirmed,
          detailEstimateOnly: d.estimateOnly,
          detailNotAnalyzable: d.notAnalyzable,
          fxUSD: fx[0][1]?.krw ?? null,
          fxCNY: fx[1][1]?.krw ?? null,
        },
        note: fx.some(([, r]) => !r) ? "환율을 받지 못한 통화가 있습니다 (원가 계산 멈춤)" : undefined,
      };
    });

    // 6. 분석 (Score V1 미리 보기 · 수익성 · 준비 상태) ----------------------------------
    await step("analysis", async (): Promise<StepOut> => {
      const best = new Map<string, "FINAL" | "PROVISIONAL" | "INSUFFICIENT">();
      // 항목별 결측 현황은 상품당 1번 (여러 키워드에 연결돼도 처음 본 키워드 맥락 결과 1개)
      const perProduct = new Map<string, import("@/lib/scoring/engine").ScoreResult>();
      const profit = new Set<string>();
      const rank = { FINAL: 0, PROVISIONAL: 1, INSUFFICIENT: 2 } as const;
      const missing: Record<string, number> = {};
      const failures: string[] = [];
      for (const k of tracked) {
        // 화면은 30개씩 보지만 자동 실행은 연결 상품 전부 (최대 100개)
        // PHASE 30: 한 키워드가 실패해도 나머지 키워드는 계속 (전에는 한 번 실패하면 단계 전체가 FAILED)
        let a: Awaited<ReturnType<typeof getDiscoverAnalysis>> = null;
        try {
          a = await getDiscoverAnalysis(k.id, { limit: 100 });
        } catch (e) {
          failures.push(`${k.keyword}: ${errText(e)}`);
          continue;
        }
        for (const p of a?.products ?? []) {
          const s = discoverStatus(p.preview);
          const prev = best.get(p.id);
          if (!prev || rank[s] < rank[prev]) best.set(p.id, s);
          if (p.primaryScenario?.current) profit.add(p.id);
          if (!perProduct.has(p.id)) perProduct.set(p.id, p.preview);
          for (const f of p.preview.factors) if (f.score == null) missing[f.factor] = (missing[f.factor] ?? 0) + 1;
        }
      }
      const count = (s: string) => [...best.values()].filter((x) => x === s).length;
      summary.analyzedProducts = best.size;
      summary.v1Final = count("FINAL");
      summary.v1Provisional = count("PROVISIONAL");
      summary.v1Insufficient = count("INSUFFICIENT");
      summary.profitDone = profit.size;
      summary.missingFactors = missing;
      summary.v1Coverage = v1Coverage([...perProduct.values()]) as unknown as Json;
      if (failures.length === tracked.length && tracked.length > 0) throw new Error(failures.join(" / "));
      return {
        counts: { analyzed: best.size, final: count("FINAL"), provisional: count("PROVISIONAL"), insufficient: count("INSUFFICIENT"), profitDone: profit.size, missingFactors: missing, failedKeywords: failures.length },
        note: failures.length ? failures.join(" / ").slice(0, 1000) : undefined,
      };
    });

    // 7. 판정 예측 기록 (PHASE 30 검증 루프) -----------------------------------------
    // 추적 키워드의 상품마다 "그 검색 결과 수집일 기준" 판정 · 판매 추정을 한 번만 남긴다 (수정 불가 표 · 중복 없음).
    // 다음 수집에서 실제로 늘어난 리뷰 · 쿠팡 표시 하한과 비교해 검증 화면에 보여 준다.
    await step("predictions", async (): Promise<StepOut> => {
      const r = await recordJudgePredictions();
      summary.predictionsInserted = r.inserted;
      return { counts: r, status: r.candidates === 0 ? "SKIPPED" : "OK", note: r.candidates === 0 ? "판매 추정이 있는 추적 키워드 상품 없음" : undefined };
    });
  } catch (e) {
    steps.push({ name: "pipeline", status: "FAILED", counts: {}, error: errText(e), ms: 0 });
  }

  const failed = steps.filter((s) => s.status === "FAILED").length;
  const status = failed === 0 ? "SUCCEEDED" : failed === steps.length ? "FAILED" : "PARTIAL";
  await save({ status, finished_at: new Date().toISOString(), error: failed ? steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`).join(" / ").slice(0, 2000) : null });
  return { ok: true, runId, status, steps, summary };
}

export type { ComplianceStatus };
