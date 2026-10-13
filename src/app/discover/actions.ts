"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { COMPLIANCE_STATUSES, type ComplianceFinding, type ComplianceStatus } from "@/lib/automation/compliance";
import { runDiscoveryPipeline } from "@/lib/automation/pipeline";
import { dbErrorMessage, fail, isPgError, type FormState } from "@/lib/forms";
import { keywordFilter } from "@/lib/automation/keyword-filter";
import { createKeyword, findKeywordIdByText } from "@/lib/repositories/keywords";
import { linkOffer } from "@/lib/repositories/sourcing";
import { addToWatchlist, getWatchlistForProduct, releaseFromWatchlist, updateWatchlistStatus } from "@/lib/repositories/watchlist";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** [자동 발굴 지금 실행] — 예약 실행과 같은 파이프라인 */
export async function runDiscoveryAction(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return fail("로그인이 필요합니다.");
  try {
    const r = await runDiscoveryPipeline(user.id, "MANUAL");
    revalidatePath("/discover");
    if (!r.ok) return fail(r.message);
    const failed = r.steps.filter((s) => s.status === "FAILED").map((s) => s.name);
    return {
      ok: r.status !== "FAILED",
      message: r.status === "SUCCEEDED" ? "자동 발굴을 끝냈습니다." : `일부 단계가 실패했습니다: ${failed.join(", ")} (아래 실행 기록에 사유)`,
    };
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

/** 공급 후보 선택 · 제외 · 되돌리기 (PHASE 18) */
export async function setSupplyStatusAction(linkId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  if (!UUID.test(linkId)) return fail("잘못된 후보입니다.");
  const status = String(formData.get("status") ?? "");
  if (!["CANDIDATE", "SELECTED", "REJECTED"].includes(status)) return fail("상태를 고르세요.");
  const supabase = await createClient();
  const { data: link, error } = await supabase.from("product_supply_links").update({ user_status: status }).eq("id", linkId).select("product_id, offer_id, origin").single();
  if (error) return fail(dbErrorMessage(error));
  let note = "";
  if (status === "SELECTED") {
    // 선택한 후보만 원가 · 수익성 계산 이력을 남긴다 (같은 입력이면 다시 쌓지 않음)
    try {
      const r = await linkOffer(link.product_id, link.offer_id, link.origin as "TARGET" | "AUTO" | "USER");
      note = r.snapshot === "CREATED" ? " 원가 계산 이력을 저장했습니다." : r.snapshot === "UNCHANGED" ? " 원가 입력이 같아 이력은 그대로입니다." : " 원가를 계산할 수 없어 이력을 남기지 않았습니다.";
    } catch (e) {
      note = ` 원가 이력 저장 실패: ${dbErrorMessage(e)}`;
    }
  }
  revalidatePath("/discover");
  return { ok: true, message: (status === "SELECTED" ? "공급 후보로 선택했습니다." : status === "REJECTED" ? "제외했습니다 (기록은 남습니다)." : "후보로 되돌렸습니다.") + note };
}

/** 키워드 후보 → 등록 키워드 (추적 중). 후보에는 등록한 키워드를 연결해 둔다 */
export async function promoteCandidateAction(candidateId: string): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  if (!UUID.test(candidateId)) return fail("잘못된 후보입니다.");
  const supabase = await createClient();
  const { data: c } = await supabase.from("keyword_candidates").select("id, keyword, status").eq("id", candidateId).maybeSingle();
  if (!c) return fail("후보를 찾을 수 없습니다.");
  try {
    let keywordId = await findKeywordIdByText(c.keyword);
    if (!keywordId) keywordId = await createKeyword({ keyword: c.keyword, categoryId: null, isTracking: true });
    const { error } = await supabase.from("keyword_candidates").update({ status: "PROMOTED", promoted_keyword_id: keywordId }).eq("id", c.id);
    if (error) throw error;
  } catch (error) {
    if (!isPgError(error, "23505")) return fail(dbErrorMessage(error));
  }
  revalidatePath("/discover");
  return { ok: true, message: `"${c.keyword}" 을(를) 추적 키워드로 등록했습니다. 다음 자동 실행부터 검색량 · 연관 키워드를 수집합니다.` };
}

export async function dismissCandidateAction(candidateId: string): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  if (!UUID.test(candidateId)) return fail("잘못된 후보입니다.");
  const supabase = await createClient();
  const { error } = await supabase.from("keyword_candidates").update({ status: "DISMISSED" }).eq("id", candidateId).eq("status", "NEW");
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/discover");
  return { ok: true, message: "후보에서 뺐습니다 (기록은 남습니다)." };
}

/**
 * 판매 가능성 사용자 판단 (BLOCKED · CLEARED 는 사용자만). 자동 판단 근거는 그대로 두고 사용자 판단을 덧붙인다.
 * "AUTO" 를 고르면 사용자 판단을 지우고 다음 자동 실행이 다시 검토한다.
 */
export async function setComplianceAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  if (!UUID.test(productId)) return fail("잘못된 상품입니다.");
  const choice = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const supabase = await createClient();
  const { data: cur } = await supabase.from("product_compliance").select("findings").eq("product_id", productId).maybeSingle();

  if (choice === "AUTO") {
    const { error } = await supabase.from("product_compliance").delete().eq("product_id", productId);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/discover");
    return { ok: true, message: "사용자 판단을 지웠습니다. 다음 자동 실행에서 다시 검토합니다." };
  }
  if (!(COMPLIANCE_STATUSES as readonly string[]).includes(choice)) return fail("상태를 고르세요.");
  if ((choice === "BLOCKED" || choice === "CLEARED") && !note) return fail("판매 불가 · 확인 완료는 근거(확인한 문서 · 정책)를 메모에 남겨야 합니다.");
  const now = new Date().toISOString();
  const auto = ((cur?.findings as unknown as ComplianceFinding[] | null) ?? []).filter((f) => f.method === "AUTO");
  const user: ComplianceFinding = {
    area: "PROHIBITED",
    status: choice as ComplianceStatus,
    rule: "user-decision",
    evidence: note ?? "사용자 판단",
    source: "사용자 확인",
    action: "-",
    checkedAt: now,
    method: "USER",
  };
  const findings = [user, ...auto];
  const status = choice as ComplianceStatus;
  const { error } = await supabase
    .from("product_compliance")
    .upsert({ product_id: productId, status, findings: findings as unknown as Json, decided_by: "USER", user_note: note, checked_at: now }, { onConflict: "owner_id,product_id" });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/discover");
  return { ok: true, message: "판매 가능성 판단을 저장했습니다 (사용자 확인)." };
}

// 발굴 → 후보 → 소싱 단계 (PHASE 21) -------------------------------------------------
// 새 상태 컬럼 없이 기존 관심상품 단계를 쓴다: 후보 = WATCHING · 소싱 = SOURCING · 제외 = DROPPED (행 · 이력 보존, 이력은 기존 트리거가 기록)
// 사용자가 누를 때만 바뀐다 — 자동 실행은 이 단계를 읽기만 한다.

export type StageOp = "SHORTLIST" | "START_SOURCING" | "PAUSE_SOURCING" | "REJECT" | "UNREJECT";

export async function setStageAction(productId: string, keywordId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const op = String(formData.get("op") ?? "") as StageOp;
  try {
    const r = await applyStage(productId, keywordId, op);
    revalidatePath("/discover");
    revalidatePath("/watchlist");
    revalidatePath(`/products/${productId}`);
    return r;
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
}

async function applyStage(productId: string, keywordId: string | null, op: StageOp): Promise<FormState> {
  const w = await getWatchlistForProduct(productId);
  switch (op) {
    case "SHORTLIST":
    case "UNREJECT": {
      const r = await addToWatchlist(productId, keywordId);
      return { ok: true, message: r === "ALREADY" ? "이미 후보(또는 이후 단계)입니다 — 그대로 둡니다." : r === "RESTORED" ? "제외를 취소하고 후보로 되돌렸습니다 (이전 이력 유지)." : "소싱 검토 후보로 선택했습니다 (매입 확정 아님)." };
    }
    case "START_SOURCING":
      if (w?.status !== "WATCHING") return fail("후보로 선택된 상품만 소싱을 시작할 수 있습니다.");
      await updateWatchlistStatus(w.id, "SOURCING");
      return { ok: true, message: "소싱을 시작했습니다 — 검색 링크로 공급 페이지를 열고 확장 프로그램으로 공급 후보를 저장하세요." };
    case "PAUSE_SOURCING":
      if (w?.status !== "SOURCING") return fail("소싱 진행 중인 상품만 보류할 수 있습니다.");
      await updateWatchlistStatus(w.id, "WATCHING");
      return { ok: true, message: "소싱을 보류하고 후보로 되돌렸습니다 (공급 후보 · 원가 기록은 그대로)." };
    case "REJECT":
      if (w?.status === "DROPPED") return { ok: true, message: "이미 검토 제외입니다." };
      if (!w) await addToWatchlist(productId, keywordId);
      await releaseFromWatchlist((w ?? (await getWatchlistForProduct(productId)))!.id);
      return { ok: true, message: "검토에서 제외했습니다 (공급 후보 · 원가 기록은 지우지 않음 · [제외 취소] 가능)." };
    default:
      return fail("알 수 없는 작업입니다.");
  }
}

/** 선택한 후보 여러 개를 한 번에 소싱 시작 (후보(WATCHING) 상태인 것만 — 나머지는 건너뛰고 사유를 알려 줌) */
export async function bulkStartSourcingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const ids = formData.getAll("product_id").map(String).filter((v) => UUID.test(v));
  if (ids.length === 0) return fail("소싱을 시작할 후보를 체크하세요.");
  let started = 0;
  const skipped: string[] = [];
  try {
    for (const id of ids) {
      const w = await getWatchlistForProduct(id);
      if (w?.status !== "WATCHING") {
        skipped.push(`${w?.productName ?? id.slice(0, 8)} (${w ? w.status : "후보 아님"})`);
        continue;
      }
      await updateWatchlistStatus(w.id, "SOURCING");
      started += 1;
    }
  } catch (error) {
    return fail(`${started}개 시작 후 오류: ${dbErrorMessage(error)}`);
  }
  revalidatePath("/discover");
  revalidatePath("/watchlist");
  return { ok: started > 0, message: `선택 ${ids.length}개 중 ${started}개 소싱 시작${skipped.length ? ` · 건너뜀 ${skipped.length}개: ${skipped.join(", ")}` : ""}` };
}

/** 발굴 범위 넓히기 (PHASE 22): 대기 후보 중 네이버 검색량 상위 n개를 추적 키워드로 (10 미만 · 이미 등록된 키워드는 건너뜀) */
export async function promoteTopCandidatesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const n = Math.min(20, Math.max(1, Number(formData.get("n") ?? 10) || 10));
  const supabase = await createClient();
  // 브랜드 · 너무 넓은 키워드는 건너뛴다 (PHASE 23 · kw-filter-v1) — 후보는 그대로 남고 직접 등록은 가능
  const { data: pool, error } = await supabase
    .from("keyword_candidates")
    .select("id, keyword, search_volume")
    .eq("status", "NEW")
    .eq("below_10", false)
    .not("search_volume", "is", null)
    .order("search_volume", { ascending: false })
    .limit(n * 10);
  if (error) return fail(dbErrorMessage(error));
  const skipped: string[] = [];
  const cands = [];
  for (const c of pool ?? []) {
    if (cands.length >= n) break;
    const why = keywordFilter(c.keyword, c.search_volume);
    if (why) skipped.push(`${c.keyword}(${why === "BRAND" ? "브랜드" : "너무 넓음"})`);
    else cands.push(c);
  }
  const done: string[] = [];
  for (const c of cands) {
    try {
      let keywordId = await findKeywordIdByText(c.keyword);
      if (!keywordId) keywordId = await createKeyword({ keyword: c.keyword, categoryId: null, isTracking: true });
      const { error: e } = await supabase.from("keyword_candidates").update({ status: "PROMOTED", promoted_keyword_id: keywordId }).eq("id", c.id);
      if (e) throw e;
      done.push(c.keyword);
    } catch (e) {
      if (!isPgError(e, "23505")) return fail(`${done.length}개 등록 후 오류: ${dbErrorMessage(e)}`);
    }
  }
  revalidatePath("/discover");
  const skipTxt = skipped.length ? ` · 건너뜀 ${skipped.length}개: ${skipped.slice(0, 10).join(", ")}` : "";
  return { ok: done.length > 0, message: done.length ? `${done.length}개를 추적 키워드로 등록했습니다: ${done.join(", ")}. 다음 자동 실행부터 검색량 · 연관 키워드를 모읍니다.${skipTxt}` : `등록할 후보가 없습니다.${skipTxt}` };
}
