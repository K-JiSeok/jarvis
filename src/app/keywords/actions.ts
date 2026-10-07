"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { cleanKeyword, KEYWORD_MAX_LENGTH } from "@/lib/keywords";
import {
  createKeyword,
  findKeywordIdByText,
  findOrCreateCategory,
  saveManualKeywordSnapshot,
  setKeywordSnapshotExcluded,
  updateKeyword,
  type ManualKeywordSnapshot,
} from "@/lib/repositories/keywords";
import { isConfidence } from "@/types/db";

export interface FormState {
  ok: boolean;
  message: string | null;
  /** 중복 키워드일 때 기존 키워드로 가는 링크용 */
  existingKeywordId?: string;
}

const NEW_CATEGORY = "__new__";

// 키워드 등록 ---------------------------------------------------------------------

export async function createKeywordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const keyword = cleanKeyword(String(formData.get("keyword") ?? ""));
  if (!keyword) return fail("키워드를 입력하세요.");
  if (keyword.length > KEYWORD_MAX_LENGTH) return fail(`키워드는 ${KEYWORD_MAX_LENGTH}자 이하로 입력하세요.`);

  try {
    const existingId = await findKeywordIdByText(keyword);
    if (existingId) {
      return { ok: false, message: `이미 등록된 키워드입니다: ${keyword}`, existingKeywordId: existingId };
    }

    const categoryId = await resolveCategory(formData);
    await createKeyword({ keyword, categoryId, isTracking: formData.get("is_tracking") === "on" });
  } catch (error) {
    if (isPgError(error, "23505")) {
      const existingId = await findKeywordIdByText(keyword).catch(() => null);
      return { ok: false, message: `이미 등록된 키워드입니다: ${keyword}`, existingKeywordId: existingId ?? undefined };
    }
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  return { ok: true, message: `등록했습니다: ${keyword}` };
}

// 키워드 설정 ---------------------------------------------------------------------

export async function updateKeywordAction(keywordId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const memo = String(formData.get("memo") ?? "").trim();
  try {
    await updateKeyword(keywordId, {
      isTracking: formData.get("is_tracking") === "on",
      categoryId: await resolveCategory(formData),
      memo: memo || null,
    });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
  return { ok: true, message: "저장했습니다." };
}

/** 목록에서 추적 ON/OFF 바로 바꾸기 (삭제 대신 사용) */
export async function setTrackingAction(keywordId: string, isTracking: boolean): Promise<void> {
  if (!(await getCurrentUser())) return;
  await updateKeyword(keywordId, { isTracking });
  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
}

// 지표 수동 입력 -------------------------------------------------------------------

export async function saveSnapshotAction(keywordId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const parsed = parseSnapshotForm(keywordId, formData);
  if ("error" in parsed) return fail(parsed.error);

  let action;
  try {
    action = await saveManualKeywordSnapshot(parsed.snapshot);
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
  const label = { INSERTED: "새로 저장했습니다", UPDATED: "같은 날짜의 직접 입력 값을 갱신했습니다", SKIPPED: "바뀐 값이 없습니다" }[action];
  return { ok: true, message: `${parsed.snapshot.capturedOn} · ${label}.` };
}

// 스냅샷 제외 / 복원 ---------------------------------------------------------------

export async function setSnapshotExcludedAction(
  keywordId: string,
  snapshotId: number,
  excluded: boolean,
  formData: FormData,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  const reason = String(formData.get("reason") ?? "").trim() || "직접 제외";
  await setKeywordSnapshotExcluded(snapshotId, excluded, excluded ? reason : null);
  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
}

// 입력 해석 -----------------------------------------------------------------------

async function resolveCategory(formData: FormData): Promise<string | null> {
  const selected = String(formData.get("category_id") ?? "");
  if (selected === NEW_CATEGORY) {
    const name = String(formData.get("new_category") ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new FormError("새 카테고리 이름을 입력하세요.");
    return findOrCreateCategory(name);
  }
  return selected || null;
}

type NumberRule = { min?: number; max?: number; integer?: boolean; percent?: boolean; label: string };

/** 빈 칸 = 모름(null). 숫자가 아니거나 범위를 벗어나면 오류 문구 */
function readNumber(formData: FormData, name: string, rule: NumberRule): number | null | string {
  const raw = String(formData.get(name) ?? "").replace(/,/g, "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${rule.label}: 숫자를 입력하세요.`;
  if (rule.integer && !Number.isInteger(n)) return `${rule.label}: 정수로 입력하세요.`;
  if (rule.min !== undefined && n < rule.min) return `${rule.label}: ${rule.min}${rule.percent ? "%" : ""} 이상이어야 합니다.`;
  if (rule.max !== undefined && n > rule.max) return `${rule.label}: ${rule.max}${rule.percent ? "%" : ""} 이하여야 합니다.`;
  return rule.percent ? round4(n / 100) : n;
}

function parseSnapshotForm(
  keywordId: string,
  formData: FormData,
): { snapshot: ManualKeywordSnapshot } | { error: string } {
  const capturedOn = String(formData.get("captured_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedOn)) return { error: "수집일을 입력하세요." };
  if (capturedOn > todayKst()) return { error: "수집일은 오늘(KST) 이후일 수 없습니다." };

  const confidence = String(formData.get("confidence") ?? "");
  if (!isConfidence(confidence)) return { error: "신뢰도를 선택하세요." };

  const fields = {
    search_volume: readNumber(formData, "search_volume", { label: "월 검색량", min: 0, integer: true }),
    search_volume_previous: readNumber(formData, "search_volume_previous", { label: "이전 검색량", min: 0, integer: true }),
    search_growth_rate: readNumber(formData, "search_growth_rate", { label: "검색량 증감", min: -100, max: 999999, percent: true }),
    coupang_product_count: readNumber(formData, "coupang_product_count", { label: "쿠팡 상품 수", min: 0, integer: true }),
    competition_intensity: readNumber(formData, "competition_intensity", { label: "경쟁강도", min: 0, max: 99999999 }),
    wing_ratio: readNumber(formData, "wing_ratio", { label: "WING 비율", min: 0, max: 100, percent: true }),
    rocket_ratio: readNumber(formData, "rocket_ratio", { label: "로켓 비율", min: 0, max: 100, percent: true }),
    average_price: readNumber(formData, "average_price", { label: "평균 가격", min: 0, integer: true }),
    average_reviews: readNumber(formData, "average_reviews", { label: "평균 리뷰 수", min: 0 }),
    brand_concentration: readNumber(formData, "brand_concentration", { label: "브랜드 집중도", min: 0, max: 100, percent: true }),
    sample_size: readNumber(formData, "sample_size", { label: "표본 수", min: 1, max: 32767, integer: true }),
    ad_bid: readNumber(formData, "ad_bid", { label: "광고 입찰가", min: 0, integer: true }),
  };

  const errors = Object.values(fields).filter((v): v is string => typeof v === "string");
  if (errors.length > 0) return { error: errors.join(" ") };

  const metrics = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => typeof v === "number"),
  ) as ManualKeywordSnapshot["metrics"];
  const calculated: string[] = [];

  // 비워 둔 파생 지표는 같은 입력값으로 계산하고 출처를 CALCULATED 로 남긴다
  if (metrics.competition_intensity === undefined && metrics.coupang_product_count !== undefined && metrics.search_volume) {
    metrics.competition_intensity = round4(metrics.coupang_product_count / metrics.search_volume);
    calculated.push("competition_intensity");
  }
  if (metrics.search_growth_rate === undefined && metrics.search_volume !== undefined && metrics.search_volume_previous) {
    metrics.search_growth_rate = round4((metrics.search_volume - metrics.search_volume_previous) / metrics.search_volume_previous);
    calculated.push("search_growth_rate");
  }

  if (Object.keys(metrics).length === 0) return { error: "지표를 하나 이상 입력하세요." };

  return { snapshot: { keywordId, capturedOn, confidence, metrics, calculated } };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

// 오류 --------------------------------------------------------------------------

class FormError extends Error {}

function fail(message: string): FormState {
  return { ok: false, message };
}

function isPgError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === code;
}

function dbErrorMessage(error: unknown): string {
  if (error instanceof FormError) return error.message;
  if (isPgError(error, "23514")) return "허용 범위를 벗어난 값이 있습니다.";
  if (isPgError(error, "23503")) return "카테고리 또는 키워드를 찾을 수 없습니다.";
  if (isPgError(error, "42501")) return "권한이 없습니다. 다시 로그인하세요.";
  return error instanceof Error ? error.message : "저장에 실패했습니다.";
}
