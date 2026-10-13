"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { COMPLIANCE_STATUSES, type ComplianceFinding, type ComplianceStatus } from "@/lib/automation/compliance";
import { runDiscoveryPipeline } from "@/lib/automation/pipeline";
import { dbErrorMessage, fail, isPgError, type FormState } from "@/lib/forms";
import { createKeyword, findKeywordIdByText } from "@/lib/repositories/keywords";
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
  const { error } = await supabase.from("product_supply_links").update({ user_status: status }).eq("id", linkId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/discover");
  return { ok: true, message: status === "SELECTED" ? "공급 후보로 선택했습니다." : status === "REJECTED" ? "제외했습니다 (기록은 남습니다)." : "후보로 되돌렸습니다." };
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
